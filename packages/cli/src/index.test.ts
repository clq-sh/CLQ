import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { beforeAll, describe, expect, test } from "vitest"
import { execSafe } from "./utils/exec-safe.js"

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, "../")
const repoRoot = resolve(packageRoot, "../../")
const entryPath = resolve(packageRoot, "dist/index.js")

let version: string

beforeAll(() => {
  // Build the CLI so we exercise the real compiled binary, not the TS source.
  execSync("pnpm --filter @clq-sh/cli build", {
    cwd: repoRoot,
    stdio: "ignore",
  })
  const pkg = JSON.parse(
    readFileSync(resolve(packageRoot, "package.json"), "utf8"),
  ) as { version: string }
  version = pkg.version
}, 60_000)

describe("clq CLI (built binary)", () => {
  test("--version prints the package version", async () => {
    const result = await execSafe("node", [entryPath, "--version"])
    expect(String(result.stdout)).toContain(version)
    expect(result.exitCode).toBe(0)
  })

  test("--help exits 0", async () => {
    const result = await execSafe("node", [entryPath, "--help"])
    expect(result.exitCode).toBe(0)
    expect(String(result.stdout).length).toBeGreaterThan(0)
  })

  test("an unknown command exits non-zero and leaks no stack trace", async () => {
    const result = await execSafe("node", [entryPath, "definitely-not-a-cmd"], {
      reject: false,
    })
    expect(result.exitCode).not.toBe(0)
    const combined = `${String(result.stdout)}\n${String(result.stderr)}`
    expect(combined).not.toContain("at Object.")
    expect(combined).not.toContain("stack")
    expect(combined).toContain("Unknown command")
  })
})
