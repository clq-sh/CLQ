# Middleware Implementation Review

**Date:** 2026-07-02  
**Scope:** `applyMiddleware()` in `packages/core/src/server.ts` only.  
**Pre-review test count:** 175 tests, 18 files (all passing).

---

## 1. Behavior Summary

### Q1 — Full implementation and call site

**`applyMiddleware` (server.ts lines 20–38):**
```ts
function applyMiddleware(
  tools: ColloquialToolDefinition[],
  middleware: ColloquialMiddleware[],
): ColloquialToolDefinition[] {
  if (middleware.length === 0) return tools
  return tools.map((tool) => ({
    ...tool,
    handler: async (args: { input: unknown; ctx: ColloquialContext }) => {
      for (const mw of middleware) {
        await mw.before?.(args.ctx)
      }
      const result = await tool.handler(args)
      for (const mw of [...middleware].reverse()) {
        await mw.after?.(args.ctx, result)
      }
      return result
    },
  }))
}
```

**Call site (server.ts line 90):**
```ts
await driver.start({ tools: applyMiddleware(tools, middleware) })
```

This is the ONLY place `applyMiddleware` is called. It is called once, at `start()` time, on the MCP driver path only. The inspect paths (`CLQ_INSPECT_REPORT`, `CLQ_INSPECT`) do not call `applyMiddleware`.

---

### Q2 — Execution order for multiple middleware

For `middleware = [mw1, mw2]`, the order is:

```
mw1.before → mw2.before → handler → mw2.after → mw1.after
```

**Why — tracing the code:**

`before` hooks:
```ts
for (const mw of middleware) {  // iterates [mw1, mw2] in registration order
  await mw.before?.(args.ctx)
}
```
First mw1.before, then mw2.before. Sequential. Registration order.

`after` hooks:
```ts
for (const mw of [...middleware].reverse()) {  // creates [mw2, mw1] — reversed copy
  await mw.after?.(args.ctx, result)
}
```
First mw2.after, then mw1.after. Sequential. Reverse registration order.

This is the standard "onion" stack pattern: mw1 wraps mw2 wraps the handler. It is implemented correctly for the happy path.

---

### Q3 — What happens if a `before` hook throws

If `mw.before?.(args.ctx)` throws or rejects:

