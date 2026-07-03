# FIXD2: camelCase-prefix regression in word-boundary redaction fix

## Root cause of the regression

FIXD introduced `\b` word-boundary anchors around each SECRET_TERM:

```ts
const SECRET_KEY_PATTERN = new RegExp(
  SECRET_TERMS.map((t) => `\\b(?:${t})\\b`).join("|"),
  "i",
)
```

`\b` fires between a `\w` character (`[a-zA-Z0-9_]`) and a `\W` character
(or string edge). The critical flaw: in JavaScript regex, **both lowercase and
uppercase letters are `\w`**, so there is no `\b` between `r` and `A` in
`userApiKey` — both are word characters. `\b` fires only at string
edges or at separator characters, not at camelCase transitions.

Consequences:
- `\btoken\b` matches `token` (correct) and `tokenCount` is blocked (correct)
  but also fails to match the `Token` in `clientAccessToken` (regression)
- `\bauthorization\b` matches `authorization` (correct) but fails to match
  the `Authorization` in `myAuthorization` when `m`, `y` and `A` are all `\w`

In short: FIXD solved false positives (term as a *leading* prefix) by
blocking ALL non-boundary matches — but it also broke *suffix* matches
(term at the END of a compound key, preceded by other words).

## The new approach

Instead of a monolithic regex against the raw key string, the new implementation:

1. **Splits** the key into lowercase word segments, handling both camelCase
   transitions (`([a-z])([A-Z])` → insert `_`) and explicit separators (`_`, `-`).

   ```
   "userApiKey"        → ["user", "api", "key"]
   "user_api_key"      → ["user", "api", "key"]
   "clientAccessToken" → ["client", "access", "token"]
   "cookieBannerVisible"→ ["cookie", "banner", "visible"]
   "TOKEN"             → ["token"]
   ```

2. **Checks** the word array against two independent sets:

   **SINGLE_SECRET_WORDS** — matches when:
   - The key consists of this one word alone (e.g. `token`, `cookie`), OR
   - The word appears at any *non-leading* position (i.e. `i > 0`).
   
   This fixes false positives: `tokenCount → ["token","count"]`, "token" is
   at `i=0` (leading) and `n > 1`, so it is **not** matched.
   
   This fixes the regression: `requestJwt → ["request","jwt"]`, "jwt" is at
   `i=1` (non-leading) → **matched**.

   **COMPOUND_SECRET_TERMS** — two-word pairs, matched when:
   - The pair **is the entire key** (`n === 2`): `apiKey`, `session_id`.
   - OR the pair is the **trailing suffix** (`i === n-2`) AND `allowSuffix=true`:
     `userApiKey → ["user","api","key"]`, "api"+"key" at `i=1` (the last pair).
   
   The `allowSuffix` flag is `false` for `session+id` only: `sessionId` and
   `session_id` match as exact keys, but `parentSessionId` does not — "session"
   identifies a session rather than storing a credential value, and the prefix
   `parent` signals a relational reference rather than a credential field.
   All `-key`, `-secret`, `-token` compounds use `allowSuffix=true`.

## Live verification — all three test lists

Verified with `/tmp/fixd2_verify.mjs` before touching any source:

