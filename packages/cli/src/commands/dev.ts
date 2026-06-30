import fs from "node:fs"
import path from "node:path"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import type { CAC } from "cac"
import { execSafe } from "../utils/exec-safe.js"
import { findProjectRoot } from "../utils/find-project-root.js"

// tsx is a dependency of this CLI, so its bin lives in the CLI's node_modules/.bin,
// not in the user's project. localDir points execa's local-bin resolution at this
// module's location (it walks up to the CLI package's node_modules) while cwd stays
// the user's project, so `tsx` resolves no matter where `clq dev` is invoked.
const here = dirname(fileURLToPath(import.meta.url))

export function registerDevCommand(cli: CAC): void {
  cli
    .command("dev", "Start the local dev server with hot reload")
    .action(async () => {
      const root = findProjectRoot()
      if (!root) {
        console.error(
          "No CLQ project found. Run this inside a project created with `clq init`.",
        )
        process.exitCode = 1
        return
      }
      const entry = path.join(root, "src", "index.ts")
      if (!fs.existsSync(entry)) {
        console.error(`Entry file not found: ${entry}`)
        process.exitCode = 1
        return
      }

      console.log("Watching for changes...")
      const child = execSafe("tsx", ["watch", entry], {
        stdio: "inherit",
        cwd: root,
        preferLocal: true,
        localDir: here,
      })

      let shuttingDown = false
      const shutdown = async (signal: NodeJS.Signals) => {
        if (shuttingDown) return
        shuttingDown = true
        child.kill(signal)
        try {
          // Wait for the child to actually exit before the parent does — this is
          // what prevents an orphaned tsx/node process surviving the CLI.
          await child
        } catch {
          /* expected — child was killed */
        }
        process.exit(0)
      }
      process.on("SIGINT", () => void shutdown("SIGINT"))
      process.on("SIGTERM", () => void shutdown("SIGTERM"))

      try {
        await child
      } catch {
        console.error("Dev server exited with an error.")
      }
    })
}
