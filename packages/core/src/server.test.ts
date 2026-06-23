import { beforeEach, describe, expect, test, vi } from "vitest"
import { z } from "zod"
import { ColloquialErrorImpl } from "./errors.js"
import { createMCPStdioDriver } from "./protocol/mcp-stdio-driver.js"
import { defineTool } from "./tool.js"
import type { ColloquialMiddleware } from "./types.js"

// Mock the driver module so this stays a pure unit test that never touches real stdio.
vi.mock("./protocol/mcp-stdio-driver.js", () => {
  const start = vi.fn(async () => undefined)
  const stop = vi.fn(async () => undefined)
  return {
    createMCPStdioDriver: vi.fn(() => ({ name: "mcp-stdio", start, stop })),
  }
})

// Imported after the mock declaration; vi.mock is hoisted so this resolves to the mock.
import { createServer } from "./server.js"

const mockedCreateDriver = vi.mocked(createMCPStdioDriver)

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

/** Helper producing a fresh tool config with a given name (for the duplicate test). */
function toolDefForName(name: string) {
  return {
    name,
    description: "A tool.",
    input: z.object({}),
    handler: async () => undefined,
  }
}
