import type { Entry, SessionMetadata, SessionStorage } from "../harness/session/types.ts";

export { JsonlSessionSearchSource, jsonlSearchSessions } from "./jsonl.ts";

import { SessionError } from "../harness/session/types.ts";
import type { FileError, Result } from "../harness/types.ts";

type MaybeAsyncIterable<T> = Iterable<T> | AsyncIterable<T>;

export interface SessionSearchOptions {
	text: string;
	cwd?: string;
	limit?: number;
}

export interface SessionSearchHit<TMetadata extends SessionMetadata = SessionMetadata> {
	metadata: TMetadata;
	entryId: string;
	timestamp: number;
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

export type SessionSearchReadable<TMetadata extends SessionMetadata = SessionMetadata> = Pick<
	SessionStorage<TMetadata>,
	"getMetadata" | "findEntries" | "getName" | "getLabel"
>;

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
					timestamp: entry.timestamp,
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
