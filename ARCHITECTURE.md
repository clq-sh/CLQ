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
