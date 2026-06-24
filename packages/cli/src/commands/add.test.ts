import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { cac } from "cac"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { registerAddCommand } from "./add.js"
import { registerInitCommand } from "./init.js"

/** Run `clq init <args>` against the registered command and await the action. */
async function runInit(args: string[]): Promise<void> {
  const cli = cac("clq")
  registerInitCommand(cli)
  cli.parse(["node", "clq", "init", ...args], { run: false })
  await cli.runMatchedCommand()
}

/** Run `clq add <args>` against the registered command and await the action. */
async function runAdd(args: string[]): Promise<void> {
  const cli = cac("clq")
  registerAddCommand(cli)
  cli.parse(["node", "clq", "add", ...args], { run: false })
  await cli.runMatchedCommand()
}

let workDir: string
let projectDir: string
let originalCwd: string

beforeEach(async () => {
  originalCwd = process.cwd()
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "clq-add-work-"))
  process.exitCode = 0
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})

  // Scaffold a real project with the actual init command — no hand-rolled structure.
  process.chdir(workDir)
  await runInit(["proj"])
  projectDir = path.join(workDir, "proj")
  process.exitCode = 0
})

afterEach(() => {
  process.chdir(originalCwd)
  process.exitCode = 0
  vi.restoreAllMocks()
  fs.rmSync(workDir, { recursive: true, force: true })
})

describe("clq add", () => {
  test("adds a tool inside a valid project", async () => {
    process.chdir(projectDir)
    await runAdd(["greet"])

    expect(process.exitCode).toBe(0)
    const toolFile = path.join(projectDir, "src", "tools", "greet.ts")
    expect(fs.existsSync(toolFile)).toBe(true)

    const contents = fs.readFileSync(toolFile, "utf8")
    expect(contents).not.toContain("{{toolName}}")
    expect(contents).toContain('name: "greet"')
    // The generated description is a real non-empty sentence (passes Phase 1's check).
    expect(contents).toContain(
      "TODO: describe what greet does and when an agent should call it.",
    )
  })

  test("finds the project root from a nested subdirectory", async () => {
    const nested = path.join(projectDir, "src", "deep", "nested")
    fs.mkdirSync(nested, { recursive: true })
    process.chdir(nested)

    await runAdd(["fromdeep"])

    expect(process.exitCode).toBe(0)
    // Written at the project root's src/tools, not under the nested cwd.
    expect(
      fs.existsSync(path.join(projectDir, "src", "tools", "fromdeep.ts")),
    ).toBe(true)
    expect(fs.existsSync(path.join(nested, "fromdeep.ts"))).toBe(false)
  })

  test("outside any project: fails cleanly and writes nothing", async () => {
    const orphan = fs.mkdtempSync(path.join(os.tmpdir(), "clq-add-orphan-"))
    try {
      process.chdir(orphan)
      await runAdd(["lonely"])

      expect(process.exitCode).toBe(1)
      expect(fs.readdirSync(orphan)).toHaveLength(0)
    } finally {
      process.chdir(workDir)
      fs.rmSync(orphan, { recursive: true, force: true })
    }
  })

  test("duplicate tool name refuses without --force, succeeds with it", async () => {
    process.chdir(projectDir)
    const toolFile = path.join(projectDir, "src", "tools", "dup.ts")

    await runAdd(["dup"])
    expect(process.exitCode).toBe(0)

    // Mark the file so we can prove --force actually rewrote it.
    fs.writeFileSync(toolFile, "// hand-edited\n")

    process.exitCode = 0
    await runAdd(["dup"])
    expect(process.exitCode).toBe(1)
    expect(fs.readFileSync(toolFile, "utf8")).toBe("// hand-edited\n")

    process.exitCode = 0
    await runAdd(["dup", "--force"])
    expect(process.exitCode).toBe(0)
    const rewritten = fs.readFileSync(toolFile, "utf8")
    expect(rewritten).toContain('name: "dup"')
    expect(rewritten).not.toBe("// hand-edited\n")
  })
})
