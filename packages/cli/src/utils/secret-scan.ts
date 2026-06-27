import fs from "node:fs"
import path from "node:path"

type SecretPattern = { name: string; pattern: RegExp }

const PATTERNS: SecretPattern[] = [
  { name: "GitHub token", pattern: /ghp_[A-Za-z0-9]{36}/g },
  { name: "AWS access key", pattern: /AKIA[0-9A-Z]{16}/g },
  {
    name: "Generic API key assignment",
    pattern:
      /(api[-_]?key|secret|token)\s*[:=]\s*['"][A-Za-z0-9_\-]{20,}['"]/gi,
  },
]

/**
 * Replace a secret value with a masked form that reveals only its first 3 and last 2
 * characters. Short values (≤6 chars) are fully starred. The real value is never
 * reconstructable from the mask.
 */
export function maskValue(value: string): string {
  if (value.length <= 6) return "*".repeat(value.length)
  return (
    value.slice(0, 3) +
    "*".repeat(Math.max(value.length - 5, 1)) +
    value.slice(-2)
  )
}

export type Finding = {
  file: string
  line: number
  patternName: string
  masked: string
}

export function scanFileContent(filePath: string, content: string): Finding[] {
  const findings: Finding[] = []
  const lines = content.split("\n")
  for (let i = 0; i < lines.length; i++) {
    for (const { name, pattern } of PATTERNS) {
      const matches = lines[i].match(pattern)
      if (matches) {
        for (const m of matches) {
          findings.push({
            file: filePath,
            line: i + 1,
            patternName: name,
            masked: maskValue(m),
          })
          // CRITICAL: `m` (the real matched value) is used ONLY to compute `masked`
          // here, immediately, and is never assigned to any other variable, never
          // returned, never logged. The Finding object contains masked ONLY.
        }
      }
    }
  }
  return findings
}

/** Recursively yield .ts files under dir, skipping node_modules and dist. */
function walkTsFiles(dir: string): string[] {
  const out: string[] = []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist") continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walkTsFiles(full))
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(full)
    }
  }
  return out
}

export function scanDirectory(srcDir: string): Finding[] {
  const findings: Finding[] = []
  for (const file of walkTsFiles(srcDir)) {
    const content = fs.readFileSync(file, "utf-8")
    findings.push(...scanFileContent(file, content))
  }
  return findings
}
