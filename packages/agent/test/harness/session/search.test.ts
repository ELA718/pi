import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeExecutionEnv } from "../../../src/harness/env/nodejs.ts";
import {
	InMemorySessionStorage,
	JsonlSessionRepo,
	Session,
	type SessionMetadata,
	type SessionStorage,
} from "../../../src/harness/session/index.ts";
import {
	createScanningSessionSearch,
	createSessionListSearchSource,
	type DocumentIndexedSessionSearch,
	feedSessionDocumentSnapshot,
	feedSessionSnapshot,
	JsonlSessionSearchSource,
	type SearchIndexWriter,
	type SessionSearchDocumentFeedItem,
	type SessionSearchHit,
	type SessionSearchSource,
} from "../../../src/search/index.ts";
import type { AgentMessage } from "../../../src/types.ts";

interface WorkspaceMetadata extends SessionMetadata {
	cwd: string;
}

const tempDirs: string[] = [];

function createTempDir(): string {
	const directory = mkdtempSync(join(tmpdir(), "pi-agent-search-"));
	tempDirs.push(directory);
	return directory;
}

afterEach(() => {
	while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function message(text: string): AgentMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp: 1 };
}

function createMemorySession(metadata: WorkspaceMetadata): Session<WorkspaceMetadata> {
	return new Session<WorkspaceMetadata>(
		new InMemorySessionStorage(metadata) as unknown as SessionStorage<WorkspaceMetadata>,
	);
}

function createSource(sessions: Session<WorkspaceMetadata>[]): SessionSearchSource<WorkspaceMetadata> {
	return createSessionListSearchSource(sessions);
}

class InMemoryIndexedSearch<TMetadata extends SessionMetadata> implements DocumentIndexedSessionSearch<TMetadata> {
	readonly appliedBatches: SessionSearchDocumentFeedItem<TMetadata>[][] = [];
	private readonly documents = new Map<
		string,
		Extract<SessionSearchDocumentFeedItem<TMetadata>, { type: "entry_upsert" }>["document"]
	>();
	private readonly metadata = new Map<string, TMetadata>();

	async apply(items: SessionSearchDocumentFeedItem<TMetadata>[]): Promise<void> {
		this.appliedBatches.push(items);
		for (const item of items) {
			switch (item.type) {
				case "entry_upsert":
					this.documents.set(`${item.document.sessionId}:${item.document.entryId}`, item.document);
					this.metadata.set(item.document.sessionId, item.document.metadata);
					break;
				case "entry_delete":
					this.documents.delete(`${item.sessionId}:${item.entryId}`);
					break;
				case "session_delete":
					for (const key of [...this.documents.keys()]) {
						if (key.startsWith(`${item.sessionId}:`)) this.documents.delete(key);
					}
					this.metadata.delete(item.sessionId);
					break;
				case "session_metadata":
					this.metadata.set(item.sessionId, item.metadata);
					break;
			}
		}
	}

	async search(options: { text: string; cwd?: string; limit?: number }): Promise<SessionSearchHit<TMetadata>[]> {
		const text = options.text.trim().toLowerCase();
		if (!text) return [];
		const hits: SessionSearchHit<TMetadata>[] = [];
		for (const document of [...this.documents.values()].sort((left, right) => left.seq - right.seq)) {
			const cwd = (document.metadata as TMetadata & { cwd?: unknown }).cwd;
			if (options.cwd !== undefined && cwd !== options.cwd) continue;
			if (!document.text.toLowerCase().includes(text)) continue;
			hits.push({
				metadata: document.metadata,
				entryId: document.entryId,
				timestamp: document.timestamp,
				snippet: document.text,
				score: 0,
			});
			if (options.limit !== undefined && hits.length >= options.limit) break;
		}
		return hits;
	}
}

interface EntryReferenceFeedItem {
	sessionId: string;
	entryId: string;
	seq: number;
}

class EntryReferenceIndex implements SearchIndexWriter<EntryReferenceFeedItem> {
	readonly items: EntryReferenceFeedItem[] = [];

