import { execSync, spawn, spawnSync } from "node:child_process"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, "../../")
const repoRoot = resolve(packageRoot, "../../")
const corePath = resolve(repoRoot, "packages/core")
const cliEntry = resolve(packageRoot, "dist/index.js")

// Distinctive value: must not appear anywhere in doctor stdout when leaked.
const FAKE_SECRET = "sk-FAKE-PIPELINE-SECRET-VALUE-DO-NOT-LEAK-E2E99"

// Use a high port range to avoid collision with the unit-test suite (7317+) and other
// services. startInspectServer retries on EADDRINUSE so even if this port is busy the
// test still works — we always parse the actual port from the inspector's stdout.
const E2E_INSPECT_PORT = 17317

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// Process-tree helpers (mirrored from dev.test.ts / server.test.ts so this
// file is fully self-contained and the helpers are the authoritative copy here).
// ---------------------------------------------------------------------------

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0) // signal 0 = existence check; throws ESRCH if gone
    return true
  } catch {
    return false
  }
}

function collectTree(pid: number): number[] {
  try {
    if (process.platform === "win32") {
      const json = execSync(
        'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress"',
      ).toString()
      const parsed = JSON.parse(json) as
        | { ProcessId: number; ParentProcessId: number }[]
        | { ProcessId: number; ParentProcessId: number }
      const all = Array.isArray(parsed) ? parsed : [parsed]
      const byParent = new Map<number, number[]>()
      for (const p of all) {
        const arr = byParent.get(p.ParentProcessId) ?? []
        arr.push(p.ProcessId)
        byParent.set(p.ParentProcessId, arr)
      }
      const out: number[] = []
      const stack = [pid]
      while (stack.length) {
        const cur = stack.pop() as number
        out.push(cur)
        for (const c of byParent.get(cur) ?? []) stack.push(c)
      }
      return out
    }
    const lines = execSync("ps -eo pid=,ppid=").toString().trim().split("\n")
    const byParent = new Map<number, number[]>()
    for (const line of lines) {
      const [cpid, ppid] = line.trim().split(/\s+/).map(Number)
      const arr = byParent.get(ppid) ?? []
      arr.push(cpid)
      byParent.set(ppid, arr)
    }
    const out: number[] = []
    const stack = [pid]
    while (stack.length) {
      const cur = stack.pop() as number
      out.push(cur)
      for (const c of byParent.get(cur) ?? []) stack.push(c)
    }
    return out
  } catch {
    return [pid]
  }
}

function killTree(pids: number[]): void {
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      /* already gone */
    }
  }
}

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
            /* already gone */
          }
        }
      }
    } else {
      const pids = execSync(`pgrep -f "${needle}" || true`).toString().trim()
      for (const line of pids.split("\n")) {
        const pid = Number(line.trim())
        if (pid) {
          try {
            process.kill(pid, "SIGKILL")
          } catch {
            /* already gone */
          }
        }
      }
    }
  } catch {
    /* best effort */
  }
}

async function waitFor(
  getOut: () => string,
  predicate: (out: string) => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate(getOut())) return true
    await sleep(100)
  }
  return predicate(getOut())
}

// ---------------------------------------------------------------------------
// Shared state across the sequential test steps
// ---------------------------------------------------------------------------

let workDir: string
let projectDir: string

// Every PID captured during any test in this file — the afterAll sweeps them all.
const allCapturedPids: number[] = []

