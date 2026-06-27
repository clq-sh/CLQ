# CLQ Architecture Decisions

## Stage 1 — Core Contracts

- **ColloquialError** — exists to give every framework failure a structured, serializable shape (code + message, optional cause/fix) instead of opaque thrown values.
- **ColloquialContext** — exists to thread per-request identity, correlation, and timing through tools, drivers, and middleware.
- **ColloquialToolDefinition** — exists to describe a single invokable tool: its metadata, schema slots, auth requirements, and typed handler.
- **ColloquialDriver** — exists to abstract a transport/runtime that exposes tools to the outside world via a uniform start/stop lifecycle.
- **ColloquialDriverStartConfig** — exists to define the payload a driver receives at startup, carrying the tool set plus arbitrary transport-specific extras.
- **ColloquialServerConfig** — exists to carry identifying metadata (name + version) for a running server instance.
- **ColloquialMiddleware** — exists to provide named before/after hooks for cross-cutting concerns around tool execution.

## Stage 2 — Error System

Every framework failure is a `ColloquialError` built around a four-field contract that makes errors actionable rather than opaque:

- **code** — a stable, machine-matchable identifier (`/^[A-Z_]+$/`) so callers can branch on error kind without string-matching prose.
- **message** — a one-sentence, human-readable statement of what went wrong.
- **cause** — an optional explanation of *why* it happened (e.g. formatted Zod issues), never a raw stack trace.
- **fix** — an optional concrete, actionable next step the developer can take to resolve it.

`ColloquialErrorImpl` is the throwable `Error` subclass implementing this contract (its `name` is always `'ColloquialError'`), and the `errors` factory catalog mints each well-known framework error so codes, causes, and fixes stay consistent at every call site.

## Stage 3 — defineTool()

`defineTool()` turns a Zod-typed config into a `ColloquialToolDefinition` with validation enforced at **both boundaries**:

- **Input boundary** — every invocation `safeParse`s the raw input against the `input` schema before the real handler runs; a failure throws `TOOL_INVALID_INPUT` and the handler is never called, so handlers only ever see well-typed, validated data.
- **Output boundary** — when an `output` schema is supplied, the handler's return value is `safeParse`d against it and a mismatch throws `TOOL_INVALID_OUTPUT`; with no `output` schema the return value passes through untouched. This guarantees the framework never emits a shape it promised but didn't produce.

The **description is mandatory** and checked eagerly at `defineTool()` call time (not at invocation): an empty or whitespace-only description throws `TOOL_MISSING_DESCRIPTION` immediately. Description quality directly drives **Agentic Experience (AX)** — AI agents read tool descriptions to decide *when* to call a tool, so a missing or vague description causes agents to call tools incorrectly or not at all. Failing fast at definition time keeps a broken tool from ever reaching an agent.

## Stage 4 — Protocol Translation

The `protocol/translate.ts` layer is the **pure, transport-agnostic** boundary between CLQ's internal tool format and the MCP wire format. It contains only pure functions and `async` dispatch — no sockets, no process spawning, no SDK, no I/O — so every function is fully unit-testable in isolation:

- `toolToMCPSchema` — converts one `ColloquialToolDefinition` into an MCP tool descriptor, using `zod-to-json-schema` to turn its Zod `input` into JSON Schema.
- `buildToolsList` — maps a tool set into the MCP `tools/list` payload.
- `dispatchToolCall` — resolves a tool by name and invokes its handler, translating the outcome into the `MCPCallResult` shape: success becomes a JSON text block; an unknown name or a thrown `ColloquialErrorImpl` becomes an `isError` text block; any *unexpected* error is rethrown rather than silently swallowed. It deliberately does **not** re-validate input/output — `defineTool()`'s wrapped handler already owns that, so validation lives in exactly one place.

Because this layer never touches the network, the **same functions are reused unchanged** by the stdio transport (Stage 5), a future HTTP transport (Phase 3), and any other MCP transport. Transports own connections and framing; translation owns meaning.

## Stage 5 — MCP Stdio Driver

`createMCPStdioDriver()` is the **first concrete `ColloquialDriver`** (the interface defined in Stage 1). It wires the pure Stage 4 translation functions into a real MCP server from the official `@modelcontextprotocol/sdk`, served over stdio:

