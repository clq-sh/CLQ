import fs from "node:fs"
import path from "node:path"

/**
 * Walk up from startDir looking for colloquial.config.ts, the project marker.
 * Bounded to 10 levels so a stray invocation can never walk the entire filesystem.
 * Returns the project root directory, or null if none is found.
 */
export function findProjectRoot(
  startDir: string = process.cwd(),
): string | null {
  let dir = startDir
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, "colloquial.config.ts"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null // reached filesystem root
    dir = parent
  }
  return null
}
