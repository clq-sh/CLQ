import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { execSync } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, "../../")
const fixturePath = resolve(packageRoot, "dist/test-fixtures/stdio-server.js")

let child: ChildProcessWithoutNullStreams
let stdoutBuffer = ""
const pending = new Map<number, (msg: Record<string, unknown>) => void>()

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

function notify(method: string, params: Record<string, unknown> = {}): void {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`)
}

beforeAll(() => {
  // Build the fixture so we can spawn plain `node` with no TS loader dependency.
  execSync("pnpm --filter @clq-sh/core build", {
    cwd: resolve(packageRoot, "../../"),
    stdio: "ignore",
  })

  child = spawn(process.execPath, [fixturePath], {
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

describe("MCP stdio driver (real SDK, spawned process)", () => {
  test("responds to initialize with a well-formed result", async () => {
    const res = await rpc(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "clq-test-client", version: "1.0.0" },
    })

    const result = res.result as Record<string, unknown>
    expect(result).toBeDefined()
    expect(result.protocolVersion).toBeDefined()
    expect(result.capabilities).toMatchObject({ tools: {} })
    expect(result.serverInfo).toMatchObject({ name: "clq-stdio-fixture" })

    // Complete the handshake before issuing further requests.
    notify("notifications/initialized")
  })

  test("tools/list includes both fixture tools by name", async () => {
    const res = await rpc(2, "tools/list")
    const result = res.result as { tools: { name: string }[] }
    const names = result.tools.map((t) => t.name)
    expect(names).toContain("echo")
    expect(names).toContain("add")
  })

  test("tools/call echo with valid args returns the correct text", async () => {
    const res = await rpc(3, "tools/call", {
      name: "echo",
      arguments: { message: "hello-stdio" },
    })
    const result = res.result as {
      content: { type: string; text: string }[]
      isError?: boolean
    }
    expect(result.isError).toBeUndefined()
    expect(result.content[0].type).toBe("text")
    expect(JSON.parse(result.content[0].text)).toEqual({
      echoed: "hello-stdio",
    })
  })

  test("tools/call for a nonexistent tool returns isError without crashing", async () => {
    const res = await rpc(4, "tools/call", {
      name: "does-not-exist",
      arguments: {},
    })
    const result = res.result as {
      content: { type: string; text: string }[]
      isError?: boolean
    }
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("does-not-exist")

    // The process must still be alive — a bad tool name is a handled result, not a crash.
    expect(child.exitCode).toBeNull()
    expect(child.killed).toBe(false)
  })
})
