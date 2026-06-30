import { execSync } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest"
import { type InspectServer, startInspectServer } from "./server.js"

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, "../../../")
const repoRoot = resolve(packageRoot, "../../")
const corePath = resolve(repoRoot, "packages/core")
const cliEntry = resolve(packageRoot, "dist/index.js")
const require = createRequire(import.meta.url)

const FAKE_SECRET = "sk-FAKE-SECRET-VALUE-DO-NOT-LEAK-9999"
const linkType = process.platform === "win32" ? "junction" : "dir"

const PROJECT_ENTRY = `import { createServer, defineTool } from "@clq-sh/core"
import { z } from "zod"

const getSecret = defineTool({
  name: "getSecret",
  description: "Return a secret value for redaction testing.",
  input: z.object({ apiKey: z.string() }),
  output: z.object({ apiKey: z.string(), ok: z.boolean() }),
  handler: async () => ({ apiKey: "${FAKE_SECRET}", ok: true }),
})

export const tools = [getSecret]
const server = createServer({ name: "redact-fixture", version: "0.1.0" })
for (const t of tools) server.tool(t)

if (process.env.CLQ_INSPECT_REPORT) {
  import("@clq-sh/core/inspect").then(({ startInspectReporter }) => {
    startInspectReporter(tools)
  })
}
if (!process.env.CLQ_INSPECT) {
  server.start({ driver: "mcp", transport: "stdio" })
}
`

function linkDep(projectDir: string, name: string, target: string): void {
  const dest = path.join(projectDir, "node_modules", name)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.symlinkSync(target, dest, linkType)
}

let workDir: string
let projectDir: string
let inspector: InspectServer | undefined
let extra: InspectServer | undefined
let blocker: http.Server | undefined

beforeAll(() => {
  // Build core (with the ./inspect subpath) and the CLI so the child can resolve them.
  execSync("pnpm --filter @clq-sh/core build", {
    cwd: repoRoot,
    stdio: "ignore",
  })
  execSync("pnpm --filter @clq-sh/cli build", {
    cwd: repoRoot,
    stdio: "ignore",
  })
}, 120_000)

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "clq-inspect-"))
  execSync(`node "${cliEntry}" init proj`, { cwd: workDir, stdio: "ignore" })
  projectDir = path.join(workDir, "proj")
  // Make the scaffolded project's dependencies resolvable in this throwaway dir.
  const zodDir = dirname(
    require.resolve("zod/package.json", { paths: [corePath] }),
  )
  linkDep(projectDir, "@clq-sh/core", corePath)
  linkDep(projectDir, "zod", zodDir)
  fs.writeFileSync(path.join(projectDir, "src", "index.ts"), PROJECT_ENTRY)
  inspector = undefined
  extra = undefined
  blocker = undefined
})

afterEach(async () => {
  if (inspector) await inspector.close().catch(() => {})
  if (extra) await extra.close().catch(() => {})
  if (blocker) await new Promise<void>((r) => blocker?.close(() => r()))
  // Sweep any leftover tsx child still referencing this run's temp dir.
  killByCommandLine(path.basename(workDir))
  await new Promise((r) => setTimeout(r, 300))
  fs.rmSync(workDir, {
    recursive: true,
    force: true,
    maxRetries: 25,
    retryDelay: 200,
  })
})

afterAll(() => {})
function killByCommandLine(needle: string): void {
  try {
    if (process.platform === "win32") {
      const json = execSync(
        'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"',
      ).toString()
      const parsed = JSON.parse(json) as
        | { ProcessId: number; CommandLine: string | null }[]
        | { ProcessId: number; CommandLine: string | null }
      const all = Array.isArray(parsed) ? parsed : [parsed]
      for (const p of all) {
        if (p.CommandLine?.includes(needle)) {
          try {
            process.kill(p.ProcessId, "SIGKILL")
          } catch {
            /* gone */
          }
        }
      }
    } else {
      execSync(`pkill -f "${needle}" || true`)
    }
  } catch {
    /* best effort */
  }
}

const origin = (port: number) => `http://127.0.0.1:${port}`

