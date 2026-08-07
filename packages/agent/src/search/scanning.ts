import type { SessionMetadata } from "../harness/session/types.ts";
import type { SessionSearch, SessionSearchHit, SessionSearchOptions } from "./index.ts";

type MaybeAsyncIterable<T> = Iterable<T> | AsyncIterable<T>;

export interface SessionSearchCandidate {
	entryId: string;
	seq: number;
	timestamp: number;
	text: string;
	fields?: Record<string, unknown>;
}

export interface ScanningSession<TMetadata extends SessionMetadata = SessionMetadata> {
	metadata(): Promise<TMetadata>;
	entries(options?: { afterSeq?: number; limit?: number }): MaybeAsyncIterable<SessionSearchCandidate>;
}

export interface ScanningSessionSource<TMetadata extends SessionMetadata = SessionMetadata, TOptions = unknown> {
	sessions(options?: TOptions): MaybeAsyncIterable<ScanningSession<TMetadata>>;
}

export interface ScanningSessionSearchOptions<
	TMetadata extends SessionMetadata = SessionMetadata,
	TListOptions = unknown,
> {
	sourceOptions?: (options: SessionSearchOptions) => TListOptions | undefined;
	match?: (queryText: string, candidate: SessionSearchCandidate, metadata: TMetadata) => boolean;
	score?: (queryText: string, candidate: SessionSearchCandidate, metadata: TMetadata) => number | undefined;
}

function defaultMatch(queryText: string, candidate: SessionSearchCandidate): boolean {
	return candidate.text.toLowerCase().includes(queryText);
}

class ScanningSessionSearch<TMetadata extends SessionMetadata = SessionMetadata, TListOptions = unknown>
	implements SessionSearch<TMetadata>
{
	private readonly source: ScanningSessionSource<TMetadata, TListOptions>;
	private readonly options: ScanningSessionSearchOptions<TMetadata, TListOptions>;

	constructor(
		source: ScanningSessionSource<TMetadata, TListOptions>,
		options: ScanningSessionSearchOptions<TMetadata, TListOptions> = {},
	) {
		this.source = source;
		this.options = options;
	}

	async search(options: SessionSearchOptions): Promise<SessionSearchHit<TMetadata>[]> {
		const normalizedText = options.text.trim().toLowerCase();
		if (!normalizedText || (options.limit !== undefined && options.limit <= 0)) return [];
		const hits: SessionSearchHit<TMetadata>[] = [];
		for await (const session of this.source.sessions(this.options.sourceOptions?.(options))) {
			const metadata = await session.metadata();
			const cwd = metadataHasCwd(metadata) ? metadata.cwd : undefined;
			if (options.cwd !== undefined && cwd !== options.cwd) continue;
			for await (const candidate of session.entries()) {
				const matches =
					this.options.match?.(normalizedText, candidate, metadata) ?? defaultMatch(normalizedText, candidate);
				if (!matches) continue;
				hits.push({
					metadata,
					entryId: candidate.entryId,
					timestamp: candidate.timestamp,
					snippet: candidate.text,
					score: this.options.score?.(normalizedText, candidate, metadata),
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
	source: ScanningSessionSource<TMetadata, TListOptions>,
	options?: ScanningSessionSearchOptions<TMetadata, TListOptions>,
): SessionSearch<TMetadata> {
	return new ScanningSessionSearch(source, options);
}
