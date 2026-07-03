# FIXD: Word-boundary anchoring for SECRET_KEY_PATTERN

## What changed

**File:** `packages/cli/src/utils/redact.ts`  
**Line:** 23 (pattern construction)

### The problem

`SECRET_KEY_PATTERN` was built by joining all terms with `|` and no anchoring:

```ts
// before
const SECRET_KEY_PATTERN = new RegExp(SECRET_TERMS.join("|"), "i")
```

This made every term a bare substring match. Any key whose name *contained* a
term anywhere — including as a leading component of a longer camelCase word —
was redacted. Concrete false positives confirmed live:

| Key | Value type | Was redacted? | Should redact? |
|-----|-----------|---------------|---------------|
| `cookieCount` | number | YES | NO |
| `acceptedCookies` | boolean | YES | NO |
| `cookieBannerVisible` | boolean | YES | NO |
| `hasCookies` | boolean | YES | NO |
| `cookiePolicy` | string | YES | NO |
| `tokenCount` | number | YES | NO |
| `jwtAlgorithm` | string | YES | NO |
| `jwtClaims` | object | YES | NO |
| `credentialType` | string | YES | NO |
| `authorizationLevel` | number | YES | NO |
| `parentSessionId` | string | YES | NO |

The `cookie` term was the worst offender: any key containing the substring
`cookie` was wiped. `tokenCount: 42` was particularly harmful — a numeric
value silently replaced with the string `"[REDACTED]"`, breaking any consumer
that expected a number.

### The fix

Wrap each term with `\b...\b` word-boundary anchors:

```ts
// after
const SECRET_KEY_PATTERN = new RegExp(
  SECRET_TERMS.map((t) => `\\b(?:${t})\\b`).join("|"),
  "i",
)
```

`\\b` in the TypeScript template literal produces the two-character string
`\b` (backslash + b). When `new RegExp()` parses this as a pattern string,
`\b` is the word-boundary assertion — not a literal backslash or the backspace
control character.

### Why `\b` works for both bare words and camelCase compounds

JavaScript `\b` fires at the boundary between a `\w` character
(`[a-zA-Z0-9_]`) and a `\W` character (or string start/end).

**Bare terms** — `secret`, `jwt`, `cookie`, `token`:
- Standalone key `"cookie"`: `\b` fires at the string start (before `c`) and
  string end (after `e`) → **MATCH** ✓
- Key `"cookieCount"`: `\b` fires before `c`, but after matching `cookie` the
  next char is `C` (uppercase, still `\w`) — no `\b` between `e` and `C` →
  **NO MATCH** ✓

**camelCase / snake_case compounds** — `api[-_]?key`, `session[-_]?id`, etc.:
- The compound term spans the *entire* compound word. `\b` lands at the string
  edges, not in the middle of the camelCase word:
  - `"apiKey"` vs `\b(?:api[-_]?key)\b`: boundary before `a` (string start),
    `api` matches, `[-_]?` matches nothing, `key` matches `Key` (case-insensitive),
    boundary after `y` (string end) → **MATCH** ✓
  - `"sessionId"` vs `\b(?:session[-_]?id)\b`: same pattern → **MATCH** ✓
- `"parentSessionId"` vs `\b(?:session[-_]?id)\b`: the `S` in `Session` is
  preceded by `t` from `parent` (both `\w`), so `\b` never fires before
  `Session` → **NO MATCH** ✓

The `_` separator is a `\w` character in JavaScript regex, so `\b` does NOT
fire between `access` and `_key`. This is fine because the compound term
`access[-_]?key` includes the `_` inside the anchored group:
- `"access_key"`: `\b` before `a`, then `access_key` matches the whole pattern
  including `_`, then `\b` after `y` → **MATCH** ✓

## Live confirmation — false positives now NOT redacted

```
  no-match  cookieCount          (was MATCH before fix)
  no-match  acceptedCookies      (was MATCH before fix)
  no-match  cookieBannerVisible  (was MATCH before fix)
  no-match  hasCookies           (was MATCH before fix)
  no-match  cookiePolicy         (was MATCH before fix)
  no-match  tokenCount           (was MATCH before fix)
  no-match  jwtAlgorithm         (was MATCH before fix)
  no-match  jwtClaims            (was MATCH before fix)
  no-match  credentialType       (was MATCH before fix)
  no-match  authorizationLevel   (was MATCH before fix)
  no-match  parentSessionId      (was MATCH before fix)
```