function registerPids(pids: number[]): void {
  for (const p of pids) {
    if (!allCapturedPids.includes(p)) allCapturedPids.push(p)
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("CLQ full end-to-end pipeline", () => {
  beforeAll(() => {
    // Build both packages fresh so we test the latest compiled output.
    execSync("pnpm --filter @clq-sh/core build", {
      cwd: repoRoot,
      stdio: "ignore",
    })
    execSync("pnpm --filter @clq-sh/cli build", {
      cwd: repoRoot,
      stdio: "ignore",
    })

    // Working directory OUTSIDE the repo — mkdtempSync guarantees a unique path.
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "clq-e2e-pipeline-"))
    projectDir = path.join(workDir, "e2e-test")
  }, 120_000)

  afterAll(async () => {
    // Belt-and-suspenders sweep: kill any process whose command line still references
    // our unique temp dir (e.g. a tsx watcher orphaned by a Windows SIGINT).
    killByCommandLine(path.basename(workDir))
    await sleep(500)
    killByCommandLine(path.basename(workDir))

    // Final assertion: every PID this test file ever captured must be gone.
    // Note: OS PID reuse is theoretically possible between capture and now, but
    // practically negligible within a test suite. The check is belt-and-suspenders.
    for (const pid of allCapturedPids) {
      expect(
        isPidRunning(pid),
        `PID ${pid} should be gone after test cleanup but is still running`,
      ).toBe(false)
    }

    // Clean up the temp directory (large: has node_modules after step 3).
    if (workDir) {
      fs.rmSync(workDir, {
        recursive: true,
        force: true,
        maxRetries: 25,
        retryDelay: 200,
      })
    }
  })

  // -------------------------------------------------------------------------
  // Step 1 — clq init
  // -------------------------------------------------------------------------
  test("clq init e2e-test scaffolds the expected file tree", () => {
    const result = spawnSync(process.execPath, [cliEntry, "init", "e2e-test"], {
      cwd: workDir,
      encoding: "utf8",
    })
    expect(result.status, "clq init must exit 0").toBe(0)

    // Project directory and required files must exist.
    expect(fs.existsSync(projectDir)).toBe(true)
    for (const rel of [
      "package.json",
      "clq.config.ts",
      "tsup.config.ts",
      "tsconfig.json",
      ".gitignore",
      ".env.example",
      path.join("src", "index.ts"),
    ]) {
      expect(
        fs.existsSync(path.join(projectDir, rel)),
        `${rel} must exist after init`,
      ).toBe(true)
    }

    // .gitignore must exclude node_modules and dist.
    const gitignore = fs.readFileSync(
      path.join(projectDir, ".gitignore"),
      "utf8",
    )
    expect(gitignore).toContain("node_modules/")
    expect(gitignore).toContain("dist/")

    // The {{projectName}} placeholder must be fully replaced everywhere.
    const pkg = JSON.parse(
      fs.readFileSync(path.join(projectDir, "package.json"), "utf8"),
    ) as { name: string }
    expect(pkg.name).toBe("e2e-test")

    const config = fs.readFileSync(
      path.join(projectDir, "clq.config.ts"),
      "utf8",
    )
    expect(config).toContain('name: "e2e-test"')
    expect(config).not.toContain("{{projectName}}")
  })

  // -------------------------------------------------------------------------
  // Step 2 — clq add
  // -------------------------------------------------------------------------
  test("clq add ping-tool creates a valid, non-empty tool file", () => {
    // Note: slug validator allows [a-z0-9-] only (no underscores), so ping-tool
    // is the valid form; ping_tool would be rejected by validateSlug.
    const result = spawnSync(process.execPath, [cliEntry, "add", "ping-tool"], {
      cwd: projectDir,
      encoding: "utf8",
    })
    expect(result.status, "clq add must exit 0").toBe(0)

    const toolFile = path.join(projectDir, "src", "tools", "ping-tool.ts")
    expect(fs.existsSync(toolFile), "tool file must exist").toBe(true)

    const content = fs.readFileSync(toolFile, "utf8")
    // Must contain the tool factory and the rendered name.
    expect(content).toContain("defineTool")
    expect(content).toContain("ping-tool")
    // The scaffolded description sentence must satisfy the mandatory-description
    // check (non-empty). It must not have an empty string description.
    expect(content).not.toContain('description: ""')
    expect(content).toContain("TODO: describe what ping-tool does")
  })

  // -------------------------------------------------------------------------
  // Step 3 — pnpm install + pnpm build
  // -------------------------------------------------------------------------
  test("pnpm install and pnpm build succeed in the scaffolded project", () => {
    const linkType = process.platform === "win32" ? "junction" : "dir"

    // The template uses "workspace:*" for @clq-sh/core, which only resolves inside
    // the monorepo. Remove it from the manifest and symlink the already-built local
    // copy afterward (the same pattern unit tests use). zod, tsup, and typescript
    // are still fetched from the registry — this step genuinely needs network access
    // (documented tradeoff, not solved here).
    const pkgPath = path.join(projectDir, "package.json")
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      dependencies: Record<string, string>
    }
    pkg.dependencies = Object.fromEntries(
      Object.entries(pkg.dependencies).filter(([k]) => k !== "@clq-sh/core"),
    )
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))

    // Real install — fetches zod, tsup, typescript from the registry.
    // Capture stderr so a failure message is visible in the test output.
    try {
      execSync("pnpm install --no-frozen-lockfile", {
        cwd: projectDir,
        stdio: "pipe",
        timeout: 180_000,
      })
    } catch (err) {
      const e = err as { stderr?: Buffer | string; stdout?: Buffer | string }
      throw new Error(
        `pnpm install failed:\nSTDOUT: ${String(e.stdout ?? "")}\nSTDERR: ${String(e.stderr ?? "")}`,
      )
    }

    // Symlink @clq-sh/core AFTER pnpm install so pnpm's virtual-store pass
    // does not touch it. The already-built dist/ in the monorepo is importable.
    const coreDestDir = path.join(projectDir, "node_modules", "@clq-sh")
    fs.mkdirSync(coreDestDir, { recursive: true })
    const coreDest = path.join(coreDestDir, "core")
    if (!fs.existsSync(coreDest)) {
      fs.symlinkSync(corePath, coreDest, linkType)
    }

    // Real build — runs tsup on src/index.ts.
    try {
      execSync("pnpm build", {
        cwd: projectDir,
        stdio: "pipe",
        timeout: 60_000,
      })
    } catch (err) {
      const e = err as { stderr?: Buffer | string; stdout?: Buffer | string }
      throw new Error(
        `pnpm build failed:\nSTDOUT: ${String(e.stdout ?? "")}\nSTDERR: ${String(e.stderr ?? "")}`,
      )
    }

    expect(
      fs.existsSync(path.join(projectDir, "node_modules")),
      "node_modules must exist after pnpm install",
    ).toBe(true)
    expect(
      fs.existsSync(path.join(projectDir, "node_modules", "@clq-sh", "core")),
      "@clq-sh/core must be in node_modules",
    ).toBe(true)
    expect(
      fs.existsSync(path.join(projectDir, "dist", "index.js")),
      "dist/index.js must exist after pnpm build",
    ).toBe(true)
  }, 240_000)

  // -------------------------------------------------------------------------
  // Step 4 — clq doctor (clean project)
  // -------------------------------------------------------------------------
  test("clq doctor exits 0 on a clean project", () => {
    const result = spawnSync(process.execPath, [cliEntry, "doctor"], {
      cwd: projectDir,
      encoding: "utf8",
    })
    expect(result.status, "doctor must exit 0 on a clean project").toBe(0)
    const out = `${result.stdout}${result.stderr}`
    expect(out).toContain("No hardcoded secrets detected")
  }, 60_000)

  // -------------------------------------------------------------------------
  // Step 5 — clq doctor (with injected secret)
  // -------------------------------------------------------------------------
  test("clq doctor exits non-zero and the raw secret value never appears in stdout", () => {
    // Inject into ping-tool.ts (not src/index.ts) so inspect/dev steps keep working.
    const toolFile = path.join(projectDir, "src", "tools", "ping-tool.ts")
    const original = fs.readFileSync(toolFile, "utf8")
    fs.writeFileSync(
      toolFile,
      `// injected for e2e test\nconst token = "${FAKE_SECRET}"\nexport const _t = token\n\n${original}`,
    )

    try {
      const result = spawnSync(process.execPath, [cliEntry, "doctor"], {
        cwd: projectDir,
        encoding: "utf8",
      })
      expect(
        result.status,
        "doctor must exit non-zero when a secret is found",
      ).not.toBe(0)

      const stdout = result.stdout ?? ""
      // The literal secret value must be absent — only a masked form is allowed.
      expect(
        stdout,
        "raw FAKE_SECRET literal must NOT appear in doctor stdout",
      ).not.toContain(FAKE_SECRET)
      // The scanner must have flagged the file.
      expect(stdout).toContain("ping-tool.ts")
    } finally {
      // Restore so subsequent steps (inspect, dev) work with the clean file.
      fs.writeFileSync(toolFile, original)
    }
  }, 60_000)

  // -------------------------------------------------------------------------
  // Step 6 — clq inspect: security assertions + clean SIGINT shutdown
  // -------------------------------------------------------------------------
  test("clq inspect: forged-Origin→403, no-token→401, valid→200, SIGINT exits cleanly", async () => {
    let inspectProc: ChildProcessWithoutNullStreams | undefined
    let inspectTree: number[] = []

    try {
      inspectProc = spawn(process.execPath, [cliEntry, "inspect"], {
        cwd: projectDir,
        env: { ...process.env, CLQ_INSPECT_PORT: String(E2E_INSPECT_PORT) },
      })

      // Register the process itself immediately; the full tree (including the tsx
      // child the inspector spawns) is re-captured after the server is ready.
      if (inspectProc.pid) {
        inspectTree = [inspectProc.pid]
        registerPids(inspectTree)
      }

      let inspectOut = ""
      inspectProc.stdout.on("data", (d: Buffer) => {
        inspectOut += d.toString()
      })
      inspectProc.stderr.on("data", (d: Buffer) => {
        inspectOut += d.toString()
      })

      // Wait for the URL line: "Inspector running at http://127.0.0.1:<port>/?token=<hex>"
      let inspectPort = 0
      let inspectToken = ""
      const ready = await waitFor(
        () => inspectOut,
        (o) => {
          const m = o.match(
            /http:\/\/127\.0\.0\.1:(\d+)\/\?token=([a-f0-9]{64})/,
          )
          if (m) {
            inspectPort = Number(m[1])
            inspectToken = m[2]
            return true
          }
          return false
        },
        40_000,
      )
      expect(ready, "Inspector URL must appear in stdout within 40 s").toBe(
        true,
      )
      expect(inspectPort).toBeGreaterThan(0)
      expect(inspectToken).toHaveLength(64)

      // Capture the full tree now that the tsx child is running.
      if (inspectProc.pid) {
        const fullTree = collectTree(inspectProc.pid)
        registerPids(fullTree)
        inspectTree = fullTree
      }

      const origin = `http://127.0.0.1:${inspectPort}`

      // Security assertion 1 — forged Origin → 403 regardless of token.
      const res403 = await fetch(`${origin}/api/tools`, {
        headers: {
          origin: "http://evil.example.com",
          "x-clq-token": inspectToken,
        },
      })
      expect(res403.status, "forged Origin must yield 403").toBe(403)

      // Security assertion 2 — correct Origin but missing token → 401.
      const res401 = await fetch(`${origin}/api/tools`, {
        headers: { origin },
      })
      expect(res401.status, "missing token must yield 401").toBe(401)

      // Security assertion 3 — correct Origin + correct token → 200.
      const res200 = await fetch(`${origin}/api/tools`, {
        headers: { origin, "x-clq-token": inspectToken },
      })
      expect(res200.status, "valid Origin + token must yield 200").toBe(200)

      // Shut down via SIGINT.
      const exitPromise = new Promise<void>((resolve) => {
        inspectProc?.on("exit", () => resolve())
      })
      inspectProc.kill("SIGINT")
      const exitedInTime = await Promise.race([
        exitPromise.then(() => true),
        sleep(4_000).then(() => false),
      ])

      // On Windows SIGINT terminates the process without running signal handlers, so
      // the tsx child may survive momentarily. Force-kill the full tree and sweep.
      if (!exitedInTime) {
        killTree(inspectTree)
        await sleep(300)
      }

      // The inspect CLI process must be gone.
      expect(
        inspectProc.exitCode !== null || inspectProc.signalCode !== null,
        "inspect process must have exited",
      ).toBe(true)

      // Sweep any lingering tsx child (critical on Windows).
      killByCommandLine(path.basename(workDir))
      await sleep(400)

      // Both the parent and any child it spawned must be gone.
      for (const pid of inspectTree) {
        expect(
          isPidRunning(pid),
          `Inspect PID ${pid} must be gone after SIGINT + sweep`,
        ).toBe(false)
      }
    } finally {
      // Guarantee cleanup even if an assertion threw.
      if (
        inspectProc &&
        inspectProc.exitCode === null &&
        inspectProc.signalCode === null
      ) {
        killTree(
          inspectTree.length
            ? inspectTree
            : inspectProc.pid
              ? [inspectProc.pid]
              : [],
        )
      }
      killByCommandLine(path.basename(workDir))
    }
  }, 60_000)

  // -------------------------------------------------------------------------
  // Step 7 — clq dev: starts watching, exits cleanly on SIGINT, no orphan
  // -------------------------------------------------------------------------
  test("clq dev starts watching and exits cleanly on SIGINT with no orphan processes", async () => {
    let devProc: ChildProcessWithoutNullStreams | undefined
    let devTree: number[] = []

    try {
      devProc = spawn(process.execPath, [cliEntry, "dev"], {
        cwd: projectDir,
      })

      if (devProc.pid) {
        devTree = [devProc.pid]
        registerPids(devTree)
      }

      let devOut = ""
      devProc.stdout.on("data", (d: Buffer) => {
        devOut += d.toString()
      })
      devProc.stderr.on("data", (d: Buffer) => {
        devOut += d.toString()
      })

      // Wait for the "Watching for changes" banner (printed by dev.ts before tsx starts).
      const watching = await waitFor(
        () => devOut,
        (o) => o.includes("Watching for changes"),
        20_000,
      )
      expect(watching, '"Watching for changes" must appear in dev output').toBe(
        true,
      )

      // Capture the full tree (now includes the spawned tsx watch child).
      if (devProc.pid) {
        const fullTree = collectTree(devProc.pid)
        registerPids(fullTree)
        devTree = fullTree
      }

      // SIGINT must lead to a full process exit within 3 seconds.
      const exitPromise = new Promise<void>((resolve) => {
        devProc?.on("exit", () => resolve())
      })
      devProc.kill("SIGINT")
      const exitedInTime = await Promise.race([
        exitPromise.then(() => true),
        sleep(3_000).then(() => false),
      ])

      // Force-kill if the graceful path didn't complete (Windows behaviour).
      if (!exitedInTime) {
        killTree(devTree)
        await sleep(200)
      }

      expect(exitedInTime, "dev process must exit within 3 s of SIGINT").toBe(
        true,
      )

      // Sweep any tsx watcher that may have survived (Windows SIGINT edge case).
      killByCommandLine(path.basename(workDir))
      await sleep(400)

      // Every captured PID from this test must be gone.
      for (const pid of devTree) {
        expect(
          isPidRunning(pid),
          `Dev PID ${pid} must be gone after SIGINT + sweep`,
        ).toBe(false)
      }
    } finally {
      if (devProc && devProc.exitCode === null && devProc.signalCode === null) {
        killTree(devTree.length ? devTree : devProc.pid ? [devProc.pid] : [])
      }
      killByCommandLine(path.basename(workDir))
    }
  }, 40_000)
})
