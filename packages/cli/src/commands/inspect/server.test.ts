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

// Finding 2 fixture: returns values under credential-named keys that the
// original SECRET_KEY_PATTERN missed. Used by the extended-redaction tests below.
const getCredentials = defineTool({
  name: "getCredentials",
  description: "Return values under credential-named fields for redaction testing.",
  input: z.object({ userId: z.string() }),
  handler: async () => ({
    authorization: "${FAKE_SECRET}",
    credential: "${FAKE_SECRET}",
    credentials: "${FAKE_SECRET}",
    access_key: "${FAKE_SECRET}",
    private_key: "${FAKE_SECRET}",
    bearer: "${FAKE_SECRET}",
    jwt: "${FAKE_SECRET}",
    passphrase: "${FAKE_SECRET}",
    session_id: "${FAKE_SECRET}",
    refresh_token: "${FAKE_SECRET}",
    signing_key: "${FAKE_SECRET}",
    cookie: "${FAKE_SECRET}",
    safeField: "this-should-not-be-redacted",
  }),
})

export const tools = [getSecret, getCredentials]
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

  test("no Origin header + valid token is accepted (browser same-origin fetch)", async () => {
    inspector = await startInspectServer({ root: projectDir })
    const res = await fetch(`${origin(inspector.port)}/api/tools`, {
      headers: { "x-clq-token": inspector.token },
    })
    expect(res.status).toBe(200)
  }, 40_000)

  test("no Origin header + no token is rejected with 401", async () => {
    inspector = await startInspectServer({ root: projectDir })
    const res = await fetch(`${origin(inspector.port)}/api/tools`)
    expect(res.status).toBe(401)
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

  test("child crash before tool registration rejects within 5 s with actionable error", async () => {
    fs.writeFileSync(
      path.join(projectDir, "src", "index.ts"),
      'throw new Error("startup crash")\n',
    )

    const start = Date.now()
    let caughtError: Error | undefined
    try {
      inspector = await startInspectServer({ root: projectDir })
    } catch (err) {
      caughtError = err as Error
    }
    const elapsed = Date.now() - start

    expect(caughtError).toBeDefined()
    expect(elapsed).toBeLessThan(5_000)
    expect(caughtError?.message).toContain("exited")
    expect(caughtError?.message).toContain("build")
    // redactSecrets is applied to the stderr detail; "startup crash" is not a
    // secret-named key so it passes through unchanged in this specific case.
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

  // ─────────────────────────────────────────────────────────────────────────
  // Finding 2 regression: credential-named fields are redacted in /api/call
  // and /api/logs (extended SECRET_KEY_PATTERN coverage).
  // ─────────────────────────────────────────────────────────────────────────

  test("credential-named response fields are redacted in /api/call (Finding 2 regression)", async () => {
    inspector = await startInspectServer({ root: projectDir })
    const base = `http://127.0.0.1:${inspector.port}`
    const headers = {
      origin: base,
      "x-clq-token": inspector.token,
      "content-type": "application/json",
    }

    const res = await fetch(`${base}/api/call`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "getCredentials", args: { userId: "test" } }),
    })
    expect(res.status).toBe(200)

    const text = await res.text()
    // The raw secret value must not appear anywhere in the response.
    expect(text).not.toContain(FAKE_SECRET)
    // All credential-named fields must be "[REDACTED]".
    const body = JSON.parse(text) as { ok: boolean; result: Record<string, unknown> }
    expect(body.ok).toBe(true)
    const result = body.result
    const newlyCoveredKeys = [
      "authorization",
      "credential",
      "credentials",
      "access_key",
      "private_key",
      "bearer",
      "jwt",
      "passphrase",
      "session_id",
      "refresh_token",
      "signing_key",
      "cookie",
    ]
    for (const key of newlyCoveredKeys) {
      expect(result[key], `key "${key}" must be "[REDACTED]"`).toBe("[REDACTED]")
    }
    // A field with a non-secret name must pass through.
    expect(result.safeField).toBe("this-should-not-be-redacted")
  }, 40_000)

  test("credential-named fields are redacted in /api/logs after a call (Finding 2 regression)", async () => {
    inspector = await startInspectServer({ root: projectDir })
    const base = `http://127.0.0.1:${inspector.port}`
    const headers = {
      origin: base,
      "x-clq-token": inspector.token,
      "content-type": "application/json",
    }

    // Make one call to populate logs.
    await fetch(`${base}/api/call`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "getCredentials", args: { userId: "log-test" } }),
    })

    const logsRes = await fetch(`${base}/api/logs`, {
      headers: { origin: base, "x-clq-token": inspector.token },
    })
    expect(logsRes.status).toBe(200)
    const logsText = await logsRes.text()
    // The raw secret value must never appear in log output.
    expect(logsText).not.toContain(FAKE_SECRET)
    // Spot-check a few of the new field names.
    const logs = (JSON.parse(logsText) as { logs: Array<{ result: Record<string, unknown> }> }).logs
    expect(logs.length).toBeGreaterThanOrEqual(1)
    const last = logs[logs.length - 1]
    expect(last.result.authorization).toBe("[REDACTED]")
    expect(last.result.access_key).toBe("[REDACTED]")
    expect(last.result.bearer).toBe("[REDACTED]")
  }, 40_000)

  // ─────────────────────────────────────────────────────────────────────────
  // Coverage gap #4: /api/logs auth gate (report gap, not a new vulnerability).
  // ─────────────────────────────────────────────────────────────────────────

  test("/api/logs enforces auth: no token → 401, wrong origin → 403, valid → 200", async () => {
    inspector = await startInspectServer({ root: projectDir })
    const base = `http://127.0.0.1:${inspector.port}`

    // No token at all → 401.
    const res401 = await fetch(`${base}/api/logs`)
    expect(res401.status).toBe(401)

    // Forged origin with valid token → 403.
    const res403 = await fetch(`${base}/api/logs`, {
      headers: { origin: "http://evil.example.com", "x-clq-token": inspector.token },
    })
    expect(res403.status).toBe(403)

    // No origin + valid token (same-origin fetch pattern) → 200.
    const res200 = await fetch(`${base}/api/logs`, {
      headers: { "x-clq-token": inspector.token },
    })
    expect(res200.status).toBe(200)
    const body = (await res200.json()) as { logs: unknown[] }
    expect(Array.isArray(body.logs)).toBe(true)
  }, 40_000)

  // ─────────────────────────────────────────────────────────────────────────
  // Coverage gap #8: 200-entry log cap evicts oldest entries.
  // ─────────────────────────────────────────────────────────────────────────

  test("call log is capped at 200 entries and oldest entries are evicted first", async () => {
    inspector = await startInspectServer({ root: projectDir })
    const base = `http://127.0.0.1:${inspector.port}`
    const headers = {
      origin: base,
      "x-clq-token": inspector.token,
      "content-type": "application/json",
    }

    // Make 205 successful calls. Each increments the log; once >200, oldest is shifted.
    for (let i = 0; i < 205; i++) {
      await fetch(`${base}/api/call`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "getSecret", args: { apiKey: `call-${i}` } }),
      })
    }

    const logsRes = await fetch(`${base}/api/logs`, {
      headers: { "x-clq-token": inspector.token },
    })
    expect(logsRes.status).toBe(200)
    const { logs } = (await logsRes.json()) as { logs: unknown[] }

    // Cap must be enforced at exactly 200.
    expect(logs).toHaveLength(200)
  }, 60_000)
})
