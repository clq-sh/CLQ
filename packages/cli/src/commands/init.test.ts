import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { cac } from "cac"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { resolveSafeTargetPath } from "../utils/safe-path.js"
import { registerInitCommand } from "./init.js"

/** Run `clq init <args>` against the registered command and await the action. */
async function runInit(args: string[]): Promise<void> {
  const cli = cac("clq")
  registerInitCommand(cli)
  cli.parse(["node", "clq", "init", ...args], { run: false })
  await cli.runMatchedCommand()
}

/** Read a directory tree into a { relativePath: contents } map for snapshot comparison. */
function snapshotTree(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else out[path.relative(root, full)] = fs.readFileSync(full, "utf8")
    }
  }
  walk(root)
  return out
}

let workDir: string
let canaryDir: string
let canaryFile: string
let originalCwd: string

beforeEach(() => {
  originalCwd = process.cwd()
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "clq-init-work-"))
  // A sibling directory created BEFORE the traversal test, used to prove that an
  // escape attempt writes nothing outside the working directory.
  canaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "clq-init-canary-"))
  canaryFile = path.join(canaryDir, "untouched.txt")
  fs.writeFileSync(canaryFile, "original")
  process.chdir(workDir)
  process.exitCode = 0
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  process.chdir(originalCwd)
  process.exitCode = 0
  vi.restoreAllMocks()
  fs.rmSync(workDir, { recursive: true, force: true })
  fs.rmSync(canaryDir, { recursive: true, force: true })
})

describe("clq init", () => {
  test("clean scaffold succeeds and renders the project name", async () => {
    await runInit(["my-app"])

    expect(process.exitCode).toBe(0)
    const target = path.join(workDir, "my-app")
    expect(fs.existsSync(target)).toBe(true)

    const pkg = JSON.parse(
      fs.readFileSync(path.join(target, "package.json"), "utf8"),
    ) as { name: string }
    expect(pkg.name).toBe("my-app")

    const config = fs.readFileSync(
      path.join(target, "colloquial.config.ts"),
      "utf8",
    )
    expect(config).toContain('name: "my-app"')
    // No unrendered placeholders should survive anywhere.
    const tree = snapshotTree(target)
    for (const contents of Object.values(tree)) {
      expect(contents).not.toContain("{{projectName}}")
    }
    expect(fs.existsSync(path.join(target, "src", "index.ts"))).toBe(true)
  })

  test("a second run without --force refuses and writes nothing new", async () => {
    await runInit(["dupe"])
    const target = path.join(workDir, "dupe")
    const before = snapshotTree(target)

    process.exitCode = 0
    await runInit(["dupe"])

    expect(process.exitCode).toBe(1)
    const after = snapshotTree(target)
    expect(after).toEqual(before)
  })

  test("--force overwrites an existing non-empty directory", async () => {
    const target = path.join(workDir, "forced")
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(target, "stray.txt"), "pre-existing")

    await runInit(["forced", "--force"])

    expect(process.exitCode).toBe(0)
    // Template files were written over the non-empty directory.
    const pkg = JSON.parse(
      fs.readFileSync(path.join(target, "package.json"), "utf8"),
    ) as { name: string }
    expect(pkg.name).toBe("forced")
  })

  test("a traversal attempt is rejected and the parent stays untouched", async () => {
    await runInit(["../../escape"])

    expect(process.exitCode).toBe(1)
    // Nothing was created inside the working dir...
    expect(fs.readdirSync(workDir)).toHaveLength(0)
    // ...and the pre-existing sibling canary is byte-for-byte unchanged.
    expect(fs.readFileSync(canaryFile, "utf8")).toBe("original")
    expect(fs.existsSync(path.join(canaryDir, "escape"))).toBe(false)
  })
})

describe("resolveSafeTargetPath (defense-in-depth guard)", () => {
  test("throws on a raw traversal path even if it bypassed name validation", () => {
    const original = process.cwd()
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clq-resolve-"))
    try {
      process.chdir(dir)
      expect(() => resolveSafeTargetPath("../../escape")).toThrow(
        /Refusing to write outside/,
      )
    } finally {
      process.chdir(original)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test("accepts a plain in-directory name", () => {
    const original = process.cwd()
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clq-resolve-"))
    try {
      process.chdir(dir)
      const resolved = resolveSafeTargetPath("ok-name")
      expect(resolved).toBe(path.resolve(dir, "ok-name"))
    } finally {
      process.chdir(original)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
