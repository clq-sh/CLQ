import { execSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest"
import { execSafe } from "../utils/exec-safe.js"

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, "../../")
const repoRoot = resolve(packageRoot, "../../")
const corePath = resolve(repoRoot, "packages/core")
const cliEntry = resolve(packageRoot, "dist/index.js")
const linkType = process.platform === "win32" ? "junction" : "dir"

const FAKE_SECRET = `ghp_${"Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3h2"}`

let workDir: string

/** Write a minimal CLQ project; `envBlock` is inlined into colloquial.config.ts. */
function scaffold(opts: { envBlock?: string; secretFile?: boolean }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clq-doctor-"))
  const envPart = opts.envBlock ? `, env: ${opts.envBlock}` : ""
  fs.writeFileSync(
    path.join(dir, "colloquial.config.ts"),
    `import { defineConfig } from "@clq-sh/core"\nexport default defineConfig({ name: "doc-fixture", version: "0.1.0"${envPart} })\n`,
  )
  fs.mkdirSync(path.join(dir, "src"), { recursive: true })
  fs.writeFileSync(
    path.join(dir, "src", "index.ts"),
    opts.secretFile
      ? `// oops, hardcoded\nconst token = "${FAKE_SECRET}"\nexport const x = token\n`
      : "export const x = 1\n",
  )
  // Make @clq-sh/core resolvable so the config can be imported (also creates node_modules).
  const dest = path.join(dir, "node_modules", "@clq-sh", "core")
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.symlinkSync(corePath, dest, linkType)
  return dir
}

function runDoctor(cwd: string) {
  return execSafe("node", [cliEntry, "doctor"], {
    cwd,
    env: { ...process.env },
    preferLocal: true,
    localDir: here,
    reject: false,
  })
}

beforeAll(() => {
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
  workDir = ""
})

afterEach(() => {
  if (workDir) {
    fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 10 })
  }
})

describe("clq doctor (built CLI, spawned)", () => {
  test("a clean project exits 0", async () => {
    workDir = scaffold({})
    const result = await runDoctor(workDir)
    expect(result.exitCode).toBe(0)
    expect(String(result.stdout)).toContain("No hardcoded secrets detected")
  }, 60_000)

  test("a missing required env var exits non-zero and names its description", async () => {
    workDir = scaffold({
      envBlock: `{ UPSTREAM_KEY: { type: "string", description: "The upstream service key." } }`,
    })
    // Ensure the var is absent for the spawned child (exclude it via destructuring).
    const { UPSTREAM_KEY: _omit, ...childEnv } = process.env
    const result = await execSafe("node", [cliEntry, "doctor"], {
      cwd: workDir,
      env: childEnv,
      extendEnv: false,
      preferLocal: true,
      localDir: here,
      reject: false,
    })
    expect(result.exitCode).not.toBe(0)
    const out = String(result.stdout)
    expect(out).toContain("Config check failed")
    expect(out).toContain("The upstream service key.")
  }, 60_000)

  test("an injected secret exits non-zero and the raw value never appears in stdout", async () => {
    workDir = scaffold({ secretFile: true })
    const result = await runDoctor(workDir)
    expect(result.exitCode).not.toBe(0)
    const out = String(result.stdout)
    // The scanner flagged it...
    expect(out).toContain("GitHub token")
    // ...the full raw secret is NOWHERE in the output...
    expect(out).not.toContain(FAKE_SECRET)
    // ...only a masked form (first 3 + last 2) is shown.
    expect(out).toContain(FAKE_SECRET.slice(0, 3))
    expect(out).toContain(FAKE_SECRET.slice(-2))
  }, 60_000)
})
