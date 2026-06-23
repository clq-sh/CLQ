import { execSync } from "node:child_process"
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, "../")
const repoRoot = resolve(packageRoot, "../../")
const entryPath = resolve(packageRoot, "dist/index.js")

let child: ChildProcessWithoutNullStreams
let stdoutBuffer = ""
const pending = new Map<number, (msg: Record<string, unknown>) => void>()

/** Send a JSON-RPC request and resolve with the response carrying the matching id. */
function rpc(
  id: number,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 5000,
): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      rejectPromise(
        new Error(`Timed out waiting for response to id=${id} (${method})`),
      )
    }, timeoutMs)

    pending.set(id, (msg) => {
      clearTimeout(timer)
      resolvePromise(msg)
    })

    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
    )
  })
}

/** Fire-and-forget JSON-RPC notification (no id, no response expected). */
function notify(method: string, params: Record<string, unknown> = {}): void {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`)
}

beforeAll(() => {
  // Build core (the dependency) then the example, so we spawn plain `node` with no loader.
  execSync("pnpm --filter @clq-sh/core build", {
    cwd: repoRoot,
    stdio: "ignore",
  })
  execSync("pnpm --filter weather-server build", {
    cwd: repoRoot,
    stdio: "ignore",
  })

  child = spawn(process.execPath, [entryPath], {
    cwd: packageRoot,
    stdio: ["pipe", "pipe", "pipe"],
  })

  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (chunk: string) => {
    stdoutBuffer += chunk
    let newlineIndex = stdoutBuffer.indexOf("\n")
    while (newlineIndex !== -1) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim()
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1)
      if (line) {
        const msg = JSON.parse(line) as Record<string, unknown>
        if (typeof msg.id === "number" && pending.has(msg.id)) {
          const resolver = pending.get(msg.id)
          pending.delete(msg.id)
          resolver?.(msg)
        }
      }
      newlineIndex = stdoutBuffer.indexOf("\n")
    }
  })
}, 60_000)

afterAll(() => {
  child?.kill()
})

type CallResult = {
  content: { type: string; text: string }[]
  isError?: boolean
}

describe("weather-server example (real public API, spawned process)", () => {
  test("responds to initialize, then accepts initialized notification", async () => {
    const res = await rpc(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "weather-test-client", version: "1.0.0" },
    })
    const result = res.result as Record<string, unknown>
    expect(result.protocolVersion).toBeDefined()
    expect(result.serverInfo).toMatchObject({ name: "weather-server" })

    // No response expected; this must not crash the server.
    notify("notifications/initialized")
    expect(child.exitCode).toBeNull()
  })

  test("tools/list returns exactly the 3 tools, each with an inputSchema", async () => {
    const res = await rpc(2, "tools/list")
    const result = res.result as {
      tools: { name: string; inputSchema: { type?: string } }[]
    }
    const names = result.tools.map((t) => t.name).sort()
    expect(names).toEqual(
      ["convert_temperature", "get_weather", "list_supported_cities"].sort(),
    )
    expect(result.tools).toHaveLength(3)
    for (const tool of result.tools) {
      expect(tool.inputSchema).toBeDefined()
      expect(tool.inputSchema.type).toBe("object")
    }
  })

  test("get_weather for 'Addis Ababa' returns 22 / sunny", async () => {
    const res = await rpc(3, "tools/call", {
      name: "get_weather",
      arguments: { location: "Addis Ababa" },
    })
    const result = res.result as CallResult
    expect(result.isError).toBeUndefined()
    const payload = JSON.parse(result.content[0].text)
    expect(payload).toEqual({ temperature: 22, condition: "sunny" })
  })

  test("a bad call (missing required arg) errors but the server stays responsive", async () => {
    // First: invalid call — missing required `location`.
    const bad = await rpc(4, "tools/call", {
      name: "get_weather",
      arguments: {},
    })
    const badResult = bad.result as CallResult
    expect(badResult.isError).toBe(true)
    expect(badResult.content[0].text).toContain("get_weather")

    // Immediately after: a valid call must still succeed — proving no crash.
    const good = await rpc(5, "tools/call", {
      name: "get_weather",
      arguments: { location: "London" },
    })
    const goodResult = good.result as CallResult
    expect(goodResult.isError).toBeUndefined()
    expect(JSON.parse(goodResult.content[0].text)).toEqual({
      temperature: 14,
      condition: "cloudy",
    })

    expect(child.exitCode).toBeNull()
    expect(child.killed).toBe(false)
  })

  test("convert_temperature for 0°C returns fahrenheit 32", async () => {
    const res = await rpc(6, "tools/call", {
      name: "convert_temperature",
      arguments: { celsius: 0 },
    })
    const result = res.result as CallResult
    expect(result.isError).toBeUndefined()
    expect(JSON.parse(result.content[0].text)).toEqual({ fahrenheit: 32 })
  })

  test("list_supported_cities returns the hardcoded city list", async () => {
    const res = await rpc(7, "tools/call", {
      name: "list_supported_cities",
      arguments: {},
    })
    const result = res.result as CallResult
    expect(result.isError).toBeUndefined()
    const payload = JSON.parse(result.content[0].text) as { cities: string[] }
    expect(payload.cities).toContain("Addis Ababa")
    expect(payload.cities).toContain("London")
  })
})
