# FIXD3: Verification pass on isSecretKey() — no code change required

## Result

**No code change was made.** All 27 live checks pass against the current
`isSecretKey()` implementation without modification.

---

## Live test results

Tested with a standalone Node script that exactly mirrors the production logic
(`splitKey`, `SINGLE_SECRET_WORDS`, `COMPOUND_SECRET_TERMS`, `isSecretKey`) before
touching any source file.

### MUST NOT be redacted

```
  no-match  primaryKey           words=["primary","key"]
  no-match  foreignKey           words=["foreign","key"]
  no-match  sortKey              words=["sort","key"]
  no-match  partitionKey         words=["partition","key"]
  no-match  publicKey            words=["public","key"]
  no-match  userId               words=["user","id"]
  no-match  orderId              words=["order","id"]
  no-match  requestId            words=["request","id"]
  no-match  correlationId        words=["correlation","id"]
  no-match  sessionKey           words=["session","key"]   [see note below]
  no-match  apiVersion           words=["api","version"]
  no-match  apiEndpoint          words=["api","endpoint"]
  no-match  apiUrl               words=["api","url"]
  no-match  tokenType            words=["token","type"]
  no-match  tokenExpiry          words=["token","expiry"]
  no-match  bearerRequired       words=["bearer","required"]
```

All 16 pass — none are incorrectly redacted.

### MUST still be redacted (FIXD2 regression check)

```
  REDACT    apiKey               words=["api","key"]
  REDACT    api_key              words=["api","key"]
  REDACT    privateKey           words=["private","key"]
  REDACT    private_key          words=["private","key"]
  REDACT    accessKey            words=["access","key"]
  REDACT    access_key           words=["access","key"]
  REDACT    signingKey           words=["signing","key"]
  REDACT    signing_key          words=["signing","key"]
  REDACT    userApiKey           words=["user","api","key"]
  REDACT    clientAccessToken    words=["client","access","token"]
  REDACT    requestJwt           words=["request","jwt"]
```

All 11 pass — no FIXD2 regressions.

---

## Why each MUST-NOT key is handled correctly

### Database/ORM key types: `primaryKey`, `foreignKey`, `sortKey`, `partitionKey`

All split to `["x","key"]` where `x` ∈ {`"primary"`, `"foreign"`, `"sort"`,
`"partition"`}. None of these first words appear in `COMPOUND_SECRET_TERMS` (only
`"api"`, `"private"`, `"access"`, `"signing"` pair with `"key"`). Neither word
is in `SINGLE_SECRET_WORDS`. No match.

### `publicKey`

Splits to `["public","key"]`. `"public"+"key"` is deliberately absent from
`COMPOUND_SECRET_TERMS`. Public keys are non-secret by definition — they are
the counterpart to `privateKey` which IS in the list. Correct distinction.

### ID fields: `userId`, `orderId`, `requestId`, `correlationId`

All split to `["x","id"]` where `x` is a non-secret word. `COMPOUND_SECRET_TERMS`
contains only `["session","id",false]`. None of these first words match. No match.

### `sessionKey` — judgment call, noted

Splits to `["session","key"]`. `"session"+"key"` is **not** in `COMPOUND_SECRET_TERMS`.
This is not a false positive regression — it's a deliberate omission. The compound
`session+key` covers a genuinely ambiguous case: some codebases use `sessionKey`
to mean a UI/display identifier (the key by which a session is looked up in a list),
which is not a credential. A session *encryption* key or *signing* key would
conventionally be named `sessionSecret`, `sessionSigningKey`, or `sessionToken`,
all of which ARE caught by their respective terms. The current behavior (not
redacted) is reasonable and consistent with how the compound list is structured.
If a project does store actual session cryptographic keys under the name
`sessionKey`, that is an application-level naming convention issue, not a failure
of the defense-in-depth redaction layer.

### `apiVersion`, `apiEndpoint`, `apiUrl`

All split to `["api","x"]` where `x` ∈ {`"version"`, `"endpoint"`, `"url"`}.
`"api"` is not in `SINGLE_SECRET_WORDS`. These pairs are not in
`COMPOUND_SECRET_TERMS`. No match.

### `tokenType`, `tokenExpiry`

Split to `["token","x"]`. `"token"` appears at position 0 (leading) with a
second word following — the single-word rule requires `n === 1 || i > 0`.
Neither condition is met (`n=2`, `i=0`). No match. This is the exact behavior
FIXD was designed to produce.

### `bearerRequired`

Splits to `["bearer","required"]`. `"bearer"` at position 0, `n=2`, not alone.
The single-word rule blocks it (same reason as `tokenType`). No match.

---

## Full test suite output

No code was changed; count is unchanged at 211/211.

```
 RUN  v2.1.9 E:/CLQ/CLQ

 ✓ packages/cli/src/__e2e__/full-flow.test.ts (7 tests) 41240ms
 ✓ packages/core/src/server.test.ts (19 tests) 41ms
 ✓ packages/cli/src/commands/inspect/server.test.ts (16 tests) 121186ms
 ✓ packages/cli/src/commands/dev.test.ts (3 tests) 12986ms
 ✓ packages/core/src/config.test.ts (12 tests) 11ms
 ✓ packages/cli/src/utils/redact.test.ts (65 tests) 25ms
 ✓ packages/cli/src/commands/init.test.ts (9 tests) 174ms
 ✓ packages/cli/src/build-templates.test.ts (5 tests) 2325ms
 ✓ packages/core/src/protocol/translate.test.ts (8 tests) 17ms
 ✓ packages/cli/src/commands/doctor.test.ts (4 tests) 21027ms
 ✓ packages/core/src/protocol/mcp-stdio-driver.test.ts (4 tests) 11053ms
 ✓ packages/core/src/tool.test.ts (6 tests) 19ms
 ✓ packages/cli/src/commands/add.test.ts (4 tests) 107ms
 ✓ packages/core/src/errors.test.ts (35 tests) 17ms
 ✓ packages/cli/src/utils/secret-scan.test.ts (5 tests) 59ms
 ✓ packages/core/src/types.test.ts (4 tests) 6ms
 ✓ packages/cli/src/index.test.ts (3 tests) 3841ms
 ✓ packages/cli/src/utils/exec-safe.test.ts (2 tests) 167ms

 Test Files  18 passed (18)
       Tests  211 passed (211)
    Start at  01:06:20
    Duration  226.07s
```

**No source or test files were modified in this pass.**
