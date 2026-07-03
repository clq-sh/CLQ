/**
 * Copy non-TypeScript assets into dist/ after tsup compilation.
 * Run explicitly from the build script so failures are always visible.
 */
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

// ─── Version drift guard ────────────────────────────────────────────────────
// Fail the build if the template's pinned @clq-sh/core version has drifted from
// the actual package version. Only runs in the monorepo (where ../core exists).
// See qa-report/REPORT.md coverage gap #11 for the audit that produced this check.
const corePackagePath = resolve(root, "../core/package.json")
if (existsSync(corePackagePath)) {
  const coreVersion = JSON.parse(readFileSync(corePackagePath, "utf8")).version
  const templatePkg = JSON.parse(
    readFileSync(resolve(root, "src/templates/default/package.json"), "utf8"),
  )
  const templateVersion = templatePkg.dependencies?.["@clq-sh/core"]

  if (templateVersion !== coreVersion) {
    console.error(
      `\nBuild error: version drift detected.\n` +
        `  Template pins @clq-sh/core@${templateVersion}\n` +
        `  Actual core version is        ${coreVersion}\n\n` +
        `Fix: update packages/cli/src/templates/default/package.json ` +
        `to "@clq-sh/core": "${coreVersion}", then rebuild.\n`,
    )
    process.exit(1)
  }
}
// ────────────────────────────────────────────────────────────────────────────

// Unconditional overwrite — delete first so no stale files survive.
rmSync(resolve(root, "dist/templates"), { recursive: true, force: true })
cpSync(resolve(root, "src/templates"), resolve(root, "dist/templates"), {
  recursive: true,
})

rmSync(resolve(root, "dist/public"), { recursive: true, force: true })
cpSync(
  resolve(root, "src/commands/inspect/public"),
  resolve(root, "dist/public"),
  { recursive: true },
)
