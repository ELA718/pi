import type { Entry, EntryQuery, SessionMetadata } from "../harness/session/types.ts";
import { SessionError } from "../harness/session/types.ts";
import type { FileError, Result } from "../harness/types.ts";

type MaybePromise<T> = T | Promise<T>;
type MaybeAsyncIterable<T> = Iterable<T> | AsyncIterable<T>;
type FeedProjectionResult<TItem> = TItem | readonly TItem[] | undefined;

export interface SessionSearchOptions {
	text: string;
	cwd?: string;
	limit?: number;
}

export interface SessionSearchHit<TMetadata extends SessionMetadata = SessionMetadata> {
	metadata: TMetadata;
	entryId: string;
	timestamp: string;
	snippet?: string;
	score?: number;
}

export interface SessionSearch<TMetadata extends SessionMetadata = SessionMetadata> {
	search(options: SessionSearchOptions): Promise<SessionSearchHit<TMetadata>[]>;
}

export interface SearchIndexWriter<TItem = unknown> {
	apply(items: TItem[]): Promise<void>;
	flush?(): Promise<void>;
}

export interface IndexedSessionSearch<TMetadata extends SessionMetadata = SessionMetadata, TItem = unknown>
	extends SessionSearch<TMetadata>,
		SearchIndexWriter<TItem> {}

export interface SessionSearchReadable<TMetadata extends SessionMetadata = SessionMetadata> {
	getMetadata(): Promise<TMetadata>;
	findEntries(query?: EntryQuery): Promise<Entry[]>;
}

export interface SessionSearchSource<TMetadata extends SessionMetadata = SessionMetadata, TOptions = unknown> {
	sessions(options?: TOptions): MaybeAsyncIterable<SessionSearchReadable<TMetadata>>;
}

export function createSessionListSearchSource<TMetadata extends SessionMetadata>(
	sessions: readonly SessionSearchReadable<TMetadata>[],
): SessionSearchSource<TMetadata, void> {
	return {
		sessions() {
			return sessions;
		},
	};
}

export interface FeedSessionSnapshotOptions<TMetadata extends SessionMetadata, TListOptions, TItem> {
	listOptions?: TListOptions;
	projectSession?: (metadata: TMetadata) => MaybePromise<FeedProjectionResult<TItem>>;
	projectEntry: (metadata: TMetadata, entry: Entry) => MaybePromise<FeedProjectionResult<TItem>>;
	batchSize?: number;
}

export interface SessionSearchDocument<TMetadata extends SessionMetadata = SessionMetadata> {
	sessionId: string;
	entryId: string;
	seq: number;
	timestamp: number;
	metadata: TMetadata;
	text: string;
	fields?: Record<string, string | number | boolean | null>;
}

export type SessionSearchDocumentFeedItem<TMetadata extends SessionMetadata = SessionMetadata> =
	| { type: "entry_upsert"; document: SessionSearchDocument<TMetadata> }
	| { type: "entry_delete"; sessionId: string; entryId: string }
	| { type: "session_delete"; sessionId: string }
	| { type: "session_metadata"; sessionId: string; metadata: TMetadata };

export type SessionSearchDocumentIndexWriter<TMetadata extends SessionMetadata = SessionMetadata> = SearchIndexWriter<
	SessionSearchDocumentFeedItem<TMetadata>
>;

export interface DocumentIndexedSessionSearch<TMetadata extends SessionMetadata = SessionMetadata>
	extends IndexedSessionSearch<TMetadata, SessionSearchDocumentFeedItem<TMetadata>> {}

export type SessionSearchTextProjector = (entry: Entry) => string;

export type SessionSearchDocumentProjector<TMetadata extends SessionMetadata = SessionMetadata> = (
	metadata: TMetadata,
	entry: Entry,
) => SessionSearchDocument<TMetadata> | undefined;

export interface FeedSessionDocumentSnapshotOptions<
	TMetadata extends SessionMetadata = SessionMetadata,
	TListOptions = unknown,
> {
	listOptions?: TListOptions;
	project?: SessionSearchDocumentProjector<TMetadata>;
	batchSize?: number;
}

export function getFileSystemResultOrThrow<TValue>(result: Result<TValue, FileError>, message: string): TValue {
	if (!result.ok) {
		const code = result.error.code === "not_found" ? "not_found" : "storage";
		throw new SessionError(code, `${message}: ${result.error.message}`, result.error);
	}
	return result.value;
}

export function defaultSearchText(entry: Entry): string {
	return JSON.stringify(entry);
}

