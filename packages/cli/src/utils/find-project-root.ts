import fs from "node:fs"
import path from "node:path"

/**
 * Walk up from startDir looking for clq.config.ts, the project marker.
 * Bounded to 10 levels so a stray invocation never scans the entire filesystem.
 */
export function findProjectRoot(
  startDir: string = process.cwd(),
): string | null {
  let dir = startDir
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, "clq.config.ts"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null // reached filesystem root
    dir = parent
  }
  return null
}
