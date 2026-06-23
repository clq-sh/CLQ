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
