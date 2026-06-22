# CLQ Architecture Decisions

## Stage 1 — Core Contracts

- **ColloquialError** — exists to give every framework failure a structured, serializable shape (code + message, optional cause/fix) instead of opaque thrown values.
- **ColloquialContext** — exists to thread per-request identity, correlation, and timing through tools, drivers, and middleware.
- **ColloquialToolDefinition** — exists to describe a single invokable tool: its metadata, schema slots, auth requirements, and typed handler.
- **ColloquialDriver** — exists to abstract a transport/runtime that exposes tools to the outside world via a uniform start/stop lifecycle.
- **ColloquialDriverStartConfig** — exists to define the payload a driver receives at startup, carrying the tool set plus arbitrary transport-specific extras.
- **ColloquialServerConfig** — exists to carry identifying metadata (name + version) for a running server instance.
- **ColloquialMiddleware** — exists to provide named before/after hooks for cross-cutting concerns around tool execution.
