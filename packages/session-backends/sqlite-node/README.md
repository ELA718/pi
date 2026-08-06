# @earendil-works/pi-session-backend-sqlite-node

Node sqlite session backend for `@earendil-works/pi-agent-core` sessions. Provides the
`node:sqlite` adapter (`SqliteDatabase` implementation), SQLite session repository,
migrations, materialized views, and optional FTS search.

```ts
await using repository = new SqliteSessionRepository(options);
const search = createSqliteSessionSearch(options);
const session = await repository.create({ cwd });
await session.appendMessage(message);
await search.apply([{ type: "rebuild" }]); // or app-level catch-up/indexing
const hits = await search.search({ text: "needle" });
```

The repository lazily owns one shared database connection. Search is an independent
service over the same canonical database: repositories do not expose `search()`,
and FTS indexing is driven explicitly by the search adapter/application rather than
canonical write triggers.
