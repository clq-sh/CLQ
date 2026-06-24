import path from "node:path"

/**
 * Validate a slug — used for both project names and tool names: letters, numbers,
 * and hyphens only, must start with an alphanumeric character.
 */
export function validateSlug(name: string): {
  valid: boolean
  reason?: string
} {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) {
    return {
      valid: false,
      reason: "Name must contain only letters, numbers, and hyphens.",
    }
  }
  return { valid: true }
}

/**
 * Resolve the target directory for a new project and prove it stays inside cwd.
 * Throws on any traversal attempt — the resolved absolute path must be cwd itself
 * or a descendant of it, never a sibling or ancestor.
 */
export function resolveSafeTargetPath(name: string): string {
  const target = path.resolve(process.cwd(), name)
  const cwd = process.cwd()
  if (!target.startsWith(cwd + path.sep) && target !== cwd) {
    throw new Error(
      `Refusing to write outside the current directory: ${target}`,
    )
  }
  return target
}
