import { listJsonlSessionMetadata, loadJsonlSessionStorage } from "../harness/session/jsonl/repo.ts";
import type { JsonlSessionStorage } from "../harness/session/jsonl/storage.ts";
import type {
	JsonlSessionListOptions,
	JsonlSessionMetadata,
	JsonlSessionRepoOptions,
} from "../harness/session/jsonl/types.ts";
import type { SessionSearchSource } from "./index.ts";

export async function* jsonlSearchSessions(
	options: JsonlSessionRepoOptions,
	query: JsonlSessionListOptions = {},
): AsyncIterable<JsonlSessionStorage> {
	for (const metadata of await listJsonlSessionMetadata(options, query)) {
		yield loadJsonlSessionStorage(options, metadata);
	}
}

export class JsonlSessionSearchSource implements SessionSearchSource<JsonlSessionMetadata, JsonlSessionListOptions> {
	private readonly options: JsonlSessionRepoOptions;

	constructor(options: JsonlSessionRepoOptions) {
		this.options = options;
	}

	sessions(options?: JsonlSessionListOptions): AsyncIterable<JsonlSessionStorage> {
		return jsonlSearchSessions(this.options, options);
	}
}