describe("clq inspect backend (two-process, security)", () => {
  test("binds to 127.0.0.1 specifically", async () => {
    inspector = await startInspectServer({ root: projectDir })
    const addr = inspector.server.address()
    expect(typeof addr === "object" && addr?.address).toBe("127.0.0.1")
  }, 40_000)

  test("GET / serves the static UI with no token and no Origin", async () => {
    inspector = await startInspectServer({ root: projectDir })
    // A top-level browser navigation: no Origin header, no token. Must still get the page.
    const res = await fetch(`${origin(inspector.port)}/`)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/html")
    const html = await res.text()
    expect(html).toContain("CLQ Inspector")
    // The static asset must never embed the token.
    expect(html).not.toContain(inspector.token)
  }, 40_000)

  test("a traversal path is not served the static file and never leaks host files", async () => {
    inspector = await startInspectServer({ root: projectDir })
    // Only the exact path "/" serves the page; a traversal attempt resolves elsewhere
    // and falls through to the Origin/token gate, never to a filesystem path lookup.
    const res = await fetch(
      `${origin(inspector.port)}/../../../../../../etc/passwd`,
    )
    expect(res.status).not.toBe(200)
    const body = await res.text()
    expect(body).not.toContain("root:")
    expect(body).not.toContain("CLQ Inspector")
  }, 40_000)

  test("forged Origin is rejected with 403 before any token logic", async () => {
    inspector = await startInspectServer({ root: projectDir })
    const res = await fetch(`${origin(inspector.port)}/api/tools`, {
      headers: {
        origin: "http://evil.example.com",
        "x-clq-token": inspector.token,
      },
    })
    expect(res.status).toBe(403)
  }, 40_000)

  test("correct Origin but no token is rejected with 401", async () => {
    inspector = await startInspectServer({ root: projectDir })
    const res = await fetch(`${origin(inspector.port)}/api/tools`, {
      headers: { origin: origin(inspector.port) },
    })
    expect(res.status).toBe(401)
  }, 40_000)

  test("correct Origin + token returns the tool list", async () => {
    inspector = await startInspectServer({ root: projectDir })
    const res = await fetch(`${origin(inspector.port)}/api/tools`, {
      headers: {
        origin: origin(inspector.port),
        "x-clq-token": inspector.token,
      },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { tools: { name: string }[] }
    expect(body.tools.some((t) => t.name === "getSecret")).toBe(true)
  }, 40_000)

  test("a secret-named response field is redacted, never leaked", async () => {
    inspector = await startInspectServer({ root: projectDir })
    const res = await fetch(`${origin(inspector.port)}/api/call`, {
      method: "POST",
      headers: {
        origin: origin(inspector.port),
        "x-clq-token": inspector.token,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "getSecret", args: { apiKey: "given" } }),
    })
    expect(res.status).toBe(200)
    const text = JSON.stringify(await res.json())
    expect(text).not.toContain(FAKE_SECRET)
    expect(text).toContain("[REDACTED]")
  }, 40_000)

  test("an unknown tool name yields a clean 404 JSON error, not a crash", async () => {
    inspector = await startInspectServer({ root: projectDir })
    const res = await fetch(`${origin(inspector.port)}/api/call`, {
      method: "POST",
      headers: {
        origin: origin(inspector.port),
        "x-clq-token": inspector.token,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "does-not-exist", args: {} }),
    })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain("does-not-exist")
    // Server is still responsive afterward.
    const ok = await fetch(`${origin(inspector.port)}/api/tools`, {
      headers: {
        origin: origin(inspector.port),
        "x-clq-token": inspector.token,
      },
    })
    expect(ok.status).toBe(200)
  }, 40_000)

  test("a busy port causes a clean increment, not a throw", async () => {
    // Occupy a port, then ask the inspector to start on it.
    const busyPort = await new Promise<number>((resolvePort) => {
      blocker = http.createServer()
      blocker.listen({ port: 0, host: "127.0.0.1", exclusive: true }, () => {
        const addr = blocker?.address()
        resolvePort(typeof addr === "object" && addr ? addr.port : 0)
      })
    })
    extra = await startInspectServer({ root: projectDir, port: busyPort })
    expect(extra.port).not.toBe(busyPort)
    expect(extra.port).toBeGreaterThan(busyPort)
  }, 40_000)
})
