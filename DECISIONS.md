# CLQ Technical Decisions Log

Interfaces are frozen contracts. New fields must be optional. No breaking changes, ever.

All errors are human-readable. No raw stack traces or 'undefined' shown to developers. Every error names a likely cause and a concrete fix.

defineTool() takes a single options object, never positional args, so future optional fields never break existing code.

Protocol translation never touches the network. Transports call into these pure functions. This is what makes adding HTTP in Phase 3 additive, not a rewrite.

Drivers are the only place that touch real I/O. Protocol logic (Stage 4) stays pure and is reused by every driver.

SDK note (Stage 5): @modelcontextprotocol/sdk@^1.29.0 exports matched the planned import paths exactly (`server/index.js` → `Server`, `server/stdio.js` → `StdioServerTransport`, `types.js` → `ListToolsRequestSchema`/`CallToolRequestSchema`), so no path adjustments were needed. One deviation from the draft: `crypto.randomUUID()` is not available as a global in a spawned ESM module on Node 18, so the driver imports `randomUUID` from `node:crypto` instead. The stdio test spawns the compiled fixture with plain `node` (built in `beforeAll`) rather than a `tsx` loader, because `tsx` is not a declared dependency and resolving it at runtime proved unreliable.

createServer() returns a chainable object. .tool() and .use() both return `this`. Adding execution behavior to .use() later is additive — the signature is already final.
