import fs from "node:fs"
import path from "node:path"

/**
 * Recursively copy a template directory, substituting placeholders by plain string
 * replacement only. Every "{{projectName}}" occurrence becomes vars.projectName via
 * String.prototype.replaceAll — never an expression-evaluating template engine, so
 * template content can never execute code. Directory structure is mirrored under dest.
 * File permission bits are left at fs defaults (no chmod).
 */
export function copyTemplateDir(
  src: string,
  dest: string,
  vars: { projectName: string },
): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyTemplateDir(srcPath, destPath, vars)
    } else {
      const contents = fs.readFileSync(srcPath, "utf8")
      const rendered = contents.replaceAll("{{projectName}}", vars.projectName)
      fs.writeFileSync(destPath, rendered)
    }
  }
}
