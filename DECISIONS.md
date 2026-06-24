# CLQ Technical Decisions Log

Interfaces are frozen contracts. New fields must be optional. No breaking changes, ever.

All errors are human-readable. No raw stack traces or 'undefined' shown to developers. Every error names a likely cause and a concrete fix.

defineTool() takes a single options object, never positional args, so future optional fields never break existing code.

Protocol translation never touches the network. Transports call into these pure functions. This is what makes adding HTTP in Phase 3 additive, not a rewrite.

Drivers are the only place that touch real I/O. Protocol logic (Stage 4) stays pure and is reused by every driver.

SDK note (Stage 5): @modelcontextprotocol/sdk@^1.29.0 exports matched the planned import paths exactly (`server/index.js` → `Server`, `server/stdio.js` → `StdioServerTransport`, `types.js` → `ListToolsRequestSchema`/`CallToolRequestSchema`), so no path adjustments were needed. One deviation from the draft: `crypto.randomUUID()` is not available as a global in a spawned ESM module on Node 18, so the driver imports `randomUUID` from `node:crypto` instead. The stdio test spawns the compiled fixture with plain `node` (built in `beforeAll`) rather than a `tsx` loader, because `tsx` is not a declared dependency and resolving it at runtime proved unreliable.

createServer() returns a chainable object. .tool() and .use() both return `this`. Adding execution behavior to .use() later is additive — the signature is already final.

Config validation never silently passes through invalid values. Wrong type or missing required var always throws before the server starts, never fails confusingly later mid-request.

Public API surface is exactly three functions — createServer, defineTool, defineConfig — plus the core type contracts. Nothing else is re-exported from the package entry point. Internals (errors/ColloquialErrorImpl, the pure protocol functions, createMCPStdioDriver, loadConfig) stay reachable in-package by direct import but are kept off the public surface so they can change without breaking consumers.

- cac          → CLI argument parsing. Tiny, no bloat.
- execa        → the ONLY sanctioned way anything in the CLI spawns a process.
                 Never node:child_process directly elsewhere in the codebase.
- @clack/prompts → interactive questions for `clq init`. Clean, modern, accessible.
- tsx          → runs the user's TypeScript directly in `clq dev` via `tsx watch`.
                 No separate build step needed for local development.
- node:http    → the `clq inspect` backend. No Express, no framework — every line
                 of the locally-exposed server is hand-written and auditable.
- node:crypto  → session token generation for the inspector.
- Hand-rolled regex patterns → secret scanning in `clq doctor`. Not a third-party
                 library — CLQ owns the redaction guarantee end to end, not a
                 dependency's behavior.

clq dev delegates watching to `tsx watch` rather than implementing a file watcher. On shutdown the signal handler kills the tsx child and awaits its exit before the parent exits — the deliberate fix for orphaned dev processes. Platform note: a real console Ctrl+C runs this handler on every OS, but a *programmatic* kill('SIGINT') on Windows terminates the parent without running handlers, so the dev integration test additionally tree-sweeps by descendant pid and by command-line match in teardown to guarantee zero leaked processes; its core assertion is that the CLI exits within 3s of the signal.