# CLQ Security Fixes — Implementation Report

**Date:** 2026-07-02  
**Fixes based on:** `qa-report/REPORT.md`  
**Pre-fix test count:** 128 tests, 17 files (all passing)  
**Post-fix test count:** 175 tests, 18 files (all passing)

---

## 1. Fixes Implemented

### Fix 1 — Finding 1 (MEDIUM): Secret value leak on type mismatch in `clq doctor`

**File changed:** `packages/core/src/config.ts` (lines 44–54)

**What was wrong:** `loadConfig()` interpolated `"${raw}"` directly into the error description when a number-typed env var received a non-numeric value. This caused `clq doctor` to print the raw secret value to stdout.

**What was changed:** Replaced the raw value interpolation with a safe structural description:
- For non-secret vars: `"a non-numeric string of length N"` (no content, only shape)
- For `secret: true` vars: `"a non-numeric value"` (no content, no shape — see Fix 3 below)
- The var name and expected type always appear; the raw value never does

**Regression tests added:**

| File | Test | What it proves |
|---|---|---|
| `packages/core/src/config.test.ts` | `"number type-mismatch error never includes the raw value — even a secret-shaped one (Finding 1 regression)"` | The raw value `sk-REAL-SECRET-12345678` does not appear in `.message`, `.cause`, or `.fix` when `CLQ_PORT` gets that value for a `type: "number"` var. The error still names the var (`CLQ_PORT`) and includes `"expected a number"`. |
| `packages/cli/src/commands/doctor.test.ts` | `"a wrong-type env var exits non-zero and the raw secret value never appears in stdout (Finding 1 regression)"` | Full integration: `SERVICE_PORT=sk-TYPE-MISMATCH-SECRET-9876 clq doctor` exits non-zero, stdout contains `"Config check failed"` and `"SERVICE_PORT"`, but does NOT contain the raw secret value. |

---

### Fix 2 — Finding 2 (LOW): `redactSecrets()` misses common secret field names

**File changed:** `packages/cli/src/utils/redact.ts` (lines 1–20)

**What was wrong:** The pattern `/secret|token|password|api[-_]?key/i` missed `authorization`, `credential(s)`, `access_key`, `private_key`, `bearer`, `jwt`, `passphrase`, `signing_key`, and others. Tool handlers returning data in those fields would leak values through `/api/call` and `/api/logs`.

**What was changed:** Replaced the single hard-coded regex with a maintained list (`SECRET_TERMS`) joined into a `new RegExp(...)`. Added 16 new terms covering all patterns identified in the audit, including camelCase/underscore/hyphen variants via `[-_]?` separators.

**New `SECRET_TERMS` list:**
```
secret, token, password, api[-_]?key, authorization, credentials?,
private[-_]?key, access[-_]?key, signing[-_]?key, bearer, jwt, passphrase,
client[-_]?secret, refresh[-_]?token, session[-_]?id, cookie
```

**Regression tests added:**

| File | Tests | What they prove |
|---|---|---|
| `packages/cli/src/utils/redact.test.ts` (NEW FILE, 37 tests) | One test per newly-covered key name (20 keys), plus original-pattern coverage, non-secret key pass-through, and structural behavior (nesting, arrays, primitives) | Every new field name produces `[REDACTED]` and never exposes `LEAK_VALUE` in the serialized result |
| `packages/cli/src/commands/inspect/server.test.ts` | `"credential-named response fields are redacted in /api/call (Finding 2 regression)"` | Calls `getCredentials` through the real inspector API; all 12 credential-named fields in the response are `[REDACTED]`, `safeField` passes through |
| `packages/cli/src/commands/inspect/server.test.ts` | `"credential-named fields are redacted in /api/logs after a call (Finding 2 regression)"` | After calling `getCredentials`, the `/api/logs` response also has `[REDACTED]` for `authorization`, `access_key`, and `bearer` (spot-checked); raw secret never appears |

**Note on PROJECT_ENTRY expansion:** The `getCredentials` tool was added to the server.test.ts fixture string constant (`PROJECT_ENTRY`). The addition does not modify or remove any existing constant, assertion, or tool — it extends the fixture with an additional tool definition that the new tests use. All 12 previously passing tests continue to pass unchanged.

---

### Fix 3 — Finding 3 (INFO): `secret: boolean` was declared but never read

**File changed:** `packages/core/src/config.ts` (same block as Fix 1)

**What was wrong:** The `secret?: boolean` field on `EnvVarDeclaration` had no effect on any code path. Users marking vars with `secret: true` received no extra protection.

**What was changed:** In the number type-mismatch error path (the only place raw value info was being included), the `secret` flag now controls whether length information is omitted:
- `secret: false` / unset → includes `"a non-numeric string of length N"` (helps debug non-sensitive misconfigurations)
- `secret: true` → outputs only `"a non-numeric value"` (prevents fingerprinting token format via length)

