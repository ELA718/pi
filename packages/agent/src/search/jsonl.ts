import { listJsonlSessionMetadata, loadJsonlSessionStorage } from "../harness/session/jsonl/repo.ts";
import type { JsonlSessionStorage } from "../harness/session/jsonl/storage.ts";
import type {
	JsonlSessionListOptions,
	JsonlSessionMetadata,
	JsonlSessionRepoOptions,
} from "../harness/session/jsonl/types.ts";
import type { Entry } from "../harness/session/types.ts";
import type { SessionSearch } from "./index.ts";
import {
	createScanningSessionSearch,
	type ScanningSession,
	type ScanningSessionSource,
	type SessionSearchCandidate,
} from "./scanning.ts";

export type JsonlSearchTextProjector = (
	metadata: JsonlSessionMetadata,
	entry: Entry,
	label: string | undefined,
) => string;

export interface JsonlScanningSessionSourceOptions {
	projectText?: JsonlSearchTextProjector;
	pageSize?: number;
}

function defaultJsonlSearchText(_metadata: JsonlSessionMetadata, entry: Entry, label: string | undefined): string {
	return label === undefined ? JSON.stringify(entry) : `${JSON.stringify(entry)} ${label}`;
}

export async function* jsonlSearchSessions(
	options: JsonlSessionRepoOptions,
	query: JsonlSessionListOptions = {},
): AsyncIterable<JsonlSessionStorage> {
	for (const metadata of await listJsonlSessionMetadata(options, query)) {
		yield loadJsonlSessionStorage(options, metadata);
	}
}

async function* jsonlSearchCandidates(
	storage: JsonlSessionStorage,
	options: JsonlScanningSessionSourceOptions,
	query: { afterSeq?: number; limit?: number } = {},
): AsyncIterable<SessionSearchCandidate> {
	const metadata = await storage.getMetadata();
	const projectText = options.projectText ?? defaultJsonlSearchText;
	const pageSize = query.limit ?? options.pageSize ?? 100;
	let afterSeq = query.afterSeq ?? 0;
	while (true) {
		const entries = await storage.findEntries({ order: "oldestFirst", limit: pageSize, cursor: { afterSeq } });
		if (entries.length === 0) break;
		for (const entry of entries) {
			const label = await storage.getLabel(entry.id);
			yield {
				entryId: entry.id,
				seq: entry.seq,
				timestamp: entry.timestamp,
				text: projectText(metadata, entry, label),
				fields: label === undefined ? undefined : { label },
			};
		}
		afterSeq = entries[entries.length - 1]?.seq ?? afterSeq;
		if (entries.length < pageSize) break;
	}
}

export async function* jsonlScanningSessions(
	options: JsonlSessionRepoOptions,
	query: JsonlSessionListOptions = {},
	sourceOptions: JsonlScanningSessionSourceOptions = {},
): AsyncIterable<ScanningSession<JsonlSessionMetadata>> {
	for await (const storage of jsonlSearchSessions(options, query)) {
		yield {
			metadata: () => storage.getMetadata(),
			entries: (entryQuery) => jsonlSearchCandidates(storage, sourceOptions, entryQuery),
		};
	}
}

export function createJsonlScanningSessionSource(
	options: JsonlSessionRepoOptions,
	sourceOptions: JsonlScanningSessionSourceOptions = {},
): ScanningSessionSource<JsonlSessionMetadata, JsonlSessionListOptions> {
	return {
		sessions: (query) => jsonlScanningSessions(options, query, sourceOptions),
	};
}

export function createJsonlScanningSessionSearch(
	options: JsonlSessionRepoOptions,
	sourceOptions?: JsonlScanningSessionSourceOptions,
): SessionSearch<JsonlSessionMetadata> {
	return createScanningSessionSearch(createJsonlScanningSessionSource(options, sourceOptions), {
		sourceOptions: (query) => ({ cwd: query.cwd }),
	});
}