1. The `await` re-throws inside the async wrapped handler function.
2. The handler function's returned Promise **rejects immediately**.
3. `tool.handler(args)` is **never called** — the line is never reached.
4. All `after` hooks (for all middleware, including the one that threw's `after`) are **never called** — the for-loop for `after` is also never reached.
5. If multiple before hooks are registered, any hooks after the throwing one are also skipped.

**What the MCP client receives:** Confirmed by reading `_onrequest` in the MCP SDK (`protocol.js` lines 371, 398–416). The SDK wraps all request handler calls in `.then(onSuccess, onError)`. The error path sends a JSON-RPC error response:
```js
{ jsonrpc: "2.0", id: request.id, error: { code: InternalError, message: error.message } }
```
If the error is a `ColloquialErrorImpl`, `dispatchToolCall` (translate.ts line 50–58) catches it first and returns a clean `{ isError: true, content: [...] }` MCP result. If it is a plain Error, `dispatchToolCall` re-throws (translate.ts line 59), and the MCP SDK converts it to a JSON-RPC InternalError response.

**The MCP server process does NOT crash.** The SDK's `_onrequest` always catches handler failures and converts them to protocol responses.

---

### Q4 — What happens if an `after` hook throws

If `mw.after?.(args.ctx, result)` throws or rejects after the handler has already run successfully:

1. The handler ran to completion. `result` holds the successful return value.
2. The `await` re-throws inside the wrapped handler.
3. **`result` is lost.** The wrapped handler's returned Promise rejects. `return result` is never reached.
4. Any remaining `after` hooks further down the reversed list are **skipped**.
5. The caller (`dispatchToolCall`) receives a rejection, not the successful result.
6. The MCP client receives an error response (either `{ isError: true }` for a `ColloquialErrorImpl` or a JSON-RPC InternalError for a plain Error).

**This is a correctness bug, not a crash.** A tool that executed successfully will appear to the MCP client as if it errored, because a post-execution hook failed. There is no way for the framework or the client to distinguish "tool failed" from "tool succeeded but after-hook failed." The successful result is silently discarded.

---

### Q5 — What happens if a `before` hook mutates the input args

`before` hooks receive ONLY `args.ctx` — they have no access to `args.input`:
```ts
await mw.before?.(args.ctx)  // only ctx is passed
```

The hook signature is `(ctx: ColloquialContext) => Promise<void>`. There is no mechanism to touch the input.

However, because `args.ctx` is passed by reference to the `before` hook AND is the same object that the handler receives via `args.ctx`:
```ts
const result = await tool.handler(args)  // args.ctx is the same object
```

**A `before` hook CAN mutate the `ctx` object, and those mutations ARE visible to the handler.** For example, an auth middleware that sets `ctx.user = { id: "u123" }` in `before` will cause the handler to see `ctx.user` populated. This is observable and likely intended — it is the standard pattern for auth/identity injection.

**`args.input` is completely inaccessible to `before` hooks.** It cannot be mutated or replaced through the middleware interface.

---

### Q6 — What happens if an `after` hook mutates or replaces the handler's return value

The `after` hook receives `result` as a function argument:
```ts
await mw.after?.(args.ctx, result)
```

Two cases:

**Case A — mutation of a result object (by property assignment):**
`result` is passed by reference. If `result` is an object and the after hook mutates one of its properties (e.g., `result.field = "new"`), those mutations affect the same object that the `result` variable in the outer scope points to. When the loop finishes and `return result` executes, the mutated version is returned. Subsequent after hooks in the loop see the already-mutated object.

**This means after hooks can silently transform a tool's output by mutating object properties.** This is an unguarded side channel — there is nothing in the framework preventing an after hook from altering the result object before it reaches the MCP client.

**Case B — attempting to replace the result (by returning a new value from the after function):**
The after hook's return value is discarded by `await`. The `result` variable in the outer scope is never reassigned. If `result` is a primitive (string, number, boolean), no mutation is possible — the original value is returned.

**Summary:** After hooks CAN mutate object results by reference (side effect is observable and returned to the client). After hooks CANNOT replace a result entirely via their return value — the return value is always ignored.

---

### Q7 — Timeout protection for hung middleware hooks

**There is none.**

If any `before` or `after` hook returns a Promise that never resolves, `await mw.before?.(args.ctx)` or `await mw.after?.(args.ctx, result)` hangs indefinitely. The wrapped handler's Promise never settles. The tool call never completes. The `result` (if `before` hung) or the computed result (if `after` hung) is never returned.

The MCP SDK does have a client-initiated request timeout (`RequestTimeout` in protocol.js), but that is a client-side deadline. On the server side, the hung `await` holds its Promise and associated closure (including the `args` and `ctx` objects) in memory forever (or until the process exits). No watchdog, deadline, or circuit-breaker exists within `applyMiddleware`.

**This is a known limitation.** Implementing a server-side timeout requires async control flow (Promise.race, AbortController, or similar), which is non-trivial and carries correctness risk. It is documented here but not fixed in this pass (see Section 4).

---

### Q8 — Middleware scoping: per-tool vs. universal

All registered middleware is applied to all tools uniformly. There is no scoping mechanism. `applyMiddleware(tools, middleware)` wraps every tool in the array with every middleware in the list. There is no way to register middleware for a specific tool name or tag.

Middleware is bound at `start()` call time. Calling `.use()` after `start()` adds middleware to the array but has no effect on already-started tool calls because `applyMiddleware` already ran and returned wrapped tool objects; the MCP driver holds references to those wrapped objects, not to the `middleware` array.

---

## 2. New Tests Added

All tests are in `packages/core/src/server.test.ts`.

### Test 1 — `before` hook throws: handler and all after hooks are skipped, wrapped handler rejects

Proves Q3. No such test existed. The wrapped handler must reject, the tool handler must not run, and after hooks must not run.

### Test 2 — `after` hook throws: the successful tool result is lost, wrapped handler rejects

Proves Q4. No such test existed. The tool runs to completion and produces a result, but because the after hook throws, the wrapped handler rejects with the hook's error, not the result. The result is unrecoverable.

### Test 3 — Two middleware, exact interleaved order: `mw1.before → mw2.before → handler → mw2.after → mw1.after`

Proves Q2. The existing test uses only one middleware; this test uses two and asserts the exact 5-element order of a shared log array.

### Test 4 — `before` hook that mutates `ctx`: mutations are visible to the handler; `args.input` is not accessible to the hook

Proves Q5. The before hook writes `ctx.injected = "from-before"`. The handler reads `(ctx as Record<string, unknown>).injected` and returns it. The assertion is that the handler received the mutated ctx value. A second assertion confirms the handler also received the original input unchanged.

### Test 5 — `after` hook that mutates a result object: mutation IS reflected in the returned value

Proves Q6 Case A. The handler returns `{ value: "original" }`. The after hook mutates `result.value = "mutated"`. The wrapped handler resolves to `{ value: "mutated" }`.

### Test 6 — `after` hook that "replaces" a primitive result: replacement is ignored, original is returned

Proves Q6 Case B. The handler returns the string `"original"`. The after hook (via a type cast to bypass TypeScript's `void` return type) returns `"replacement"`. The wrapped handler resolves to `"original"` — the after hook's return value was discarded.

### Test 7 — `after` hook throw skips remaining after hooks (only tested implicitly via Test 2, confirmed explicitly)

The test for Q4 registers mw1 (before+after) and mw2 (before, after that throws). Confirms mw1.after is never called when mw2.after throws.

---

## 3. Fixes Made Under Part C

**None.** Neither Part C condition was met:

1. **Throwing before/after hooks do NOT crash the MCP server process.** Confirmed by reading the MCP SDK's `_onrequest` implementation in `protocol.js`. The SDK wraps all request handler calls in `.then(onSuccess, onError)`. Any rejection from the handler — including a re-thrown plain Error from `dispatchToolCall` — is caught by the `onError` branch, which sends a JSON-RPC InternalError response to the client. The process continues running.

2. **Hung hooks block indefinitely** — this is the second Part C condition, but the instruction explicitly says not to implement a timeout unless it is trivial and low-risk, and to prefer documenting it as a known limitation. It is documented in Section 4.

The `after`-throws-loses-result correctness problem (Q4) is a design flaw but is not listed among the Part C conditions (crash or indefinite hang). It is documented here and tested but not fixed.

---

## 4. Unsafe Behavior Found But Not Fixed

### Known limitation 1 — A hung middleware hook blocks the server indefinitely (no timeout)

**Severity: High operational risk.** If any middleware `before` or `after` hook never resolves (e.g., hangs on a network call with no timeout, or deadlocks), the tool call never returns a result or error. The MCP client will eventually time out on its side, but on the server side the promise chain is stuck forever. If the MCP transport is sequential (which stdio is in practice), this blocks ALL subsequent tool calls, not just the hung one — the server becomes permanently unresponsive to any further requests from that client session.

**Why not fixed:** Implementing a reliable per-call timeout requires `Promise.race` against a deadline, with an `AbortController` or similar to signal the middleware to stop. This is non-trivial async plumbing that could interact badly with the middleware's own async resources (open connections, locks, etc.). A timeout that kills the middleware Promise but leaves the middleware's resources in an undefined state is worse than no timeout. This needs deliberate design, not a rushed fix.

**Recommended resolution (for a future pass):** Accept a `signal: AbortSignal` in the `ColloquialContext` that the framework sets with a per-call deadline. Middleware hooks that respect the signal can abort early; hooks that don't will be abandoned when the signal fires. This is a public API change and requires a proper design discussion.

---

### Known limitation 2 — A throwing `after` hook silently discards a successful tool result

**Severity: Medium.** A tool that ran to completion and returned a valid result will appear as an error to the MCP client if any registered `after` hook throws. There is no distinction in the error response between "tool failed" and "tool succeeded but post-execution middleware failed." The user sees an error; the tool's side effects may have already happened (file written, API called, etc.).

**Why not fixed:** Not listed as a Part C condition. Fixing it would require either: (a) catching after-hook errors separately and logging/swallowing them (which would silently hide middleware bugs), or (b) returning the successful result AND surfacing the after-hook error separately (which the MCP protocol has no standard mechanism for). Both choices have significant trade-offs.

**Recommended resolution (for a future pass):** Decide on a policy: either after-hook errors are logged-and-swallowed (the tool call succeeds from the client's perspective), or after-hook errors are surfaced as a side-channel (e.g., a warning in the MCP response metadata). The current behavior — silently replacing the success with an error — is the worst of both options.

---

### Known limitation 3 — `after` hooks can silently mutate result objects

**Severity: Low (footgun).** After hooks receive the result object by reference and can mutate its properties. Those mutations propagate to the returned value without any indication to the tool handler that its output was altered. There is no copy or seal of the result before it is passed to after hooks.

This can be useful (an after hook could add metadata to every response), but it is also a footgun: a bug in any middleware hook can corrupt every tool's output silently. The tool's declared output schema (if any) has already been validated before the after hook runs, so a mutating after hook can produce values that violate the output schema.

**Why not fixed:** Not a crash or hang. The behavior is consistent with how most middleware systems work. Documenting it is sufficient.

---

## 5. Final Test Suite Output

```
 RUN  v2.1.9 E:/CLQ/CLQ

 ✓ packages/cli/src/__e2e__/full-flow.test.ts (7 tests) 41649ms
   ✓ CLQ full end-to-end pipeline > clq init e2e-test scaffolds the expected file tree 488ms
   ✓ CLQ full end-to-end pipeline > clq add ping-tool creates a valid, non-empty tool file 474ms
   ✓ CLQ full end-to-end pipeline > pnpm install and pnpm build succeed in the scaffolded project 12526ms
   ✓ CLQ full end-to-end pipeline > clq doctor exits 0 on a clean project 2127ms
   ✓ CLQ full end-to-end pipeline > clq doctor exits non-zero and the raw secret value never appears in stdout 2062ms
   ✓ CLQ full end-to-end pipeline > clq inspect: forged-Origin→403, no-token→401, valid→200, SIGINT exits cleanly 4404ms
   ✓ CLQ full end-to-end pipeline > clq dev starts watching and exits cleanly on SIGINT with no orphan processes 2933ms
 ✓ packages/cli/src/commands/inspect/server.test.ts (16 tests) 124969ms
   ✓ clq inspect backend (two-process, security) > binds to 127.0.0.1 specifically 2982ms
   ✓ clq inspect backend (two-process, security) > GET / serves the static UI with no token and no Origin 7951ms
   ✓ clq inspect backend (two-process, security) > a traversal path is not served the static file and never leaks host files 7990ms
   ✓ clq inspect backend (two-process, security) > forged Origin is rejected with 403 before any token logic 7940ms
   ✓ clq inspect backend (two-process, security) > no Origin header + valid token is accepted (browser same-origin fetch) 7910ms
   ✓ clq inspect backend (two-process, security) > no Origin header + no token is rejected with 401 7897ms
   ✓ clq inspect backend (two-process, security) > correct Origin but no token is rejected with 401 7881ms
   ✓ clq inspect backend (two-process, security) > correct Origin + token returns the tool list 7860ms
   ✓ clq inspect backend (two-process, security) > a secret-named response field is redacted, never leaked 7976ms
   ✓ clq inspect backend (two-process, security) > an unknown tool name yields a clean 404 JSON error, not a crash 7973ms
   ✓ clq inspect backend (two-process, security) > child crash before tool registration rejects within 5 s with actionable error 2237ms
   ✓ clq inspect backend (two-process, security) > a busy port causes a clean increment, not a throw 2958ms
   ✓ clq inspect backend (two-process, security) > credential-named response fields are redacted in /api/call (Finding 2 regression) 7940ms
   ✓ clq inspect backend (two-process, security) > credential-named fields are redacted in /api/logs after a call (Finding 2 regression) 7940ms
   ✓ clq inspect backend (two-process, security) > /api/logs enforces auth: no token → 401, wrong origin → 403, valid → 200 7891ms
   ✓ clq inspect backend (two-process, security) > call log is capped at 200 entries and oldest entries are evicted first 7934ms
 ✓ packages/core/src/server.test.ts (18 tests) 30ms
 ✓ packages/cli/src/commands/dev.test.ts (3 tests) 13749ms
   ✓ clq dev (built binary, real tsx watch) > watches, restarts on change, and exits promptly on SIGINT 5460ms
   ✓ clq dev (built binary, real tsx watch) > outside any project: fails cleanly without watching 3056ms
   ✓ clq dev (built binary, real tsx watch) > missing entry file: fails cleanly 3041ms
 ✓ packages/core/src/config.test.ts (12 tests) 13ms
 ✓ packages/cli/src/commands/init.test.ts (9 tests) 155ms
 ✓ packages/cli/src/build-templates.test.ts (5 tests) 2375ms
 ✓ packages/core/src/protocol/translate.test.ts (8 tests) 17ms
 ✓ packages/cli/src/commands/doctor.test.ts (4 tests) 23511ms
   ✓ clq doctor (built CLI, spawned) > a clean project exits 0 2188ms
   ✓ clq doctor (built CLI, spawned) > a missing required env var exits non-zero and names its description 2296ms
   ✓ clq doctor (built CLI, spawned) > a wrong-type env var exits non-zero and the raw secret value never appears in stdout (Finding 1 regression) 2839ms
   ✓ clq doctor (built CLI, spawned) > an injected secret exits non-zero and the raw value never appears in stdout 2347ms
 ✓ packages/core/src/protocol/mcp-stdio-driver.test.ts (4 tests) 13623ms
   ✓ MCP stdio driver (real SDK, spawned process) > responds to initialize with a well-formed result 609ms
 ✓ packages/core/src/tool.test.ts (6 tests) 23ms
 ✓ packages/cli/src/commands/add.test.ts (4 tests) 118ms
 ✓ packages/core/src/errors.test.ts (35 tests) 17ms
 ✓ packages/cli/src/utils/redact.test.ts (37 tests) 18ms
 ✓ packages/cli/src/utils/secret-scan.test.ts (5 tests) 56ms
 ✓ packages/core/src/types.test.ts (4 tests) 5ms
 ✓ packages/cli/src/index.test.ts (3 tests) 4119ms
   ✓ clq CLI (built binary) > --version prints the package version 587ms
   ✓ clq CLI (built binary) > --help exits 0 513ms
   ✓ clq CLI (built binary) > an unknown command exits non-zero and leaks no stack trace 565ms
 ✓ packages/cli/src/utils/exec-safe.test.ts (2 tests) 200ms

 Test Files  18 passed (18)
       Tests  182 passed (182)
    Start at  02:50:18
    Duration  236.81s (transform 888ms, setup 0ms, collect 3.07s, tests 224.64s, environment 8ms, prepare 4.01s)
```

**Result: 100% pass — 182/182 tests, 18/18 test files. Count increased from 175 → 182 (+7 tests in `server.test.ts`).**
