// Single-word terms that signal a secret-bearing key when they appear as a
// standalone segment within a compound key name. Matched at non-leading
// positions (e.g. "myToken", "requestJwt") OR when the key consists of exactly
// this one word (e.g. "token", "cookie"). NOT matched when leading with more
// words following (e.g. "tokenCount", "cookieBannerVisible").
//
// See qa-report/REPORT.md Finding 2, qa-report/FIXD.md (word-boundary fix),
// and qa-report/FIXD2.md (camelCase-prefix regression fix).
const SINGLE_SECRET_WORDS = new Set([
  "secret",
  "token",
  "password",
  "authorization",
  "credential",
  "credentials",
  "bearer",
  "jwt",
  "passphrase",
  "cookie",
])

// Two-word compound terms. The third element controls whether the compound
// matches when it appears as a non-leading trailing suffix (e.g. "userApiKey"
// → suffix "api"+"key"). Set to false for terms that are identifiers rather
// than direct credential values, to avoid false positives like "parentSessionId"
// while still matching the exact key "sessionId" / "session_id".
const COMPOUND_SECRET_TERMS: ReadonlyArray<readonly [string, string, boolean]> =
  [
    ["api", "key", true],
    ["private", "key", true],
    ["access", "key", true],
    ["signing", "key", true],
    ["client", "secret", true],
    ["refresh", "token", true],
    ["session", "id", false], // exact match only: sessionId / session_id
  ]

/**
 * Split a key into lowercase word segments, handling both camelCase transitions
 * (lowercase→uppercase) and underscore/hyphen separators.
 *
 *   "userApiKey"        → ["user", "api", "key"]
 *   "user_api_key"      → ["user", "api", "key"]
 *   "clientAccessToken" → ["client", "access", "token"]
 *   "cookieCount"       → ["cookie", "count"]
 *   "TOKEN"             → ["token"]
 */
function splitKey(key: string): string[] {
  return key
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase())
}

/**
 * Return true if this key name looks like it holds a secret value.
 *
 * Matching rules applied to the word-split key:
 *  1. Single-word secret term that IS the entire key → match.
 *  2. Single-word secret term at any non-leading position → match
 *     (catches "myToken", "requestJwt", "clientAccessToken").
 *  3. Two-word compound that IS the entire (two-word) key → match
 *     (catches "apiKey", "api_key", "sessionId", "session_id").
 *  4. Two-word compound as the trailing pair of a longer key → match
 *     when allowSuffix=true (catches "userApiKey", "nested_private_key").
 *
 * Leading secret terms followed by non-secret qualifiers are deliberately NOT
 * matched (e.g. "tokenCount", "cookieBannerVisible", "authorizationLevel").
 * Two-word "identifier" compounds (session+id, allowSuffix=false) are only
 * matched when the key IS that compound (e.g. "sessionId"), not when prefixed
 * (e.g. "parentSessionId").
 */
function isSecretKey(key: string): boolean {
  const words = splitKey(key)
  const n = words.length
  if (n === 0) return false

  // Rules 1 & 2: single-word terms
  for (let i = 0; i < n; i++) {
    if (SINGLE_SECRET_WORDS.has(words[i])) {
      if (n === 1 || i > 0) return true
    }
  }

  // Rules 3 & 4: two-word compound terms
  for (const [w1, w2, allowSuffix] of COMPOUND_SECRET_TERMS) {
    for (let i = 0; i <= n - 2; i++) {
      if (words[i] === w1 && words[i + 1] === w2) {
        const isExactKey = n === 2
        const isTrailingSuffix = i === n - 2
        if (isExactKey || (isTrailingSuffix && allowSuffix)) return true
      }
    }
  }

  return false
}

/**
 * Recursively replace the value of any object key whose name looks like a secret
 * with "[REDACTED]". Defense in depth: a leaking handler can never expose credentials
 * through the inspector UI regardless of where the data came from.
 */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets)
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = isSecretKey(k) ? "[REDACTED]" : redactSecrets(v)
    }
    return out
  }
  return value
}