## Live confirmation — true positives still redacted

```
  REDACTED  secret
  REDACTED  token
  REDACTED  password
  REDACTED  apiKey
  REDACTED  api_key
  REDACTED  API_KEY
  REDACTED  TOKEN
  REDACTED  authorization
  REDACTED  Authorization
  REDACTED  credential
  REDACTED  credentials
  REDACTED  private_key
  REDACTED  privateKey
  REDACTED  access_key
  REDACTED  accessKey
  REDACTED  signing_key
  REDACTED  signingKey
  REDACTED  bearer
  REDACTED  jwt
  REDACTED  passphrase
  REDACTED  client_secret
  REDACTED  clientSecret
  REDACTED  refresh_token
  REDACTED  refreshToken
  REDACTED  session_id
  REDACTED  sessionId
  REDACTED  cookie
```

## New tests in `packages/cli/src/utils/redact.test.ts`

Two new `describe` blocks added, 18 new tests total:

### Block 1 — `redactSecrets — word-boundary anchoring: false positives are NOT redacted (FIXD)` (11 tests)

One test per false-positive key. Each test passes the key with its natural
non-string type (numeric, boolean, string, object) and asserts the value
passes through **unchanged** — specifically that it is NOT `"[REDACTED]"` and
that `toStrictEqual` confirms the original value and type are preserved.

Keys covered: `cookieCount`, `acceptedCookies`, `cookieBannerVisible`,
`hasCookies`, `cookiePolicy`, `tokenCount`, `jwtAlgorithm`, `jwtClaims`,
`credentialType`, `authorizationLevel`, `parentSessionId`.

### Block 2 — `redactSecrets — word-boundary anchoring: bare secret terms still redacted (FIXD)` (7 tests)

Tests for the boundary-sensitive true-positive cases that are most at risk
from an over-zealous anchoring approach:

| Key | Confirmed still redacted |
|-----|--------------------------|
| `cookie` | ✓ |
| `token` | ✓ |
| `jwt` | ✓ |
| `sessionId` | ✓ |
| `session_id` | ✓ |
| `apiKey` | ✓ |
| `api_key` | ✓ |

## Full final test suite output

```
 RUN  v2.1.9 E:/CLQ/CLQ

 ✓ packages/cli/src/__e2e__/full-flow.test.ts (7 tests) 47881ms
 ✓ packages/core/src/server.test.ts (19 tests) 40ms
 ✓ packages/cli/src/commands/inspect/server.test.ts (16 tests) 120296ms
 ✓ packages/cli/src/commands/dev.test.ts (3 tests) 13191ms
 ✓ packages/core/src/config.test.ts (12 tests) 13ms
 ✓ packages/cli/src/commands/init.test.ts (9 tests) 187ms
 ✓ packages/cli/src/utils/redact.test.ts (55 tests) 19ms   ← was 37, +18 new
 ✓ packages/cli/src/build-templates.test.ts (5 tests) 2165ms
 ✓ packages/core/src/protocol/translate.test.ts (8 tests) 14ms
 ✓ packages/cli/src/commands/doctor.test.ts (4 tests) 21328ms
 ✓ packages/core/src/protocol/mcp-stdio-driver.test.ts (4 tests) 10785ms
 ✓ packages/core/src/tool.test.ts (6 tests) 14ms
 ✓ packages/cli/src/commands/add.test.ts (4 tests) 118ms
 ✓ packages/core/src/errors.test.ts (35 tests) 14ms
 ✓ packages/cli/src/utils/secret-scan.test.ts (5 tests) 45ms
 ✓ packages/core/src/types.test.ts (4 tests) 4ms
 ✓ packages/cli/src/index.test.ts (3 tests) 3843ms
 ✓ packages/cli/src/utils/exec-safe.test.ts (2 tests) 181ms

 Test Files  18 passed (18)
       Tests  201 passed (201)
    Start at  23:48:07
    Duration  231.50s
```

**Result: 201/201 — up from 183 (+18 new tests). All 18 files pass.**

## Files modified

| File | Change |
|------|--------|
| `packages/cli/src/utils/redact.ts` | `SECRET_KEY_PATTERN` construction: `.join("|")` → `.map(t => \`\\b(?:${t})\\b\`).join("|")` |
| `packages/cli/src/utils/redact.test.ts` | Two new `describe` blocks, 18 new tests covering all 11 false-positive keys and 7 boundary-sensitive true-positive keys |

No other files were modified.
