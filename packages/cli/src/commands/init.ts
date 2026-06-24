import fs from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { CAC } from "cac"
import { copyTemplateDir } from "../utils/copy-template.js"
import { resolveSafeTargetPath, validateSlug } from "../utils/safe-path.js"

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Locate the bundled default template, which lives at a different relative offset
 * depending on whether we run from source (src/commands) or the built bundle (dist).
 */
function findTemplateDir(): string {
  const candidates = [
    resolve(here, "templates/default"), // built: dist/index.js -> dist/templates/default
    resolve(here, "../templates/default"), // source: src/commands -> src/templates/default
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error("Could not locate the default project template.")
}

export function registerInitCommand(cli: CAC): void {
  cli
    .command("init [project-name]", "Scaffold a new CLQ project")
    .option("--force", "Overwrite an existing non-empty directory")
    .action(
      async (
        projectNameArg: string | undefined,
        options: { force?: boolean },
      ) => {
        let name = projectNameArg
        if (!name) {
          const prompts = await import("@clack/prompts")
          const answer = await prompts.text({ message: "Project name?" })
          if (prompts.isCancel(answer)) {
            console.error("Aborted.")
            process.exitCode = 1
            return
          }
          name = answer
        }

        const validation = validateSlug(name)
        if (!validation.valid) {
          console.error(validation.reason)
          process.exitCode = 1
          return
        }

        let target: string
        try {
          target = resolveSafeTargetPath(name)
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err))
          process.exitCode = 1
          return
        }

        if (fs.existsSync(target)) {
          const isEmpty = fs.readdirSync(target).length === 0
          if (!isEmpty && !options.force) {
            console.error(
              `Directory '${name}' already exists and is not empty. Use --force to overwrite.`,
            )
            process.exitCode = 1
            return
          }
        }

        fs.mkdirSync(target, { recursive: true })
        copyTemplateDir(findTemplateDir(), target, { projectName: name })

        console.log(`Created ${name}. Next steps:`)
        console.log(`  cd ${name}`)
        console.log("  pnpm install")
        console.log("  pnpm build")
      },
    )
}
