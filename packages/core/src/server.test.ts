import { beforeEach, describe, expect, test, vi } from "vitest"
import { z } from "zod"
import { ColloquialErrorImpl } from "./errors.js"
import { startInspectReporter } from "./inspect.js"
import { createMCPStdioDriver } from "./protocol/mcp-stdio-driver.js"
import { defineTool } from "./tool.js"
import type {
  ColloquialContext,
  ColloquialMiddleware,
  ColloquialToolDefinition,
} from "./types.js"

// Mock the driver module so this stays a pure unit test that never touches real stdio.
vi.mock("./protocol/mcp-stdio-driver.js", () => {
  const start = vi.fn(async () => undefined)
  const stop = vi.fn(async () => undefined)
  return {
    createMCPStdioDriver: vi.fn(() => ({ name: "mcp-stdio", start, stop })),
  }
})

// Mock the inspect module so startInspectReporter never actually touches stdio.
vi.mock("./inspect.js", () => ({
  startInspectReporter: vi.fn(),
}))

// Imported after the mock declarations; vi.mock is hoisted so these resolve to the mocks.
import { createServer } from "./server.js"

const mockedCreateDriver = vi.mocked(createMCPStdioDriver)
const mockedStartInspectReporter = vi.mocked(startInspectReporter)

function getDriverSpies() {
  // The factory returns the same shared start/stop spies on every call.
  const driver = mockedCreateDriver.mock.results.at(-1)?.value as
    | { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }
    | undefined
  return driver
}

const toolA = defineTool({
  name: "alpha",
  description: "First tool.",
  input: z.object({ x: z.number() }),
  handler: async ({ input }) => input.x,
})

const toolB = defineTool({
  name: "beta",
  description: "Second tool.",
  input: z.object({ y: z.string() }),
  handler: async ({ input }) => input.y,
})

beforeEach(() => {
  vi.clearAllMocks()
  // Ensure inspect env vars never leak between tests.
  // biome-ignore lint/performance/noDelete: assigning undefined writes the string "undefined" which is truthy — delete is the only way to unset a process.env key
  delete process.env.CLQ_INSPECT_REPORT
  // biome-ignore lint/performance/noDelete: same as above
  delete process.env.CLQ_INSPECT
})