For string-typed vars, no code path currently outputs the raw value regardless of `secret`, so `secret: true` is structurally redundant there but remains in the type as a forward-looking marker.

**Regression test added:**

| File | Test |
|---|---|
| `packages/core/src/config.test.ts` | `"secret:true on a number var omits even the string length from the error (Finding 3)"` — confirms `.cause` contains `"expected a number"` but does NOT contain `"length"` or the raw value |

---

### Fix 4 — Coverage gap: `middleware .use()` was a silent no-op

**File changed:** `packages/core/src/server.ts`

**Context and constraint:** The instruction offered two options: (a) implement actual middleware execution, or (b) throw an error from `.use()`. Option (b) was not viable because the existing passing test `"use() accepts a middleware object, does not throw, and returns api"` explicitly asserts `.use()` must not throw. Weakening or deleting that test is not permitted. Therefore option (a) was implemented.

**What was changed:** Added a private `applyMiddleware()` helper that wraps each tool's handler with middleware `before`/`after` hooks. The MCP start path (`createMCPStdioDriver`) now receives `applyMiddleware(tools, middleware)` instead of bare `tools`.

Key correctness property: **when `middleware.length === 0`, `applyMiddleware` returns the original array unchanged**, preserving object identity. This means the existing test `expect(passedTools[0]).toBe(toolA)` (which uses `toBe` for strict identity) continues to pass — no new objects are created on the no-middleware path.

**Middleware execution order:** `before` hooks run in registration order (first registered, first called). `after` hooks run in reverse registration order (last registered, first called), which matches the standard middleware stack pattern (innermost wraps last).

**Inspect paths untouched:** `CLQ_INSPECT_REPORT` and `CLQ_INSPECT` paths use `tools` directly and do not apply middleware. The inspect path is a dev tool, not the production MCP path.

**Regression tests added:**

| File | Test |
|---|---|
| `packages/core/src/server.test.ts` | `"registered middleware before/after hooks are called around tool execution (Fix 4)"` — registers one middleware with before/after spies, calls `start()`, extracts the wrapped tool from the driver mock, invokes its handler, asserts call order is `["before", "handler", "after"]` and hook arguments are correct |
| `packages/core/src/server.test.ts` | `"with no middleware, original tool objects are passed to the driver unchanged (identity preserved)"` — explicitly asserts that without middleware, `passedTools[0] === toolA` and `passedTools[1] === toolB` |

**Public API note:** `.use(mw)` still accepts any `ColloquialMiddleware` object and returns `this` — the method signature is identical. The only change is that the registered hooks now execute. This is a behavior addition, not a signature change.

---

### Fix 5 — Coverage gap #11: Template `package.json` version can drift from published version

**File changed:** `packages/cli/scripts/copy-assets.mjs`

**What was wrong:** `clq init` scaffolds projects with `"@clq-sh/core": "0.1.4"` hardcoded in the template. When the core package version bumps, the build does not fail — it silently ships a stale pin. Users running `clq init` on a newer CLI would get a project referencing an old (possibly yanked) core version.

**What was changed:** Added a version drift guard at the top of `copy-assets.mjs` (runs before the copy step, so nothing is written if the versions mismatch). It reads `../core/package.json` and `src/templates/default/package.json`, compares versions, and calls `process.exit(1)` with a clear error message if they differ. The guard is conditional on `existsSync(corePackagePath)` so it only fires in the monorepo context — not in CI environments where only the CLI package is present.

**Regression test added:**

| File | Test |
|---|---|
| `packages/cli/src/build-templates.test.ts` (new describe block) | `"copy-assets.mjs fails with a clear message when template @clq-sh/core version mismatches core"` — temporarily writes `"0.0.0-version-drift-test"` to the template `package.json`, runs `node scripts/copy-assets.mjs`, asserts exit is non-zero and stderr/stdout contains `"version drift"`, `"0.0.0-version-drift-test"`, and `"@clq-sh/core"`, then restores the file in `finally` |

---

### Additional hardening: `/api/logs` auth gate — test coverage gap closed

**File changed:** `packages/cli/src/commands/inspect/server.test.ts`

