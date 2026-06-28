import type { CAC } from "cac"
import { findProjectRoot } from "../utils/find-project-root.js"
import { startInspectServer } from "./inspect/server.js"

export function registerInspectCommand(cli: CAC): void {
  cli
    .command("inspect", "Launch the local web inspector for this project")
    .action(async () => {
      const root = findProjectRoot()
      if (!root) {
        console.error(
          "No CLQ project found. Run this inside a project created with `clq init`.",
        )
        process.exitCode = 1
        return
      }

      const portOverride = process.env.CLQ_INSPECT_PORT
        ? Number(process.env.CLQ_INSPECT_PORT)
        : undefined
      const inspector = await startInspectServer({ root, port: portOverride })
      console.log(
        `Inspector running at http://127.0.0.1:${inspector.port}/?token=${inspector.token}`,
      )
      console.log(
        "This token will not be printed again. Keep this URL private.",
      )

      let shuttingDown = false
      const shutdown = async () => {
        if (shuttingDown) return
        shuttingDown = true
        await inspector.close()
        process.exit(0)
      }
      process.on("SIGINT", () => void shutdown())
      process.on("SIGTERM", () => void shutdown())
    })
}
