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
