/**
 * Copy non-TypeScript assets into dist/ after tsup compilation.
 * Run explicitly from the build script so failures are always visible.
 */
import { cpSync, rmSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

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