	async apply(items: EntryReferenceFeedItem[]): Promise<void> {
		this.items.push(...items);
	}
}

describe("session search", () => {
	it("scans an arbitrary in-memory session source", async () => {
		const root = createMemorySession({ id: "root", createdAt: 1, cwd: "/repo" });
		await root.appendMessage(message("fix auth flow"));
		const other = createMemorySession({ id: "other", createdAt: 2, cwd: "/other" });
		await other.appendMessage(message("auth in another workspace"));
		const search = createScanningSessionSearch(createSource([root, other]));

		expect("apply" in search).toBe(false);
		await expect(search.search({ text: "auth", cwd: "/repo" })).resolves.toMatchObject([
			{ metadata: { id: "root", cwd: "/repo" } },
		]);
		await expect(search.search({ text: "missing" })).resolves.toEqual([]);
	});

	it("feeds memory sessions into an arbitrary index without a repository search method", async () => {
		const session = createMemorySession({ id: "session", createdAt: 1, cwd: "/repo" });
		const first = await session.appendMessage(message("implement auth search"));
		await session.appendMessage(message("unrelated"));
		const index = new InMemoryIndexedSearch<WorkspaceMetadata>();

		await feedSessionDocumentSnapshot(createSource([session]), index, { batchSize: 2 });

		await expect(index.search({ text: "auth", cwd: "/repo" })).resolves.toMatchObject([
			{ metadata: { id: "session", cwd: "/repo" }, entryId: first },
		]);
		expect(index.appliedBatches.length).toBeGreaterThan(1);
	});

	it("feeds snapshots through arbitrary backend-owned item shapes", async () => {
		const session = createMemorySession({ id: "session", createdAt: 1, cwd: "/repo" });
		const entryId = await session.appendMessage(message("index by reference"));
		const index = new EntryReferenceIndex();

		await feedSessionSnapshot(createSource([session]), index, {
			projectEntry: (metadata, entry) => ({ sessionId: metadata.id, entryId: entry.id, seq: entry.seq }),
		});

		expect(index.items).toEqual([{ sessionId: "session", entryId, seq: 1 }]);
	});

	it("feeds JSONL sessions from disk through the JSONL search source", async () => {
		const root = createTempDir();
		const options = { fs: new NodeExecutionEnv({ cwd: root }), sessionsRoot: root };
		const repository = new JsonlSessionRepo(options);
		const source = new JsonlSessionSearchSource(options);
		const cwd = join(root, "workspace");
		const otherCwd = join(root, "other");
		const session = await repository.create({ id: "jsonl", cwd });
		const entryId = await session.appendMessage(message("jsonl backed auth entry"));
		const other = await repository.create({ id: "other", cwd: otherCwd });
		await other.appendMessage(message("jsonl backed auth entry in another cwd"));
		const index = new InMemoryIndexedSearch<Awaited<ReturnType<typeof session.getMetadata>>>();

		await feedSessionDocumentSnapshot(source, index, { listOptions: { cwd } });

		await expect(index.search({ text: "auth", cwd })).resolves.toMatchObject([
			{ metadata: { id: "jsonl", cwd }, entryId },
		]);
		await expect(index.search({ text: "auth", cwd: otherCwd })).resolves.toEqual([]);
	});

	it("keeps index failures outside canonical session writes", async () => {
		const session = createMemorySession({ id: "session", createdAt: 1, cwd: "/repo" });
		await session.appendMessage(message("before index failure"));
		const source = createSource([session]);
		const failingIndex = {
			async apply(_items: SessionSearchDocumentFeedItem<WorkspaceMetadata>[]) {
				throw new Error("index down");
			},
		};

		await expect(feedSessionDocumentSnapshot(source, failingIndex)).rejects.toThrow("index down");
		await session.appendMessage(message("after index failure"));

		await expect(session.findEntries({ type: "message" })).resolves.toHaveLength(2);
	});
});