export function projectSessionSearchDocument<TMetadata extends SessionMetadata>(
	metadata: TMetadata,
	entry: Entry,
	textProjector: SessionSearchTextProjector = defaultSearchText,
): SessionSearchDocument<TMetadata> {
	return {
		sessionId: metadata.id,
		entryId: entry.id,
		seq: entry.seq,
		timestamp: entry.timestamp,
		metadata,
		text: textProjector(entry),
	};
}

export async function feedSessionSnapshot<TMetadata extends SessionMetadata, TListOptions, TItem>(
	source: SessionSearchSource<TMetadata, TListOptions>,
	index: SearchIndexWriter<TItem>,
	options: FeedSessionSnapshotOptions<TMetadata, TListOptions, TItem>,
): Promise<void> {
	const batchSize = options.batchSize ?? 100;
	if (!Number.isInteger(batchSize) || batchSize <= 0) {
		throw new SessionError("invalid_query", `Search feed batchSize must be a positive integer, got ${batchSize}`);
	}
	let batch: TItem[] = [];
	const flushBatch = async () => {
		if (batch.length === 0) return;
		const items = batch;
		batch = [];
		await index.apply(items);
	};
	const enqueue = async (projected: MaybePromise<FeedProjectionResult<TItem>>) => {
		const result = await projected;
		if (result === undefined) return;
		const items = Array.isArray(result) ? result : [result];
		for (const item of items) {
			batch.push(item);
			if (batch.length >= batchSize) await flushBatch();
		}
	};

	for await (const session of source.sessions(options.listOptions)) {
		const metadata = await session.getMetadata();
		if (options.projectSession) await enqueue(options.projectSession(metadata));
		for (const entry of await session.findEntries({ order: "oldestFirst" })) {
			await enqueue(options.projectEntry(metadata, entry));
		}
	}
	await flushBatch();
	await index.flush?.();
}

export async function feedSessionDocumentSnapshot<TMetadata extends SessionMetadata, TListOptions = unknown>(
	source: SessionSearchSource<TMetadata, TListOptions>,
	index: SessionSearchDocumentIndexWriter<TMetadata>,
	options: FeedSessionDocumentSnapshotOptions<TMetadata, TListOptions> = {},
): Promise<void> {
	const project: SessionSearchDocumentProjector<TMetadata> =
		options.project ?? ((metadata, entry) => projectSessionSearchDocument(metadata, entry));
	await feedSessionSnapshot(source, index, {
		listOptions: options.listOptions,
		batchSize: options.batchSize,
		projectSession: (metadata): SessionSearchDocumentFeedItem<TMetadata> => ({
			type: "session_metadata",
			sessionId: metadata.id,
			metadata,
		}),
		projectEntry: (metadata, entry): SessionSearchDocumentFeedItem<TMetadata> | undefined => {
			const document = project(metadata, entry);
			return document === undefined ? undefined : { type: "entry_upsert", document };
		},
	});
}

class ScanningSessionSearch<TMetadata extends SessionMetadata = SessionMetadata, TListOptions = unknown>
	implements SessionSearch<TMetadata>
{
	private readonly source: SessionSearchSource<TMetadata, TListOptions>;

	constructor(source: SessionSearchSource<TMetadata, TListOptions>) {
		this.source = source;
	}

	async search(options: SessionSearchOptions): Promise<SessionSearchHit<TMetadata>[]> {
		const normalizedText = options.text.trim().toLowerCase();
		if (!normalizedText || (options.limit !== undefined && options.limit <= 0)) return [];
		const hits: SessionSearchHit<TMetadata>[] = [];
		for await (const session of this.source.sessions()) {
			const metadata = await session.getMetadata();
			const cwd = metadataHasCwd(metadata) ? metadata.cwd : undefined;
			if (options.cwd !== undefined && cwd !== options.cwd) continue;
			for (const entry of await session.findEntries({ order: "oldestFirst" })) {
				const payload = defaultSearchText(entry);
				if (!payload.toLowerCase().includes(normalizedText)) continue;
				hits.push({
					metadata,
					entryId: entry.id,
					timestamp: new Date(entry.timestamp).toISOString(),
					snippet: payload,
				});
				if (options.limit !== undefined && hits.length >= options.limit) return hits;
			}
		}
		return hits;
	}
}

function metadataHasCwd(metadata: SessionMetadata): metadata is SessionMetadata & { cwd: string } {
	return typeof (metadata as SessionMetadata & { cwd?: unknown }).cwd === "string";
}

export function createScanningSessionSearch<TMetadata extends SessionMetadata, TListOptions = unknown>(
	source: SessionSearchSource<TMetadata, TListOptions>,
): SessionSearch<TMetadata> {
	return new ScanningSessionSearch(source);
}
