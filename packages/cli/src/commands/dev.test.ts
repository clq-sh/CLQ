import { execSync, spawn, spawnSync } from "node:child_process"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import fs from "node:fs"
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

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, "../../")
const repoRoot = resolve(packageRoot, "../../")
const cliEntry = resolve(packageRoot, "dist/index.js")

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Collect a process and all descendants so we can guarantee no orphan survives.
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
    // POSIX: walk ps output.
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

/**
 * Kill any process whose command line references `needle`. This is the reliable orphan
 * sweep: a `tsx watch <path>` process always carries the watched path in its command
 * line, so we can find and kill it even if the parent/child pid linkage was severed
 * when the CLI was hard-killed.
 */
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

let workDir: string
let projectDir: string
let child: ChildProcessWithoutNullStreams | undefined
let capturedTree: number[] = []

beforeAll(() => {
  execSync("pnpm --filter @clq-sh/cli build", {
    cwd: repoRoot,
    stdio: "ignore",
  })
}, 60_000)

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "clq-dev-work-"))
  execSync(`node "${cliEntry}" init proj`, { cwd: workDir, stdio: "ignore" })
  projectDir = path.join(workDir, "proj")
  // The scaffolded entry imports @clq-sh/core/zod, which aren't installed in this
  // throwaway project, so replace it with a self-contained long-running script that
  // prints a marker on every run. Counting that marker is a deterministic signal for
  // "tsx is actually watching" and for "a restart happened".
  fs.writeFileSync(
    path.join(projectDir, "src", "index.ts"),
    'console.log("DEV_TEST_RUN")\nsetInterval(() => {}, 1000)\n',
  )
  child = undefined
  capturedTree = []
})

/** Count non-overlapping occurrences of needle in haystack. */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let idx = haystack.indexOf(needle)
  while (idx !== -1) {
    count++
    idx = haystack.indexOf(needle, idx + needle.length)
  }
  return count
}

afterEach(async () => {
  // Guarantee no leaked process survives, even if an assertion failed mid-test.
  // NOTE: a SIGINT-killed child reports exitCode === null with a signalCode set, so
  // we must not re-collect from its now-dead pid (that would lose the real tree).
  // Only capture fresh if we never captured one and the child is genuinely running.
  if (child) {
    const stillRunning = child.exitCode === null && child.signalCode === null
    if (capturedTree.length === 0 && stillRunning && child.pid) {
      capturedTree = collectTree(child.pid)
    }
    killTree(capturedTree.length ? capturedTree : child.pid ? [child.pid] : [])
  }
  // Reliable sweep: kill anything still referencing this run's unique temp dir
  // (e.g. a tsx watcher whose pid linkage was severed by the hard kill).
  killByCommandLine(path.basename(workDir))
  await sleep(400)
  killByCommandLine(path.basename(workDir))
  await sleep(500)
  fs.rmSync(workDir, {
    recursive: true,
    force: true,
    maxRetries: 25,
    retryDelay: 200,
  })
})

afterAll(() => {})

describe("clq dev (built binary, real tsx watch)", () => {
  test("watches, restarts on change, and exits promptly on SIGINT", async () => {
    let out = ""
    child = spawn(process.execPath, [cliEntry, "dev"], { cwd: projectDir })
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString()
    })
    child.stderr.on("data", (d: Buffer) => {
      out += d.toString()
    })

    // 1. Watch banner appears AND tsx has actually started the program once —
    //    waiting for the first run avoids editing before the watcher is ready.
    const watching = await waitFor(
      () => out,
      (o) =>
        o.includes("Watching for changes") &&
        countOccurrences(o, "DEV_TEST_RUN") >= 1,
      15_000,
    )
    expect(watching).toBe(true)

    // 2. A source change triggers a restart: the program runs a second time, and
    //    tsx prints its own restart banner.
    fs.appendFileSync(
      path.join(projectDir, "src", "index.ts"),
      "\n// dev-test touch\n",
    )
    const restarted = await waitFor(
      () => out,
      (o) =>
        countOccurrences(o, "DEV_TEST_RUN") >= 2 &&
        /\[tsx\]|Restarting/i.test(o),
      15_000,
    )
    expect(restarted).toBe(true)

    // 3. SIGINT must lead to a full process exit within 3 seconds — a hang here
    //    fails loudly rather than silently eating vitest's default timeout.
    if (child.pid) capturedTree = collectTree(child.pid)
    const exitPromise = new Promise<void>((resolveExit) => {
      child?.on("exit", () => resolveExit())
    })
    child.kill("SIGINT")
    const exitedInTime = await Promise.race([
      exitPromise.then(() => true),
      sleep(3000).then(() => false),
    ])
    expect(exitedInTime).toBe(true)
    expect(
      child.exitCode === null ? "exited-via-signal" : "exited",
    ).toBeTruthy()
  }, 40_000)

  test("outside any project: fails cleanly without watching", async () => {
    const orphan = fs.mkdtempSync(path.join(os.tmpdir(), "clq-dev-orphan-"))
    try {
      const result = spawnSyncCapture(cliEntry, ["dev"], orphan)
      expect(result.status).not.toBe(0)
      expect(`${result.stdout}${result.stderr}`).toContain(
        "No CLQ project found",
      )
    } finally {
      fs.rmSync(orphan, { recursive: true, force: true })
    }
  })

  test("missing entry file: fails cleanly", async () => {
    fs.rmSync(path.join(projectDir, "src", "index.ts"), { force: true })
    const result = spawnSyncCapture(cliEntry, ["dev"], projectDir)
    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toContain("Entry file not found")
  })
})

/** Run the CLI to completion and capture its result (for the non-watching error paths). */
function spawnSyncCapture(
  entry: string,
  args: string[],
  cwd: string,
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [entry, ...args], {
    cwd,
    encoding: "utf8",
  })
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}