describe("createServer", () => {
  test("start() invokes the driver with the registered tools, in order", async () => {
    const server = createServer({ name: "test-server", version: "1.0.0" })
    server.tool(toolA).tool(toolB)

    await server.start()

    expect(mockedCreateDriver).toHaveBeenCalledWith({
      name: "test-server",
      version: "1.0.0",
    })
    const driver = getDriverSpies()
    expect(driver?.start).toHaveBeenCalledTimes(1)
    expect(driver?.start).toHaveBeenCalledWith({ tools: [toolA, toolB] })
    // Confirm exact order and identity, not just membership.
    const passedTools = driver?.start.mock.calls[0][0].tools
    expect(passedTools).toEqual([toolA, toolB])
    expect(passedTools[0]).toBe(toolA)
    expect(passedTools[1]).toBe(toolB)
  })

  test("registering a duplicate tool name throws TOOL_DUPLICATE_NAME", () => {
    const server = createServer({ name: "s", version: "1.0.0" })
    server.tool(toolA)

    let caught: unknown
    try {
      server.tool(defineTool({ ...toolDefForName("alpha") }))
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(ColloquialErrorImpl)
    expect((caught as ColloquialErrorImpl).code).toBe("TOOL_DUPLICATE_NAME")
    expect((caught as ColloquialErrorImpl).message).toContain("alpha")
  })

  test("use() accepts a middleware object, does not throw, and returns api", () => {
    const server = createServer({ name: "s", version: "1.0.0" })
    const mw: ColloquialMiddleware = {
      name: "logger",
      before: async () => undefined,
      after: async () => undefined,
    }
    expect(() => server.use(mw)).not.toThrow()
    expect(server.use(mw)).toBe(server)
  })

  test("registered middleware before/after hooks are called around tool execution (Fix 4)", async () => {
    const callOrder: string[] = []

    const mw: ColloquialMiddleware = {
      name: "test-mw",
      before: vi.fn(async () => {
        callOrder.push("before")
      }),
      after: vi.fn(async () => {
        callOrder.push("after")
      }),
    }

    const testTool = defineTool({
      name: "mw-target",
      description: "Tool used to verify middleware execution.",
      input: z.object({}),
      handler: async () => {
        callOrder.push("handler")
        return "handler-result"
      },
    })

    const server = createServer({ name: "s", version: "1.0.0" })
    server.tool(testTool).use(mw)
    await server.start()

    const driver = getDriverSpies()
    const passedTools = driver?.start.mock.calls[0][0]
      .tools as ColloquialToolDefinition[]
    expect(passedTools).toHaveLength(1)

    // With middleware registered, the passed tool must be a WRAPPED copy (not original).
    const wrappedTool = passedTools[0]
    expect(wrappedTool).not.toBe(testTool)

    // Invoke the wrapped handler directly and verify hook execution order.
    const ctx = { requestId: "r1", timestamp: Date.now() }
    const result = await wrappedTool.handler({ input: {}, ctx })

    expect(result).toBe("handler-result")
    expect(callOrder).toEqual(["before", "handler", "after"])
    expect(mw.before).toHaveBeenCalledWith(ctx)
    expect(mw.after).toHaveBeenCalledWith(ctx, "handler-result")
  })

  test("with no middleware, original tool objects are passed to the driver unchanged (identity preserved)", async () => {
    const server = createServer({ name: "s", version: "1.0.0" })
    server.tool(toolA).tool(toolB)
    // No .use() call — middleware list is empty.
    await server.start()

    const driver = getDriverSpies()
    const passedTools = driver?.start.mock.calls[0][0].tools
    // applyMiddleware must short-circuit and return the original references.
    expect(passedTools[0]).toBe(toolA)
    expect(passedTools[1]).toBe(toolB)
  })

  test("start() with an unknown driver throws DRIVER_UNKNOWN", async () => {
    const server = createServer({ name: "s", version: "1.0.0" })
    await expect(
      // Cast through unknown: the public type forbids this, the runtime guard catches it.
      server.start({ driver: "something-fake" as unknown as "mcp" }),
    ).rejects.toMatchObject({ code: "DRIVER_UNKNOWN" })
    await expect(
      server.start({ driver: "something-fake" as unknown as "mcp" }),
    ).rejects.toBeInstanceOf(ColloquialErrorImpl)
  })

  test("tool() and use() are chainable and return the same api object", () => {
    const server = createServer({ name: "s", version: "1.0.0" })
    expect(server.tool(toolA)).toBe(server)
    expect(server.tool(toolB)).toBe(server)
    expect(server.use({ name: "mw" })).toBe(server)
  })

  test("'auto' and undefined drivers both resolve to mcp", async () => {
    const server = createServer({ name: "s", version: "1.0.0" })
    await server.start({ driver: "auto" })
    await server.start()
    expect(mockedCreateDriver).toHaveBeenCalledTimes(2)
  })
})

describe("start() inspect modes", () => {
  test("CLQ_INSPECT_REPORT=1 calls startInspectReporter with registered tools and returns a no-op driver", async () => {
    process.env.CLQ_INSPECT_REPORT = "1"
    const server = createServer({ name: "s", version: "1.0.0" })
    server.tool(toolA)

    const driver = await server.start()

    expect(mockedStartInspectReporter).toHaveBeenCalledOnce()
    expect(mockedStartInspectReporter).toHaveBeenCalledWith([toolA])
    expect(driver.name).toBe("inspect-reporter")
    expect(mockedCreateDriver).not.toHaveBeenCalled()
  })

  test("CLQ_INSPECT=1 returns an idle no-op driver without starting MCP or calling inspect reporter", async () => {
    process.env.CLQ_INSPECT = "1"
    const server = createServer({ name: "s", version: "1.0.0" })

    const driver = await server.start()

    expect(driver.name).toBe("inspect-idle")
    expect(mockedCreateDriver).not.toHaveBeenCalled()
    expect(mockedStartInspectReporter).not.toHaveBeenCalled()
  })

  test("no-op driver satisfies ColloquialDriver (has name, callable start, callable stop)", async () => {
    process.env.CLQ_INSPECT_REPORT = "1"
    const server = createServer({ name: "s", version: "1.0.0" })
    const driver = await server.start()

    expect(typeof driver.name).toBe("string")
    expect(typeof driver.start).toBe("function")
    expect(typeof driver.stop).toBe("function")
    await expect(driver.start({ tools: [] })).resolves.toBeUndefined()
    await expect(driver.stop()).resolves.toBeUndefined()
  })
})

/** Helper producing a fresh tool config with a given name (for the duplicate test). */
function toolDefForName(name: string) {
  return {
    name,
    description: "A tool.",
    input: z.object({}),
    handler: async () => undefined,
  }
}

// ---------------------------------------------------------------------------
// Middleware edge-case tests — MIDDLEWARE.md Q2–Q7 coverage.
// Each test extracts the wrapped tool from the mocked driver and calls its
// handler directly so we can observe the exact behavior of applyMiddleware
// without going through the MCP SDK.
// ---------------------------------------------------------------------------

describe("applyMiddleware edge cases (MIDDLEWARE.md review)", () => {
  /** Extract the first tool from the most recent driver.start() call. */
  function getWrappedTool(): ColloquialToolDefinition {
    const driver = getDriverSpies()
    const passedTools = driver?.start.mock.calls[0][0]
      .tools as ColloquialToolDefinition[]
    return passedTools[0]
  }

  const baseCtx = (): ColloquialContext => ({
    requestId: "r-test",
    timestamp: 0,
  })

  // ── Q3: before hook throws ───────────────────────────────────────────────

  test("before hook throws: tool handler is NOT called, after hooks are NOT called, wrapped handler rejects (Q3)", async () => {
    const handlerCalled = vi.fn()
    const afterCalled = vi.fn()

    const mw: ColloquialMiddleware = {
      name: "boom-before",
      before: async () => {
        throw new Error("before-exploded")
      },
      after: afterCalled,
    }
    const tool = defineTool({
      name: "t",
      description: "d",
      input: z.object({}),
      handler: async () => {
        handlerCalled()
        return "should-not-reach"
      },
    })

    const server = createServer({ name: "s", version: "1.0.0" })
    server.tool(tool).use(mw)
    await server.start()

    await expect(
      getWrappedTool().handler({ input: {}, ctx: baseCtx() }),
    ).rejects.toThrow("before-exploded")

    expect(handlerCalled).not.toHaveBeenCalled()
    expect(afterCalled).not.toHaveBeenCalled()
  })

  // ── Q4: after hook throws ────────────────────────────────────────────────

  test("after hook throws: wrapped handler still resolves with the original successful result (Q4)", async () => {
    const handlerCalled = vi.fn()

    const mw: ColloquialMiddleware = {
      name: "boom-after",
      after: async () => {
        throw new Error("after-exploded")
      },
    }
    const tool = defineTool({
      name: "t",
      description: "d",
      input: z.object({}),
      handler: async () => {
        handlerCalled()
        return "successful-result"
      },
    })

    const server = createServer({ name: "s", version: "1.0.0" })
    server.tool(tool).use(mw)
    await server.start()

    // The tool ran and its result is preserved despite the after hook throwing.
    const result = await getWrappedTool().handler({ input: {}, ctx: baseCtx() })
    expect(result).toBe("successful-result")
    expect(handlerCalled).toHaveBeenCalledOnce()
  })

  test("after hook throws: remaining after hooks in the chain STILL RUN (Q4 corollary)", async () => {
    const mw1After = vi.fn()
    const mw1: ColloquialMiddleware = { name: "mw1", after: mw1After }
    const mw2: ColloquialMiddleware = {
      name: "mw2",
      after: async () => {
        throw new Error("mw2-after-boom")
      },
    }

    // Register mw1 first, mw2 second.
    // after-hook order is REVERSE: mw2.after runs before mw1.after.
    // mw2.after throws → mw1.after must still be called (error is caught and logged).
    const tool = defineTool({
      name: "t",
      description: "d",
      input: z.object({}),
      handler: async () => "ok",
    })

    const server = createServer({ name: "s", version: "1.0.0" })
    server.tool(tool).use(mw1).use(mw2)
    await server.start()

    const result = await getWrappedTool().handler({ input: {}, ctx: baseCtx() })
    expect(result).toBe("ok")
    expect(mw1After).toHaveBeenCalledOnce()
  })

  // ── after hook failure: logged, result preserved (regression for FIX2) ───

  test("after hook throws: error is logged via console.error and original result is returned (FIX2 regression)", async () => {
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined)
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

  // ── Q2: exact interleaved order with two middleware ──────────────────────

  test("two middleware: exact interleaved order is mw1.before → mw2.before → handler → mw2.after → mw1.after (Q2)", async () => {
    const log: string[] = []

    const mw1: ColloquialMiddleware = {
      name: "mw1",
      before: async () => {
        log.push("mw1.before")
      },
      after: async () => {
        log.push("mw1.after")
      },
    }
    const mw2: ColloquialMiddleware = {
      name: "mw2",
      before: async () => {
        log.push("mw2.before")
      },
      after: async () => {
        log.push("mw2.after")
      },
    }
    const tool = defineTool({
      name: "t",
      description: "d",
      input: z.object({}),
      handler: async () => {
        log.push("handler")
        return "r"
      },
    })

    const server = createServer({ name: "s", version: "1.0.0" })
    server.tool(tool).use(mw1).use(mw2) // mw1 registered first
    await server.start()

    await getWrappedTool().handler({ input: {}, ctx: baseCtx() })

    expect(log).toEqual([
      "mw1.before",
      "mw2.before",
      "handler",
      "mw2.after",
      "mw1.after",
    ])
  })

  // ── Q5: before hook mutates ctx ──────────────────────────────────────────

  test("before hook that mutates ctx: mutation is visible to the handler; args.input is unaffected (Q5)", async () => {
    type AugmentedCtx = ColloquialContext & { injected?: string }

    const mw: ColloquialMiddleware = {
      name: "ctx-mutator",
      before: async (ctx) => {
        ;(ctx as AugmentedCtx).injected = "from-before"
      },
    }

    let capturedCtx: AugmentedCtx | undefined
    let capturedInput: unknown

    const tool = defineTool({
      name: "t",
      description: "d",
      input: z.object({ payload: z.string() }),
      handler: async ({ input, ctx }) => {
        capturedCtx = ctx as AugmentedCtx
        capturedInput = input
        return (ctx as AugmentedCtx).injected
      },
    })

    const server = createServer({ name: "s", version: "1.0.0" })
    server.tool(tool).use(mw)
    await server.start()

    const result = await getWrappedTool().handler({
      input: { payload: "original-input" },
      ctx: baseCtx(),
    })

    // The before hook's mutation is visible to the handler.
    expect(result).toBe("from-before")
    expect(capturedCtx?.injected).toBe("from-before")

    // The input object was untouched — before hooks have no access to it.
    expect(capturedInput).toEqual({ payload: "original-input" })
  })

  // ── Q6a: after hook mutates an object result ─────────────────────────────

  test("after hook that mutates a result object: the mutation IS reflected in the returned value (Q6a)", async () => {
    const mw: ColloquialMiddleware = {
      name: "result-mutator",
      after: async (_ctx, result) => {
        // result is unknown — cast to mutate
        ;(result as Record<string, unknown>).value = "mutated-by-after"
      },
    }
    const tool = defineTool({
      name: "t",
      description: "d",
      input: z.object({}),
      handler: async () => ({ value: "original" }),
    })

    const server = createServer({ name: "s", version: "1.0.0" })
    server.tool(tool).use(mw)
    await server.start()

    const result = (await getWrappedTool().handler({
      input: {},
      ctx: baseCtx(),
    })) as { value: string }

    // The after hook's mutation is observable in the value returned to the caller.
    expect(result.value).toBe("mutated-by-after")
  })

  // ── Q6b: after hook return value is ignored for a primitive result ────────

  test("after hook 'replacement' return value is ignored: original primitive is returned (Q6b)", async () => {
    const mw: ColloquialMiddleware = {
      name: "result-replacer",
      // TypeScript enforces `Promise<void>` return type, but at runtime we can
      // return a value. The framework must ignore it regardless.
      after: (async (_ctx, _result) => {
        return "attempted-replacement"
      }) as ColloquialMiddleware["after"],
    }
    const tool = defineTool({
      name: "t",
      description: "d",
      input: z.object({}),
      handler: async () => "original-primitive",
    })

    const server = createServer({ name: "s", version: "1.0.0" })
    server.tool(tool).use(mw)
    await server.start()

    const result = await getWrappedTool().handler({
      input: {},
      ctx: baseCtx(),
    })

    // The after hook's return value was discarded; original result is returned.
    expect(result).toBe("original-primitive")
  })
})
