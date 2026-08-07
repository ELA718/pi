import type { SessionMetadata } from "../harness/session/types.ts";
import type { SessionSearch } from "./index.ts";

export interface SearchIndexWriter<TItem = unknown> {
	apply(items: TItem[]): Promise<void>;
	flush?(): Promise<void>;
}

export interface IndexedSessionSearch<TMetadata extends SessionMetadata = SessionMetadata, TItem = unknown>
	extends SessionSearch<TMetadata>,
		SearchIndexWriter<TItem> {}
