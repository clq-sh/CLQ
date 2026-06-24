import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { cac } from "cac"
import { registerAddCommand } from "./commands/add.js"
import { registerInitCommand } from "./commands/init.js"

// Fail loudly and cleanly — never let a raw stack trace reach the user.
process.on("uncaughtException", (err) => {
  console.error(`Error: ${err.message}`)
  process.exit(1)
})
process.on("unhandledRejection", (err) => {
  console.error(`Error: ${err}`)
  process.exit(1)
})

// Resolve the package version relative to THIS compiled file (dist/index.js),
// not process.cwd(), so `clq --version` is correct regardless of where it's run.
const here = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(
  readFileSync(resolve(here, "../package.json"), "utf8"),
) as { version: string }

const cli = cac("clq")
cli.version(pkg.version)
cli.help()

registerInitCommand(cli)
registerAddCommand(cli)

cli.on("command:*", () => {
  console.error("Unknown command. Run `clq --help` to see available commands.")
  process.exitCode = 1
})

cli.parse()
