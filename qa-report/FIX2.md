# FIX2: After-hook failures no longer discard a successful tool result

## What changed

**File:** `packages/core/src/server.ts`  
**Function:** `applyMiddleware` (line ~32–37)

### Before

```typescript
for (const mw of [...middleware].reverse()) {
  await mw.after?.(args.ctx, result)
}
return result
```

If any `after` hook threw or rejected, the `await` propagated the rejection out of the wrapped handler, discarding the already-computed `result`. The MCP client received a failure even though the tool had succeeded.

### After

```typescript
for (const mw of [...middleware].reverse()) {
  try {
    await mw.after?.(args.ctx, result)
  } catch (err) {
    console.error(err)
  }
}
return result
```

Each `after` hook is now wrapped in its own try/catch. A throwing hook:
- Has its error logged via `console.error` (the project's existing error-logging convention, matching `packages/core/src/protocol/test-fixtures/stdio-server.ts:27`).
- Does **not** interrupt the remaining `after` hooks in the chain.
- Does **not** prevent the original successful `result` from being returned.

`before` hook behavior is **unchanged** — a throwing `before` hook still propagates and rejects the wrapped handler.

## Tests changed

### `packages/core/src/server.test.ts`

#### 1. Updated — Q4 main test (was asserting old buggy behavior)

Old title: `"after hook throws: the successful tool result is LOST and wrapped handler rejects (Q4)"`  
New title: `"after hook throws: wrapped handler still resolves with the original successful result (Q4)"`

Changed assertion from:
```typescript
await expect(
  getWrappedTool().handler({ input: {}, ctx: baseCtx() }),
).rejects.toThrow("after-exploded")
```
To:
```typescript
const result = await getWrappedTool().handler({ input: {}, ctx: baseCtx() })
expect(result).toBe("successful-result")
expect(handlerCalled).toHaveBeenCalledOnce()
```

#### 2. Updated — Q4 corollary test (was asserting remaining hooks are skipped)

Old title: `"after hook throws: remaining after hooks in the chain are also skipped (Q4 corollary)"`  
New title: `"after hook throws: remaining after hooks in the chain STILL RUN (Q4 corollary)"`

Changed assertions from:
```typescript
await expect(
  getWrappedTool().handler({ input: {}, ctx: baseCtx() }),
).rejects.toThrow("mw2-after-boom")
expect(mw1After).not.toHaveBeenCalled()
```
To:
```typescript
const result = await getWrappedTool().handler({ input: {}, ctx: baseCtx() })
expect(result).toBe("ok")
expect(mw1After).toHaveBeenCalledOnce()
```

#### 3. Added — FIX2 regression test

```typescript
test("after hook throws: error is logged via console.error and original result is returned (FIX2 regression)", async () => {
  const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
  const afterError = new Error("after-hook-logged-error")

  const mw: ColloquialMiddleware = {
    name: "boom-after-logged",
    after: async () => {
      throw afterError
    },
  }
  const tool = defineTool({
    name: "t",
    description: "d",
    input: z.object({}),
    handler: async () => "logged-test-result",
  })

  const server = createServer({ name: "s", version: "1.0.0" })
  server.tool(tool).use(mw)
  await server.start()

  const result = await getWrappedTool().handler({ input: {}, ctx: baseCtx() })

  expect(result).toBe("logged-test-result")
  expect(consoleSpy).toHaveBeenCalledWith(afterError)

  consoleSpy.mockRestore()
})
```

This test:
- Registers an `after` hook that throws a specific `Error` instance.
- Asserts the wrapped handler **resolves** (does not reject) with the original result `"logged-test-result"`.
- Asserts `console.error` was called with the exact thrown error object.

## Full test suite output

```
 ✓ packages/cli/src/__e2e__/full-flow.test.ts (7 tests) 61982ms
 ✓ packages/core/src/server.test.ts (19 tests) 45ms
 ✓ packages/cli/src/commands/inspect/server.test.ts (16 tests) 131249ms
 ✓ packages/cli/src/commands/dev.test.ts (3 tests) 13660ms
 ✓ packages/core/src/config.test.ts (12 tests) 11ms
 ✓ packages/cli/src/commands/init.test.ts (9 tests) 196ms
 ✓ packages/cli/src/build-templates.test.ts (5 tests) 2409ms
 ✓ packages/core/src/protocol/translate.test.ts (8 tests) 18ms
 ✓ packages/cli/src/commands/doctor.test.ts (4 tests) 23276ms
 ✓ packages/core/src/protocol/mcp-stdio-driver.test.ts (4 tests) 12029ms
 ✓ packages/core/src/tool.test.ts (6 tests) 15ms
 ✓ packages/cli/src/commands/add.test.ts (4 tests) 117ms
 ✓ packages/core/src/errors.test.ts (35 tests) 18ms
 ✓ packages/cli/src/utils/redact.test.ts (37 tests) 18ms
 ✓ packages/cli/src/utils/secret-scan.test.ts (5 tests) 49ms
 ✓ packages/core/src/types.test.ts (4 tests) 4ms
 ✓ packages/cli/src/index.test.ts (3 tests) 3910ms
 ✓ packages/cli/src/utils/exec-safe.test.ts (2 tests) 158ms

 Test Files  18 passed (18)
       Tests  183 passed (183)
    Duration  262.18s
```

Note: two tests emit expected `stderr` lines (the `Error: after-exploded` and `Error: mw2-after-boom` traces). These come from the `console.error` call in the fixed `applyMiddleware` — those tests do not mock `console.error`, so the caught errors are printed to stderr, but all assertions pass. The FIX2 regression test mocks `console.error` via `vi.spyOn` to suppress output and assert the call.

## Confirmation nothing else was touched

Only two files were modified:

| File | Change |
|------|--------|
| `packages/core/src/server.ts` | `applyMiddleware`: added try/catch around `await mw.after?.(...)` with `console.error(err)` |
| `packages/core/src/server.test.ts` | Updated 2 Q4 tests + added 1 FIX2 regression test |

No other source files, config files, or tests were modified.