```
=== MUST NOT redact (false positives) ===
  no-match  cookieCount
  no-match  acceptedCookies
  no-match  cookieBannerVisible
  no-match  hasCookies
  no-match  cookiePolicy
  no-match  tokenCount
  no-match  jwtAlgorithm
  no-match  jwtClaims
  no-match  credentialType
  no-match  authorizationLevel
  no-match  parentSessionId

=== MUST redact (bare/simple) ===
  REDACT    secret
  REDACT    token
  REDACT    password
  REDACT    apiKey
  REDACT    api_key
  REDACT    API_KEY
  REDACT    TOKEN
  REDACT    authorization
  REDACT    Authorization
  REDACT    credential
  REDACT    credentials
  REDACT    private_key
  REDACT    privateKey
  REDACT    access_key
  REDACT    accessKey
  REDACT    signing_key
  REDACT    signingKey
  REDACT    bearer
  REDACT    jwt
  REDACT    passphrase
  REDACT    client_secret
  REDACT    clientSecret
  REDACT    refresh_token
  REDACT    refreshToken
  REDACT    session_id
  REDACT    sessionId
  REDACT    cookie

=== MUST redact (prefixed compounds — was broken by FIXD) ===
  REDACT    userApiKey
  REDACT    user_api_key
  REDACT    clientAccessToken
  REDACT    client_access_token
  REDACT    myAuthorization
  REDACT    requestJwt
  REDACT    someClientSecret
  REDACT    parentAccessKey
  REDACT    nested_private_key
  REDACT    userBearerToken

ALL PASS ✓
```

## New tests in `packages/cli/src/utils/redact.test.ts`

New describe block: **`redactSecrets — prefixed compounds MUST be redacted (FIXD2 regression)`** — 10 tests, one per prefixed compound case. Each test asserts the key is redacted to `"[REDACTED]"` and the raw `LEAK_VALUE` does not appear in the serialized output.

Keys covered: `userApiKey`, `user_api_key`, `clientAccessToken`,
`client_access_token`, `myAuthorization`, `requestJwt`, `someClientSecret`,
`parentAccessKey`, `nested_private_key`, `userBearerToken`.

## Full final test suite output

```
 RUN  v2.1.9 E:/CLQ/CLQ

 ✓ packages/cli/src/__e2e__/full-flow.test.ts (7 tests) 41383ms
 ✓ packages/core/src/server.test.ts (19 tests) 39ms
 ✓ packages/cli/src/commands/inspect/server.test.ts (16 tests) 121055ms
 ✓ packages/cli/src/commands/dev.test.ts (3 tests) 13431ms
 ✓ packages/core/src/config.test.ts (12 tests) 12ms
 ✓ packages/cli/src/utils/redact.test.ts (65 tests) 24ms   ← was 55, +10 new
 ✓ packages/cli/src/commands/init.test.ts (9 tests) 173ms
 ✓ packages/cli/src/build-templates.test.ts (5 tests) 2242ms
 ✓ packages/core/src/protocol/translate.test.ts (8 tests) 16ms
 ✓ packages/cli/src/commands/doctor.test.ts (4 tests) 21123ms
 ✓ packages/core/src/protocol/mcp-stdio-driver.test.ts (4 tests) 11011ms
 ✓ packages/core/src/tool.test.ts (6 tests) 16ms
 ✓ packages/cli/src/commands/add.test.ts (4 tests) 103ms
 ✓ packages/core/src/errors.test.ts (35 tests) 17ms
 ✓ packages/cli/src/utils/secret-scan.test.ts (5 tests) 47ms
 ✓ packages/core/src/types.test.ts (4 tests) 4ms
 ✓ packages/cli/src/index.test.ts (3 tests) 3653ms
 ✓ packages/cli/src/utils/exec-safe.test.ts (2 tests) 175ms

 Test Files  18 passed (18)
       Tests  211 passed (211)
    Start at  00:38:31
    Duration  226.01s
```

**Result: 211/211 — up from 201 (+10 new tests). All 18 files pass.**

## Files modified

| File | Change |
|------|--------|
| `packages/cli/src/utils/redact.ts` | Full rewrite of detection logic: replaced `SECRET_TERMS` regex list + `SECRET_KEY_PATTERN` with `SINGLE_SECRET_WORDS` (Set), `COMPOUND_SECRET_TERMS` (array of word pairs), `splitKey()` (camelCase/separator splitter), and `isSecretKey()` (word-array matcher). `redactSecrets()` unchanged except calling `isSecretKey(k)` instead of `SECRET_KEY_PATTERN.test(k)`. |
| `packages/cli/src/utils/redact.test.ts` | Added one new `describe` block with 10 tests for prefixed compound key names. |

No other files were modified.
