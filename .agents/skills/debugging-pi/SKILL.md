---
name: debugging-pi
description: >
  Apply Pi Agent Harness repository rules for defects in pi-ai, agent-core, pi-tui, and pi-coding-agent. Use with agentroles-debugging for source, provider/auth, project-trust, CLI-mode, TUI, test, and release-boundary diagnosis in the ELA718/pi fork.
---

# Pi Agent Harness Debugging

Use `$agentroles-debugging` first. This helper supplies only Pi-specific rules.

## Repository contract

- Canonical integration remote: `https://github.com/ELA718/pi.git` as `origin`.
- Canonical source remote: `https://github.com/earendil-works/pi.git` as `upstream`.
- The integration default is live `origin/HEAD`, currently `origin/main`.
- Read root `AGENTS.md`, `README.md`, the affected package manifest and README, and focused docs before work.
- From the repository root, validate:

```bash
test "$(cd "$(git rev-parse --show-toplevel)" && pwd -P)" = "$(pwd -P)"
test "$(git remote get-url origin)" = "https://github.com/ELA718/pi.git"
test "$(git remote get-url upstream)" = "https://github.com/earendil-works/pi.git"
test "$(git symbolic-ref --short refs/remotes/origin/HEAD)" = "origin/main"
git status --short --branch
```

- Fetch `origin` and fetch `upstream` read-only before branching. Base isolated work
  on live `origin/main`. Never push to `upstream` without separate current authority.
- Use one isolated task worktree. Reuse it when the task already supplies one.
- Keep shared checkouts read-only. Leave unrelated files and peer-owned work unchanged.

## Access profiles

Use the smallest profile that proves the affected layer:

- `repository-read`: repository checks above, `node --version`, and manifest or source inspection only.
- `deterministic-test`: add one targeted package test. Use the faux provider for agent or coding-agent provider flows.
- `source-cli`: use `./pi-test.sh --no-env --no-approve --offline` with an empty `PI_CODING_AGENT_DIR` for startup or help proof only. Do not send a provider request.
- `installed-artifact`: run only a supplied npm-installed CLI or standalone Bun binary. Source proof does not prove either artifact.
- `live-auth`: only with separate provider authority; use `pi auth check --provider <id> --no-refresh` without `--credentials`.

If a profile is unavailable, stop with `DEBUG_PI_CAPABILITY_UNAVAILABLE`. Do not use a broader profile or fallback.

Never print `auth.json`, credential environment values, request headers, API keys, OAuth tokens, or provider payloads. Never run `auth print-api-key`, `auth print-bearer-token`, or `auth check --credentials`. `/debug` writes full messages to `~/.pi/agent/pi-debug.log`; `PI_TUI_WRITE_LOG` records raw terminal output. Treat both as sensitive, redact before sharing, and do not commit them.

## Owning layers

- `packages/ai` owns provider catalogs, auth resolution, wire adapters, streaming events, and faux-provider behavior.
- `packages/agent` owns agent state, message conversion, turns, tool execution, queues, and event settlement.
- `packages/tui` owns terminal input, width, components, focus, and main/fullscreen rendering.
- `packages/coding-agent` owns CLI parsing, interactive/print/JSON/RPC modes, sessions, project trust, resources, and package integration.
- Trace failures through these layers and repair the first owning layer. Do not patch every downstream caller.
- Source runs use `./pi-test.sh` through tsx. npm `dist` and standalone Bun resolve assets differently through `packages/coding-agent/src/config.ts`; reproduce the reported form.
- Project trust only guards project resource loading. It is not a sandbox. Use `--no-approve` by default; use `--approve` only when trust behavior is the defect.

## Verification

Choose the narrowest check that covers the change:

```bash
cd packages/ai && node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/<file>.test.ts
cd packages/agent && node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/<file>.test.ts
cd packages/tui && node --test test/<file>.test.ts
cd packages/coding-agent && node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/<file>.test.ts
```

- Coding-agent suite tests use `test/suite/harness.ts` and the faux provider. Issue regressions go in `test/suite/regressions/<issue>-<slug>.test.ts`.
- Do not run the full Vitest suite. Use root `./test.sh` only when broad non-e2e proof is required. Never use real keys or paid calls for tests.
- After code changes, run root `npm run check`. Documentation-only changes need `git diff --check`, not build or test.
- TUI changes need a focused `packages/tui` or `interactive-tui` test and controlled tmux proof from `AGENTS.md`. Capture and inspect before/after screenshots for visual changes. Record terminal size, input, pane output, and exit status without sensitive content.
- A source run does not prove npm packaging, Bun assets, or release binaries. Test those only from an authorized supplied artifact.

## Completion

Commit only when the user asks, and then commit only task-owned files. Record changed files, commit SHA, profile, exact commands and exit codes, TUI proof, trust choice, credential-safe evidence, and residual risks.

A claim or debugging request does not authorize a commit, provider login/logout,
trust persistence, package install/update, credential changes, push, PR, merge,
publish, deploy, restart, or release. Get separate current authority for each mutation.

Releases are separate work: all packages version together, release smoke checks use Node and Bun artifacts outside the repository, and tag CI publishes npm and GitHub assets. Follow root `AGENTS.md`; never run release scripts or treat a branch commit as released behavior without explicit release authority.