- `start(config)` constructs an SDK `Server`, registers a `ListToolsRequestSchema` handler that returns `buildToolsList(config.tools)`, and a `CallToolRequestSchema` handler that mints a fresh `ColloquialContext` (per-request `requestId` + `timestamp`) and delegates to `dispatchToolCall`. It then connects a `StdioServerTransport`.
- `stop()` closes the transport.

The driver contains **no protocol meaning** — it does not build schemas, validate, or format errors. It only owns I/O (the SDK server, the stdio transport, request context creation). All meaning lives in the pure Stage 4 functions.

This is the key extensibility seam: **adding a second driver — REST, Web3, or any future protocol — means writing a new file that implements the same `ColloquialDriver` interface and calls the same pure functions. Nothing in `core` changes.** The `ColloquialDriver` contract from Stage 1 is what makes transports pluggable.

A standalone fixture (`protocol/test-fixtures/stdio-server.ts`, built by tsup to `dist/test-fixtures/stdio-server.js`) defines two tools and starts the driver; the integration test spawns it as a real child process and drives it with newline-delimited JSON-RPC over stdio.

## Stage 6 — createServer()

`createServer(config)` is the developer-facing entry point: a small **chainable** object that collects tools and middleware, then hands them to a driver on `.start()`.

- `.tool(def)` registers a `ColloquialToolDefinition`, rejecting a duplicate name with `TOOL_DUPLICATE_NAME`, and returns the api for chaining.
- `.use(mw)` registers a `ColloquialMiddleware` and returns the api for chaining.
- `.start(options)` resolves the driver (`'auto'` / unset → `'mcp'`; anything else → `DRIVER_UNKNOWN`), constructs the Stage 5 stdio driver from the server's `name`/`version`, starts it with the registered tools, and returns the driver so callers (e.g. tests) can `.stop()` it.

**`.use()` exists but does nothing yet.** Middleware *execution* (running `before`/`after` hooks around tool calls) is **Phase 3 scope**. This stage deliberately only reserves the API surface: registering middleware is accepted and stored so the method signature is final now and never has to change shape when execution is added later. Reserving the seam early is what keeps adding behavior additive rather than breaking.

## Stage 7 — Config System

The config system splits *declaration* from *loading*, because the two happen at different times:

- `defineConfig(config)` is a **typed declaration only** — a runtime identity function whose value is full TypeScript checking of the config shape (`name`, `version`, and an `env` map of `EnvVarDeclaration`s). It runs at module-import time, when `process.env` is not yet meaningful, so it deliberately reads nothing from the environment.
- `loadConfig(config)` does the **actual reading of `process.env`**, and is called at **server-start time**. For each declared var it coerces the raw string to the declared `type` (`number` via `Number`, `boolean` via `"true"`/`"1"`), applies a `default` when the var is absent, and throws `CONFIG_MISSING_ENV_VAR` when a required var is missing or a number fails to parse.

Keeping loading separate from definition means a config file can be imported anywhere (for its types and metadata) without side effects, while env access is confined to the single, explicit moment the server boots.

## Phase 1 — Complete

**Exit condition met.** `examples/weather-server` is a complete, real MCP server built using *only* the public API — as an external developer with zero knowledge of CLQ internals would. Its integration test (`examples/weather-server/src/index.test.ts`) spawns the built server as a child process and drives it over real stdio JSON-RPC: it passes `initialize`, lists exactly the three tools with valid input schemas, calls each tool with correct results, and — critically — proves that one invalid call returns an `isError` response **without killing the process** (a second valid call immediately afterward still succeeds). This test is green.

**Final public API surface** (`@clq-sh/core`) — exactly three functions plus the core types, nothing more:

- `createServer(config)` — chainable server: `.tool()`, `.use()`, `.start()`.
- `defineTool(config)` — Zod-typed tool with input/output validation at both boundaries.
- `defineConfig(config)` — typed config declaration.
- Types — `ColloquialError`, `ColloquialContext`, `ColloquialToolDefinition`, `ColloquialDriver`, `ColloquialDriverStartConfig`, `ColloquialServerConfig`, `ColloquialMiddleware`.

Everything else built in Phase 1 — the `errors` catalog and `ColloquialErrorImpl`, the pure protocol functions (`toolToMCPSchema`, `buildToolsList`, `dispatchToolCall`), the `createMCPStdioDriver` driver, and `loadConfig` — is **internal**: still used across the package by direct module import, but deliberately not re-exported from the public entry point. Keeping the headline surface tiny is what lets the internals evolve without it being a breaking change.

