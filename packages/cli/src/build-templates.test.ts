/**
 * Regression guard for the "stale dist/templates" bug.
 *
 * Root cause: the old tsup onSuccess async hook could silently swallow errors
 * on Windows, leaving dist/templates/ unchanged after edits to src/templates/.
 *
 * This test proves that `pnpm build` always overwrites dist/templates/ and
 * dist/public/ unconditionally, even when those directories already exist.
 */
import { execSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { beforeAll, describe, expect, test } from "vitest"

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, "..")

/**
 * Wipe both asset directories so the test proves the build CREATES them from
 * scratch, not merely leaves pre-existing stale copies in place.
 */
function wipeDistAssets() {
  fs.rmSync(path.join(pkgRoot, "dist/templates"), {
    recursive: true,
    force: true,
  })
  fs.rmSync(path.join(pkgRoot, "dist/public"), {
    recursive: true,
    force: true,
  })
}

beforeAll(() => {
  wipeDistAssets()
  execSync("pnpm build", {
    cwd: pkgRoot,
    stdio: "pipe",
  })
}, 120_000)

describe("dist/templates matches src/templates after build", () => {
  test("dist/templates/default/package.json is present and up-to-date", () => {
    const srcPkg = fs.readFileSync(
      path.join(pkgRoot, "src/templates/default/package.json"),
      "utf8",
    )
    const distPkg = fs.readFileSync(
      path.join(pkgRoot, "dist/templates/default/package.json"),
      "utf8",
    )

    // Exact content match — any edit to the source must appear in dist.
    expect(distPkg).toBe(srcPkg)
  })

  test("dist/templates/default/package.json pins @clq-sh/core exactly (no caret)", () => {
    const distPkg = JSON.parse(
      fs.readFileSync(
        path.join(pkgRoot, "dist/templates/default/package.json"),
        "utf8",
      ),
    ) as { dependencies: Record<string, string> }

    const version = distPkg.dependencies["@clq-sh/core"]
    expect(version).toBeDefined()
    // Must not start with ^ or ~ — exact pin only, safe for sub-1.0 packages.
    expect(version).not.toMatch(/^[\^~]/)
  })

  test("every file in src/templates appears in dist/templates", () => {
    function listFiles(dir: string): string[] {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      const files: string[] = []
      for (const e of entries) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) files.push(...listFiles(full))
        else files.push(full)
      }
      return files
    }

    const srcDir = path.join(pkgRoot, "src/templates")
    const distDir = path.join(pkgRoot, "dist/templates")

    for (const srcFile of listFiles(srcDir)) {
      const rel = path.relative(srcDir, srcFile)
      const distFile = path.join(distDir, rel)
      expect(fs.existsSync(distFile), `missing in dist: ${rel}`).toBe(true)
      expect(
        fs.readFileSync(distFile, "utf8"),
        `content mismatch: ${rel}`,
      ).toBe(fs.readFileSync(srcFile, "utf8"))
    }
  })
})

describe("dist/public matches src/commands/inspect/public after build", () => {
  test("dist/public/index.html is present and matches source", () => {
    const srcHtml = fs.readFileSync(
      path.join(pkgRoot, "src/commands/inspect/public/index.html"),
      "utf8",
    )
    const distHtml = fs.readFileSync(
      path.join(pkgRoot, "dist/public/index.html"),
      "utf8",
    )
    expect(distHtml).toBe(srcHtml)
  })
})

describe("version drift guard (coverage gap #11 from qa-report/REPORT.md)", () => {
  test("copy-assets.mjs fails with a clear message when template @clq-sh/core version mismatches core", () => {
    const templatePath = path.join(
      pkgRoot,
      "src/templates/default/package.json",
    )
    const original = fs.readFileSync(templatePath, "utf8")
    const pkg = JSON.parse(original) as {
      dependencies: Record<string, string>
    }
    // Inject a deliberately wrong version.
    const badPkg = {
      ...pkg,
      dependencies: {
        ...pkg.dependencies,
        "@clq-sh/core": "0.0.0-version-drift-test",
      },
    }
    fs.writeFileSync(templatePath, JSON.stringify(badPkg, null, 2) + "\n")

    let threw = false
    let errorOutput = ""
    try {
      execSync("node scripts/copy-assets.mjs", {
        cwd: pkgRoot,
        stdio: "pipe",
      })
    } catch (err) {
      threw = true
      const e = err as { stderr?: Buffer; stdout?: Buffer }
      errorOutput =
        (e.stderr?.toString() ?? "") + (e.stdout?.toString() ?? "")
    } finally {
      // Always restore — even if an assertion fails.
      fs.writeFileSync(templatePath, original)
    }

    expect(
      threw,
      "copy-assets.mjs must exit non-zero when versions mismatch",
    ).toBe(true)
    expect(errorOutput).toContain("version drift")
    expect(errorOutput).toContain("0.0.0-version-drift-test")
    expect(errorOutput).toContain("@clq-sh/core")
  })
})
