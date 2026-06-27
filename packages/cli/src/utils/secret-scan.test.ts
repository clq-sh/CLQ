import { describe, expect, test } from "vitest"
import { maskValue, scanFileContent } from "./secret-scan.js"

// A fake but pattern-shaped GitHub token: ghp_ + 36 alphanumerics. Not a real secret.
const FAKE_GH_TOKEN = `ghp_${"A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"}`

describe("maskValue", () => {
  test("a short string (<=6 chars) becomes all asterisks of the same length", () => {
    const short = "abc123"
    const masked = maskValue(short)
    expect(masked).toBe("******")
    expect(masked).toHaveLength(short.length)
    expect(masked).not.toContain("a")
    expect(masked).not.toBe(short)
  })

  test("a long string keeps first 3 + last 2 and stars the middle", () => {
    const masked = maskValue(FAKE_GH_TOKEN)
    expect(masked.startsWith(FAKE_GH_TOKEN.slice(0, 3))).toBe(true)
    expect(masked.endsWith(FAKE_GH_TOKEN.slice(-2))).toBe(true)
    expect(masked).toContain("*")
    expect(masked).not.toBe(FAKE_GH_TOKEN)
  })
})

describe("scanFileContent", () => {
  test("a GitHub-token-shaped value is masked and never leaked in the finding", () => {
    const content = `const config = {\n  token: "${FAKE_GH_TOKEN}",\n}\n`
    const findings = scanFileContent("secrets.ts", content)

    expect(findings.length).toBeGreaterThanOrEqual(1)
    const finding = findings.find((f) => f.patternName === "GitHub token")
    expect(finding).toBeDefined()
    if (!finding) return

    // The mask is NOT the real value...
    expect(finding.masked).not.toBe(FAKE_GH_TOKEN)
    // ...it has the expected shape (first 3 + stars + last 2)...
    expect(finding.masked.startsWith(FAKE_GH_TOKEN.slice(0, 3))).toBe(true)
    expect(finding.masked.endsWith(FAKE_GH_TOKEN.slice(-2))).toBe(true)
    // ...and CRITICALLY the full original value is not a substring of the serialized
    // finding at all — nothing in the object carries the real secret.
    expect(JSON.stringify(finding)).not.toContain(FAKE_GH_TOKEN)
    // line number is reported (the token is on line 2).
    expect(finding.line).toBe(2)
  })

  test("clean content returns no findings", () => {
    const content = "export const greeting = 'hello world'\nconst n = 42\n"
    expect(scanFileContent("clean.ts", content)).toEqual([])
  })

  test("scans a 50,000-line harmless file in under 2 seconds", () => {
    const big = Array.from(
      { length: 50_000 },
      (_, i) => `const value${i} = ${i} // harmless line`,
    ).join("\n")
    const start = Date.now()
    const findings = scanFileContent("big.ts", big)
    const elapsed = Date.now() - start
    expect(findings).toEqual([])
    expect(elapsed).toBeLessThan(2000)
  })
})