Phase 1 is the **foundation Phase 2 (CLI) builds on without modifying any of it.** The CLI will orchestrate and scaffold around this API surface; it does not change these contracts. The Stage 1 interfaces remain frozen — future stages add only optional fields, never breaking changes.

## Phase 2, Stage 0 — CLI Bootstrap

`@clq-sh/cli` ships a single binary, `clq` (built ESM-only with a `#!/usr/bin/env node` shebang injected via tsup's `banner`, never hardcoded in source). The entry point reads its own version from `package.json` resolved **relative to the compiled file** (`fileURLToPath(import.meta.url)` → `../package.json`), not `process.cwd()`, so `clq --version` is correct no matter where it's invoked. Commands are registered with `cac`; an unknown command prints a one-line hint to stderr and sets a non-zero exit code. Two top-level guards (`uncaughtException`, `unhandledRejection`) are attached **before anything else runs**, so a failure surfaces as `Error: <message>` — never a raw stack trace.

**`execSafe` is the single chokepoint for all process spawning.** Every subprocess the CLI ever launches goes through `utils/exec-safe.ts`, and nothing else in the codebase touches `node:child_process` directly. This matters for two reasons:

- **Injection prevention** — `execSafe(command, args)` keeps the command and its arguments as strictly separate values (`string`, `string[]`); it never builds a shell string and never passes `shell: true`. There is no place where user-influenced input can be concatenated into a command line and reinterpreted by a shell, so shell-injection is structurally impossible, not merely avoided by careful escaping. The signature is deliberately `(string, string[])` with no `string | string[]` union, so "just pass a whole command string" is not even expressible.
- **Cross-platform correctness** — it delegates to `execa` rather than raw `child_process`, which handles Windows/POSIX path, quoting, and PATH-resolution differences uniformly. One audited wrapper means one place to reason about safety and portability for the entire CLI.

## Phase 2, Stage 1 — clq init

`clq init [project-name]` scaffolds a new project by copying the bundled `templates/default` directory, substituting a single `{{projectName}}` placeholder by **plain string replacement** (`String.prototype.replaceAll`) — never a template engine that evaluates expressions, so template content can never execute code. If no name is given it is prompted for via `@clack/prompts`.

**Path safety is three independent checks, applied in order, any one of which aborts before a single byte is written:**

1. **Validate the slug** — `validateSlug` requires `^[a-z0-9][a-z0-9-]*$`: letters, numbers, hyphens only, starting alphanumeric. A name like `../../escape` fails here immediately because it contains neither — `.` and `/` are not in the allowed set.
2. **Resolve** — `resolveSafeTargetPath` computes `path.resolve(process.cwd(), name)`, normalizing any `.`/`..` segments to a concrete absolute path.
3. **Verify containment** — the resolved path must be `cwd` itself or start with `cwd + path.sep`. Anything that resolved to a sibling or ancestor throws `Refusing to write outside the current directory` and the command exits non-zero.

Checks 1 and 3 are deliberately redundant: the slug rule already makes traversal unexpressible, but the post-resolve containment check is defense-in-depth — if the validation regex were ever loosened, the resolve-then-verify guard still refuses to write outside `cwd`. Only after all three pass (and an existing non-empty directory is either absent or explicitly `--force`d) does any `mkdir`/write happen. The copy walker preserves directory structure and never alters permission bits (no `chmod`).

## Phase 2, Stage 2 — clq add

`clq add <tool-name>` generates a new tool file from `templates/tool.ts.template` into the current project's `src/tools/`, substituting `{{toolName}}` by the same plain-string replacement as `init`. The generated skeleton ships with a **real, non-empty description sentence** (`"TODO: describe what <name> does and when an agent should call it."`), so the file satisfies Phase 1's mandatory-description check the instant it's created — the project builds before the developer has written a word.

Two pieces of shared infrastructure make this stage small:

- **Shared slug validator** — the validator that `init` used for project names was renamed `validateProjectName` → `validateSlug` and is now used by **both** `init` and `add`. Project names and tool names obey the same rule (`^[a-z0-9][a-z0-9-]*$`), so a tool name like `../evil` is rejected before any path work — and, as in Stage 1, a post-join containment check confirms the target resolves strictly inside `src/tools/` as defense-in-depth.
- **Project-root detection** — `findProjectRoot` walks up from `process.cwd()` looking for `colloquial.config.ts` as the project marker, so `clq add` works from anywhere inside a project (e.g. a deeply nested subdirectory), not just its root. The walk is **bounded to 10 levels** and stops at the filesystem root, so a stray invocation outside any project fails fast with a clear message rather than scanning the whole disk. No marker found → no write, non-zero exit.

Templates are **data, not code**: they live under `src/templates/` (excluded from the package `tsconfig` and from biome, since the template's own `src/index.ts` imports `zod` which the CLI itself does not depend on), and tsup mirrors them into `dist/templates/` on build via an `onSuccess` copy so the published binary can find them at runtime.

## Phase 2, Stage 3 — clq dev

`clq dev` starts a hot-reloading dev server. It locates the project root (the same `findProjectRoot` marker walk as `add`), confirms `src/index.ts` exists, then **delegates watching to `tsx watch`** rather than implementing a file watcher itself. This is deliberate: `tsx` already solves TypeScript-aware watching, incremental re-execution, and cross-platform fs-event handling correctly, so CLQ owns none of that complexity. `tsx` is a declared dependency of the CLI (its bin lives in the CLI's own `node_modules`), and execa's `preferLocal` + `localDir` resolve it from there regardless of the user's project, so `clq dev` needs nothing installed globally.

**Shutdown explicitly waits for the child to exit before the parent does.** On `SIGINT`/`SIGTERM`, the handler kills the `tsx` child, `await`s its exit, and only then calls `process.exit(0)`. This ordering is the deliberate fix for the single most common dev-CLI bug: a parent that exits immediately on Ctrl+C leaves the watcher (and the program it spawned) running as **orphaned processes** that hold ports and file locks. Waiting for the child guarantees the whole tree is gone before the CLI returns.

> Platform note: on POSIX a delivered `SIGINT` runs this graceful handler. On Windows a *programmatic* `kill('SIGINT')` (as opposed to a real console Ctrl+C) terminates the process without running the handler, so the integration test additionally performs a process-tree sweep in teardown — capturing the child's descendant pids and matching watcher processes by their command line — to guarantee the test suite itself never leaks a process. The orphan-prevention assertion verified by the test is that the CLI process fully exits within 3 seconds of the signal.

## Phase 2, Stage 4 — clq inspect Backend

`clq inspect` launches a local web inspector. This stage is the **backend only** (no frontend yet) and is the most security-sensitive part of Phase 2.

**Two-process design (inspector parent + project child).** The tool *handlers* are the user's TypeScript, so they must execute in a process that can resolve the project's dependencies. The inspector parent (running in the CLI) spawns the project's `src/index.ts` as a child via `tsx` (the same resolution discipline as `clq dev`), with `CLQ_INSPECT=1` (so the template's `server.start()` is skipped) and `CLQ_INSPECT_REPORT=1`. The child, via the framework's `@clq-sh/core/inspect` reporter, speaks a **newline-delimited JSON protocol over its own stdio**: on startup it writes `{ type: "tools", tools }` (the MCP tool list from `buildToolsList`); for each `{ type: "call", id, name, args }` line the parent writes to the child's stdin, it runs the tool's validated handler and writes back `{ type: "result", id, output }`. The parent holds the tool list in memory and proxies `/api/call` to the child by id.

> Why stdio rather than a second HTTP/IPC port (as one design sketch suggested): keeping the child's channel on stdio means the **entire surface is a single listener** — the parent's one 127.0.0.1 port. There is no second socket to secure, firewall, or accidentally expose. (An in-process `tsx` programmatic import was also evaluated and rejected: `tsImport` does not transpile correctly on the project's Node 18 baseline, and running user handlers inside the CLI process is a worse isolation story than a child.)

**Security — Origin is checked first, unconditionally, before the token.** Every request handler computes the single allowed origin `http://127.0.0.1:<port>` and rejects any request whose `Origin` header doesn't match with `403`, *before* it ever looks at the `x-clq-token` header. Only after origin passes is the token compared; a mismatch is `401`. This ordering matters: a wrong-origin request is refused without the server revealing anything about whether a token would have been accepted, and a browser on a malicious page (which cannot forge `Origin`) is blocked outright. The server binds explicitly to `127.0.0.1` (never `undefined`, never `0.0.0.0`) and exclusively (no port sharing), retrying on `EADDRINUSE` up to 5 incrementing ports. `GET /` is intentionally `404` in this stage (the page that would carry the token in its URL is a later frontend stage). The token is 32 random bytes; the per-call request context id is a UUID.

**Redaction by key-name pattern (defense in depth).** Everything the inspector returns — `/api/tools`, `/api/call` results, and `/api/logs` entries — is passed through `redactSecrets`, which recursively replaces the value of any object key matching `/secret|token|password|api[-_]?key/i` with `"[REDACTED]"`. This is intentionally a coarse, structural rule applied at the boundary regardless of where the data came from, so a handler that returns a credential under a secret-looking key can never leak it through the inspector UI or its logs. Log entries are redacted at insert time and capped at 200.

## Phase 2, Stage 5 — clq inspect Frontend

The inspector UI is a **single hand-written `index.html`** — inline `<style>` and `<script>`, no external assets, no CDN, no bundler, no framework. For Phase 2 this is deliberate: the entire frontend is one auditable file that works fully offline, with nothing to build and no supply chain. It is read once at server start (resolved relative to the compiled file so the source and `dist` layouts match; tsup copies `public/` into `dist/public` on build) and served as a constant in-memory string.

**Serving is an exact-match allowlist, never a path lookup.** Only `GET /` (exact `url.pathname === "/"`) returns the page; there is no `/static/*` wildcard route and the request path is never turned into a filesystem path. A traversal attempt like `/../../../etc/passwd` normalizes to some other pathname, fails the exact `/` match, and falls through to the `/api` Origin+token gate — so directory traversal is structurally impossible, not merely filtered. This one route is the sole exception to the Stage 4 gate: it requires no token, because a top-level browser navigation to `/?token=…` sends no `Origin` header and carries the token the page itself must read. The page is a constant that holds no token and no project data, so serving it ungated adds no trust surface; every `/api/*` route still enforces Origin + token unchanged.

**Token hygiene.** On load the page reads its token from `location.search`, then immediately calls `history.replaceState(null, "", location.pathname)` to strip it from the visible URL (and from history/referrers). It attaches the token to every API call via an `X-CLQ-Token` header through a small `apiFetch` helper; the token is never written to the DOM. The page auto-generates a simple form per tool from its JSON-Schema `properties` (string→text, number→number, boolean→checkbox, everything else→JSON textarea), previews the exact `{ name, args }` JSON before sending, and polls `/api/logs` every 2s rendering the already-redacted entries as-is.

## Phase 2, Stage 6 — clq doctor

`clq doctor` runs a project health check with three independent checks and a non-zero exit if any fail: config validity, dependency installation, and a hardcoded-secret scan. It reuses Phase 1's `loadConfig` for env validation rather than reimplementing it — a missing or mistyped required var surfaces the same `CONFIG_MISSING_ENV_VAR` error (its declared description folded into the message). Because validating `colloquial.config.ts` means importing TypeScript that itself imports `@clq-sh/core`, and the built CLI runs under plain `node`, the config check runs in a short-lived `tsx -e` child whose module resolution is the project itself; it reports only `{ ok, message, fix }` on stdout — the real (possibly secret) env values never cross back.

**The secret-redaction guarantee is an architectural promise, not an incidental behavior.** In `scanFileContent`, the real matched value `m` exists only inside the innermost loop body, where it is used for exactly one thing — `maskValue(m)` — and is then unreferenced. It is never assigned to another variable, never returned, never logged, never placed on the `Finding`. The `Finding` carries `masked` only. `maskValue` reveals at most the first 3 and last 2 characters (short values ≤6 chars are fully starred), so the original is not reconstructable. The unit test enforces this by asserting the full fake secret is not a substring of `JSON.stringify(finding)` at all — the scope boundary is verified, not just the happy-path output.

**`clq doctor` makes zero network calls by design, not by current omission.** Every check is local: filesystem reads for the secret scan and dependency check, and an in-process config validation via a local `tsx` child. There is no telemetry, no "phone home", no remote secret-verification step — a security tool that scans for credentials must never be the thing that exfiltrates them. The hand-rolled regex patterns (rather than a third-party secret-scanning dependency) keep that guarantee owned end to end by CLQ.
