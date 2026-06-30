import fs from "node:fs"
import path from "node:path"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { CAC } from "cac"
import { findProjectRoot } from "../utils/find-project-root.js"
import { validateSlug } from "../utils/safe-path.js"

const here = dirname(fileURLToPath(import.meta.url))

// Locate the bundled tool template, which sits at a different relative offset depending
// on whether we run from source (src/commands) or the built bundle (dist).
function findToolTemplate(): string {
  const candidates = [
    resolve(here, "templates/tool.ts.template"), // built: dist -> dist/templates
    resolve(here, "../templates/tool.ts.template"), // source: src/commands -> src/templates
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error("Could not locate the tool template.")
}

export function registerAddCommand(cli: CAC): void {
  cli
    .command("add <tool-name>", "Add a new tool to the current project")
    .option("--force", "Overwrite an existing tool file")
    .action(async (toolName: string, options: { force?: boolean }) => {
      const validation = validateSlug(toolName)
      if (!validation.valid) {
        console.error(validation.reason)
        process.exitCode = 1
        return
      }

      const root = findProjectRoot()
      if (!root) {
        console.error(
          "No CLQ project found. Run this inside a project created with `clq init`.",
        )
        process.exitCode = 1
        return
      }

      const toolsDir = path.join(root, "src", "tools")
      const targetFile = path.join(toolsDir, `${toolName}.ts`)

      // Defense in depth: the target must resolve strictly inside toolsDir.
      // validateSlug already forbids separators and `..`, but this guard refuses
      // to write outside even if validation were ever loosened.
      const resolvedTarget = path.resolve(targetFile)
      if (!resolvedTarget.startsWith(path.resolve(toolsDir) + path.sep)) {
        console.error(
          `Refusing to write outside the tools directory: ${resolvedTarget}`,
        )
        process.exitCode = 1
        return
      }

      if (fs.existsSync(targetFile) && !options.force) {
        console.error(
          `Tool '${toolName}' already exists at ${targetFile}. Use --force to overwrite.`,
        )
        process.exitCode = 1
        return
      }

      fs.mkdirSync(toolsDir, { recursive: true })
      const templateContent = fs.readFileSync(findToolTemplate(), "utf8")
      fs.writeFileSync(
        targetFile,
        templateContent.replaceAll("{{toolName}}", toolName),
      )
      console.log(`Created src/tools/${toolName}.ts`)
    })
}
