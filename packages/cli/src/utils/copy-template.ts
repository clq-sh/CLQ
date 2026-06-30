import fs from "node:fs"
import path from "node:path"

/**
 * Recursively copy a template directory, substituting {{projectName}} by plain string
 * replacement only — never an expression-evaluating template engine, so template content
 * can never execute code. File permission bits are left at fs defaults (no chmod).
 */
export function copyTemplateDir(
  src: string,
  dest: string,
  vars: { projectName: string },
): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    // "gitignore" in the template ships without the leading dot so Git in the source
    // repo doesn't apply it to the template directory itself. Rename on copy.
    const destName = entry.name === "gitignore" ? ".gitignore" : entry.name
    const destPath = path.join(dest, destName)
    if (entry.isDirectory()) {
      copyTemplateDir(srcPath, destPath, vars)
    } else {
      const contents = fs.readFileSync(srcPath, "utf8")
      const rendered = contents.replaceAll("{{projectName}}", vars.projectName)
      fs.writeFileSync(destPath, rendered)
    }
  }
}
