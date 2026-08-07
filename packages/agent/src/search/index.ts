import type { SessionMetadata } from "../harness/session/types.ts";

export type { IndexedSessionSearch, SearchIndexWriter } from "./indexable.ts";
export {
	createJsonlScanningSessionSearch,
	createJsonlScanningSessionSource,
	jsonlScanningSessions,
	jsonlSearchSessions,
} from "./jsonl.ts";
export {
	createMemoryScanningSessionSearch,
	createMemoryScanningSessionSource,
	memoryScanningSessions,
} from "./memory.ts";
export type {
	ScanningSession,
	ScanningSessionSearchOptions,
	ScanningSessionSource,
	SessionSearchCandidate,
} from "./scanning.ts";
export { createScanningSessionSearch } from "./scanning.ts";

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