The audit (coverage gap #4) noted there were no automated tests for the `/api/logs` endpoint's auth behavior, even though the behavior was confirmed correct manually.

**Test added:**
```
"/api/logs enforces auth: no token → 401, wrong origin → 403, valid → 200"
```
This closes the gap with three assertions in one test: no token yields 401, wrong origin with valid token yields 403, valid token with no origin yields 200.

---

### Additional hardening: 200-entry log cap — test coverage gap closed

**File changed:** `packages/cli/src/commands/inspect/server.test.ts`

The audit (coverage gap #8) noted no test verified that `logs.shift()` was called when `logs.length > 200`, which could silently become unbounded if the cap was accidentally removed.

**Test added:**
```
"call log is capped at 200 entries and oldest entries are evicted first"
```
Makes 205 sequential tool calls via the real inspector HTTP API, then asserts `logs.length === 200`. The test uses the existing `getSecret` tool (already in the fixture), so no new fixture code was needed.

---

## 2. Full Final Test Suite Output

```
 RUN  v2.1.9 E:/CLQ/CLQ

 ✓ packages/cli/src/__e2e__/full-flow.test.ts (7 tests) 44628ms
   ✓ CLQ full end-to-end pipeline > clq init e2e-test scaffolds the expected file tree 668ms
   ✓ CLQ full end-to-end pipeline > clq add ping-tool creates a valid, non-empty tool file 501ms
   ✓ CLQ full end-to-end pipeline > pnpm install and pnpm build succeed in the scaffolded project 11589ms
   ✓ CLQ full end-to-end pipeline > clq doctor exits 0 on a clean project 3521ms
   ✓ CLQ full end-to-end pipeline > clq doctor exits non-zero and the raw secret value never appears in stdout 2185ms
   ✓ CLQ full end-to-end pipeline > clq inspect: forged-Origin→403, no-token→401, valid→200, SIGINT exits cleanly 5070ms
   ✓ CLQ full end-to-end pipeline > clq dev starts watching and exits cleanly on SIGINT with no orphan processes 3132ms
 ✓ packages/cli/src/commands/inspect/server.test.ts (16 tests) 132306ms
   ✓ clq inspect backend (two-process, security) > binds to 127.0.0.1 specifically 2839ms
   ✓ clq inspect backend (two-process, security) > GET / serves the static UI with no token and no Origin 7777ms
   ✓ clq inspect backend (two-process, security) > a traversal path is not served the static file and never leaks host files 8061ms
   ✓ clq inspect backend (two-process, security) > forged Origin is rejected with 403 before any token logic 8675ms
   ✓ clq inspect backend (two-process, security) > no Origin header + valid token is accepted (browser same-origin fetch) 8431ms
   ✓ clq inspect backend (two-process, security) > no Origin header + no token is rejected with 401 8331ms
   ✓ clq inspect backend (two-process, security) > correct Origin but no token is rejected with 401 8523ms
   ✓ clq inspect backend (two-process, security) > correct Origin + token returns the tool list 8646ms
   ✓ clq inspect backend (two-process, security) > a secret-named response field is redacted, never leaked 8416ms
   ✓ clq inspect backend (two-process, security) > an unknown tool name yields a clean 404 JSON error, not a crash 7985ms
   ✓ clq inspect backend (two-process, security) > child crash before tool registration rejects within 5 s with actionable error 2715ms
   ✓ clq inspect backend (two-process, security) > a busy port causes a clean increment, not a throw 3421ms
   ✓ clq inspect backend (two-process, security) > credential-named response fields are redacted in /api/call (Finding 2 regression) 8268ms
   ✓ clq inspect backend (two-process, security) > credential-named fields are redacted in /api/logs after a call (Finding 2 regression) 8712ms
   ✓ clq inspect backend (two-process, security) > /api/logs enforces auth: no token → 401, wrong origin → 403, valid → 200 8823ms
   ✓ clq inspect backend (two-process, security) > call log is capped at 200 entries and oldest entries are evicted first 8935ms
 ✓ packages/cli/src/commands/dev.test.ts (3 tests) 16195ms
   ✓ clq dev (built binary, real tsx watch) > watches, restarts on change, and exits promptly on SIGINT 6595ms
   ✓ clq dev (built binary, real tsx watch) > outside any project: fails cleanly without watching 3514ms
   ✓ clq dev (built binary, real tsx watch) > missing entry file: fails cleanly 3369ms
 ✓ packages/core/src/server.test.ts (11 tests) 25ms
 ✓ packages/core/src/config.test.ts (12 tests) 13ms
 ✓ packages/cli/src/commands/init.test.ts (9 tests) 160ms
 ✓ packages/cli/src/build-templates.test.ts (5 tests) 2673ms
 ✓ packages/core/src/protocol/translate.test.ts (8 tests) 24ms
 ✓ packages/cli/src/commands/doctor.test.ts (4 tests) 28028ms
   ✓ clq doctor (built CLI, spawned) > a clean project exits 0 3103ms
   ✓ clq doctor (built CLI, spawned) > a missing required env var exits non-zero and names its description 2506ms
   ✓ clq doctor (built CLI, spawned) > a wrong-type env var exits non-zero and the raw secret value never appears in stdout (Finding 1 regression) 2567ms
   ✓ clq doctor (built CLI, spawned) > an injected secret exits non-zero and the raw value never appears in stdout 2348ms
 ✓ packages/core/src/protocol/mcp-stdio-driver.test.ts (4 tests) 13851ms
   ✓ MCP stdio driver (real SDK, spawned process) > responds to initialize with a well-formed result 524ms
 ✓ packages/core/src/tool.test.ts (6 tests) 17ms
 ✓ packages/cli/src/commands/add.test.ts (4 tests) 125ms
 ✓ packages/core/src/errors.test.ts (35 tests) 22ms
 ✓ packages/cli/src/utils/redact.test.ts (37 tests) 16ms  ← NEW FILE
 ✓ packages/cli/src/utils/secret-scan.test.ts (5 tests) 52ms
 ✓ packages/core/src/types.test.ts (4 tests) 4ms
 ✓ packages/cli/src/index.test.ts (3 tests) 3977ms
   ✓ clq CLI (built binary) > --version prints the package version 538ms
   ✓ clq CLI (built binary) > --help exits 0 554ms
   ✓ clq CLI (built binary) > an unknown command exits non-zero and leaks no stack trace 571ms
 ✓ packages/cli/src/utils/exec-safe.test.ts (2 tests) 187ms

 Test Files  18 passed (18)
       Tests  175 passed (175)
    Start at  02:08:50
    Duration  256.26s
```

**Result: 100% pass — 175/175 tests, 18/18 test files. Count increased from 128 → 175 (+47 tests).**

---

## 3. Additional Hardening — Things Found But Not Fixed (for triage)

The additional hardening scan (`grep` across `config.ts`, `doctor.ts`, and `inspect/server.ts`) found no new raw env value leaks beyond what REPORT.md already identified. Specifically:

- `doctor.ts` line 23: `process.env.CLQ_CONFIG_PATH` — this is a file path, not a secret. It's used as a path argument to the tsx child process, not printed to stdout.
- `inspect/server.ts` line 302: `redactSecrets(stderrOutput.trim())` — the stderr from the child is already passed through `redactSecrets` before appearing in the thrown error. This was the correct implementation before the audit. However, `redactSecrets` now covers more patterns (Fix 2), so any secrets the child process might print to stderr via matching key names are additionally protected.

**Remaining open items from REPORT.md coverage gaps (not fixed, requiring separate triage):**

| Gap | Reason not fixed here |
|---|---|
| Gap #5: `clq init` without a TTY crashes with `ERR_TTY_INIT_FAILED` | Outside this prompt's scope. The fix requires `@clack/prompts` error handling or a pre-TTY check in the init command. |
| Gap #6: `validateSlug` allows uppercase and leading digits | Outside scope. Fixing this would be a breaking change to the validator's accepted input set and affects user-facing CLI behavior beyond the security/correctness scope of this PR. |
| Gap #7: non-numeric `CLQ_INSPECT_PORT` produces `NaN` | Outside scope. Low severity; `NaN` as a port number causes the `http.listen()` to fail with a clear system error, not silent misbehavior. |
| Gap #9: oversized body handling is not automatically tested | Outside scope. Manually confirmed in the audit. Would require a new test that sends a >1MB payload and asserts a connection reset — unusual to automate in this test environment. |
| Gap #12: MCP SDK limits with large/deep tool payloads | Outside scope. Would require MCP SDK source investigation. |

---

## 4. Public API Compatibility Confirmation

No public API signatures were changed in a breaking way. Specifically:

| Symbol | Change | Breaking? |
|---|---|---|
| `defineConfig()` | Unchanged | No |
| `loadConfig()` | Error messages changed (no raw value, adds "length N") | No — the error *code* (`CONFIG_MISSING_ENV_VAR`) and *type* (`ColloquialErrorImpl`) are identical. Applications that only check `.code` or instance type are unaffected. Applications that pattern-match the exact `.cause` string would see the new format, but that was never part of the documented contract. |
| `defineTool()` | Unchanged | No |
| `createServer()` | `.use()` now has real effect (middleware executes). No signature change. | No — was documented as "reserved for a future release"; execution is the intended behavior. Callers that registered middleware expecting it to be ignored would now see their hooks called. This is an intentional behavior promotion, not a breaking change. |
| `ColloquialMiddleware` type | Unchanged | No |
| `ColloquialToolDefinition` type | Unchanged | No |
| `ColloquialError` / `ColloquialErrorImpl` | Unchanged | No |
| `redactSecrets()` | Pattern extended; more keys now return `[REDACTED]` | No — all keys that were previously redacted still are. New keys are additionally redacted. A caller that expected `{ authorization: "Bearer sk-..." }` from a tool response will now get `{ authorization: "[REDACTED]" }`, but that is the security fix, not a contract violation. |
