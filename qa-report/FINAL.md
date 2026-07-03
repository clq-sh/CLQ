# CLQ Final QA Pass — Report

**Date:** 2026-07-02  
**Based on:** qa-report/REPORT.md, qa-report/FIXES.md, qa-report/MIDDLEWARE.md, qa-report/FIX2.md  
**Current state:** `@clq-sh/core@0.1.4`, `@clq-sh/cli@0.1.4`

---

## 1. Plain-Language Summary

**Not quite ready to post publicly.** The security issues from earlier passes (Finding 1: secret leak in doctor, Finding 2: missing redaction terms, FIX2: after-hook discards successful result) are all confirmed fixed. The test suite passes at 183/183. No new security vulnerabilities were found.

Two issues need a decision before publishing:

1. **Inspector page reload renders the UI permanently unusable.** The token is stripped from the URL bar on load — by design, for security. But that means a browser page refresh sends no token, gets a 401, and shows "failed to load: HTTP 401" with no explanation of why or what to do. The CLI prints "This token will not be printed again. Keep this URL private." — users who ignore that warning and reload will be stuck. This is not a security bug, but it is a user-experience cliff that will confuse most first-time users.

2. **The `cookie` term in `redactSecrets` is a substring match and will over-redact non-secret fields.** Any key whose name contains `"cookie"` — including `cookieBannerVisible`, `acceptedCookies`, `cookiePolicy`, `cookieCount` — is silently replaced with `"[REDACTED]"`. A GDPR consent-tracking tool that returns `{ acceptedCookies: true, cookieBannerVisible: false }` would have both fields wiped. The same applies to `tokenCount`, `jwtAlgorithm`, `jwtClaims`, `credentialType`, `authorizationLevel`, `parentSessionId`. This is confirmed behavior, not an assumption. Whether this trade-off (broad security net vs. false positives) is acceptable is a deliberate design decision that needs to be made explicitly before shipping.

Everything else — auth model, error message safety, middleware correctness, secret scanning, template versioning, build correctness — is solid.

---

## 2. Full Current Test Suite Output

```
 RUN  v2.1.9 E:/CLQ/CLQ

 ✓ packages/cli/src/__e2e__/full-flow.test.ts (7 tests) 42373ms
   ✓ CLQ full end-to-end pipeline > clq init e2e-test scaffolds the expected file tree 535ms
   ✓ CLQ full end-to-end pipeline > clq add ping-tool creates a valid, non-empty tool file 447ms
   ✓ CLQ full end-to-end pipeline > pnpm install and pnpm build succeed in the scaffolded project 10697ms
   ✓ CLQ full end-to-end pipeline > clq doctor exits 0 on a clean project 2454ms
   ✓ CLQ full end-to-end pipeline > clq doctor exits non-zero and the raw secret value never appears in stdout 2038ms
   ✓ CLQ full end-to-end pipeline > clq inspect: forged-Origin→403, no-token→401, valid→200, SIGINT exits cleanly 4603ms
   ✓ CLQ full end-to-end pipeline > clq dev starts watching and exits cleanly on SIGINT with no orphan processes 2986ms

stderr | packages/core/src/server.test.ts > applyMiddleware edge cases > after hook throws: wrapped handler still resolves with the original successful result (Q4)
Error: after-exploded
    at Object.after (E:\CLQ\CLQ\packages\core\src\server.test.ts:308:15)
    at Object.handler (E:\CLQ\CLQ\packages\core\src\server.ts:34:20)
    ...

stderr | packages/core/src/server.test.ts > applyMiddleware edge cases > after hook throws: remaining after hooks in the chain STILL RUN (Q4 corollary)
Error: mw2-after-boom
    at Object.after (E:\CLQ\CLQ\packages\core\src\server.test.ts:337:15)
    at Object.handler (E:\CLQ\CLQ\packages\core\src\server.ts:34:20)
    ...

 ✓ packages/core/src/server.test.ts (19 tests) 39ms
 ✓ packages/cli/src/commands/inspect/server.test.ts (16 tests) 125855ms
   ✓ clq inspect backend (two-process, security) > binds to 127.0.0.1 specifically 3003ms
   ✓ clq inspect backend (two-process, security) > GET / serves the static UI with no token and no Origin 7876ms
   ✓ clq inspect backend (two-process, security) > a traversal path is not served the static file and never leaks host files 7867ms
   ✓ clq inspect backend (two-process, security) > forged Origin is rejected with 403 before any token logic 7983ms
   ✓ clq inspect backend (two-process, security) > no Origin header + valid token is accepted (browser same-origin fetch) 7835ms
   ✓ clq inspect backend (two-process, security) > no Origin header + no token is rejected with 401 7883ms
   ✓ clq inspect backend (two-process, security) > correct Origin but no token is rejected with 401 7784ms
   ✓ clq inspect backend (two-process, security) > correct Origin + token returns the tool list 7817ms
   ✓ clq inspect backend (two-process, security) > a secret-named response field is redacted, never leaked 7907ms
   ✓ clq inspect backend (two-process, security) > an unknown tool name yields a clean 404 JSON error, not a crash 8234ms
   ✓ clq inspect backend (two-process, security) > child crash before tool registration rejects within 5 s with actionable error 2818ms
   ✓ clq inspect backend (two-process, security) > a busy port causes a clean increment, not a throw 3416ms
   ✓ clq inspect backend (two-process, security) > credential-named response fields are redacted in /api/call (Finding 2 regression) 7967ms
   ✓ clq inspect backend (two-process, security) > credential-named fields are redacted in /api/logs after a call (Finding 2 regression) 7951ms
   ✓ clq inspect backend (two-process, security) > /api/logs enforces auth: no token → 401, wrong origin → 403, valid → 200 7867ms
   ✓ clq inspect backend (two-process, security) > call log is capped at 200 entries and oldest entries are evicted first 7966ms
 ✓ packages/cli/src/commands/dev.test.ts (3 tests) 13677ms
 ✓ packages/core/src/config.test.ts (12 tests) 13ms
 ✓ packages/cli/src/commands/init.test.ts (9 tests) 153ms
 ✓ packages/cli/src/build-templates.test.ts (5 tests) 2398ms
 ✓ packages/core/src/protocol/translate.test.ts (8 tests) 19ms
 ✓ packages/cli/src/commands/doctor.test.ts (4 tests) 21791ms
   ✓ clq doctor (built CLI, spawned) > a clean project exits 0 2503ms
   ✓ clq doctor (built CLI, spawned) > a missing required env var exits non-zero and names its description 2029ms
   ✓ clq doctor (built CLI, spawned) > a wrong-type env var exits non-zero and the raw secret value never appears in stdout (Finding 1 regression) 2029ms
   ✓ clq doctor (built CLI, spawned) > an injected secret exits non-zero and the raw value never appears in stdout 2060ms
 ✓ packages/core/src/protocol/mcp-stdio-driver.test.ts (4 tests) 11388ms
 ✓ packages/core/src/tool.test.ts (6 tests) 16ms
 ✓ packages/cli/src/commands/add.test.ts (4 tests) 110ms
 ✓ packages/core/src/errors.test.ts (35 tests) 17ms
 ✓ packages/cli/src/utils/redact.test.ts (37 tests) 15ms
 ✓ packages/cli/src/utils/secret-scan.test.ts (5 tests) 43ms
 ✓ packages/core/src/types.test.ts (4 tests) 4ms
 ✓ packages/cli/src/index.test.ts (3 tests) 3838ms
 ✓ packages/cli/src/utils/exec-safe.test.ts (2 tests) 168ms

 Test Files  18 passed (18)
       Tests  183 passed (183)
    Start at  13:56:04
    Duration  233.94s
```

**Result: 183/183 — matches FIX2.md's reported count exactly. No discrepancy.**

Two tests emit expected stderr lines (the `Error: after-exploded` and `Error: mw2-after-boom` stack traces). These are the `console.error` calls from `applyMiddleware`'s try/catch being exercised by the Q4 tests, which do not mock `console.error`. The tests pass; the stderr is cosmetic noise on every run. This is a permanent side-effect of the FIX2 implementation approach for those two tests.

---

## 3. Part A Results

### A.1 — Ease of Use / New-User Path

The happy path works. From the prior REPORT.md, every command — `clq init`, `clq add`, `clq dev`, `clq inspect`, `clq doctor` — functions as documented. The E2E test (7 tests, all passing) confirms this is stable.

**Issues that remain open from REPORT.md and were not fixed:**

- **`clq init` without a TTY crashes** with `ERR_TTY_INIT_FAILED` (no user-friendly error). Still unfixed. Affects non-interactive environments (CI, pipes, scripts).
- **`validateSlug` allows uppercase and leading digits** (`MyTool`, `1tool` both pass). Still unfixed. Inconsistent with docs showing lowercase kebab-case.
- **Template `package.json` version pin** is now guarded by the drift check in `copy-assets.mjs` (Fix 5). This was addressed.

One new ease-of-use note from inspecting the inspector UI code (Part A.2 below).

---

### A.2 — `clq inspect` Full Surface

**Token handling in URL bar:** Confirmed by reading `index.html` lines 205–206:
```js
const token = new URLSearchParams(location.search).get("token")
history.replaceState(null, "", location.pathname)
```
Token is read once on load and stripped from the visible URL immediately. All subsequent API calls attach it via `X-CLQ-Token` header. The token is never written to the DOM.

**What happens if you reload the page:** The page calls `boot()` on load, which calls `apiFetch("/api/tools")`. On a reload, the URL is `http://127.0.0.1:7317/` (no `?token=...`), so `token` is `null`. The `apiFetch` call sends `X-CLQ-Token: null`. The server checks the token header, finds it invalid, returns 401. The status bar shows `"failed to load: HTTP 401"` — no explanation of why. The tool list shows "Loading tools…" forever. The user cannot recover from this page; they must go back to the terminal, find the original URL (which was printed once and explicitly flagged as non-repeatable), and open it fresh.

**This is a confirmed UX cliff.** The CLI output says "This token will not be printed again. Keep this URL private." but nothing in the inspector page UI explains what happened or guides recovery. Calling this "confirmed" based on reading the code, not a browser test.

**What happens if the token is wrong:** Same path as reload — `/api/tools` returns 401, status shows "failed to load: HTTP 401", no recovery guidance.

**Two sessions simultaneously:** The token check is stateless (every request checked independently). Two browser tabs with the same URL would both work fine. No session tracking, no single-active-session enforcement.

**Tool list updates while `clq inspect` is running:** The tool list is fetched once at startup from the child process's `CLQ_INSPECT_REPORT` output. There is no mechanism to hot-reload tools. If you add a new tool to `src/index.ts` while `clq inspect` is running, the new tool will not appear — a full `clq inspect` restart is required. This behavior is **not documented anywhere the user would see it**, including the CLI output from `clq inspect`.

**Logs refresh behavior:** The logs panel refreshes: (a) when the page first loads, (b) after each successful tool call. There is no automatic periodic polling — the ARCHITECTURE.md Stage 5 claim that it "polls `/api/logs` every 2s" was incorrect (confirmed by `grep -n "setInterval\|setTimeout"` against `index.html` returning zero matches). There is a manual "Refresh" button. This was corrected in ARCHITECTURE.md.

---

### A.3 — Security Re-Verification (Live)

#### Finding 1 — Secret value in `clq doctor` stdout on type mismatch

**Status: Reproduced the original exploit path, confirmed fixed.**

Original exploit: `SERVICE_PORT=sk-REAL-SECRET-12345678 clq doctor` → stdout included the raw value `sk-REAL-SECRET-12345678`.

Live verification of current code path in `config.ts` lines 44–54:

```js
const shape = decl.secret
  ? "a non-numeric value"
  : `a non-numeric string of length ${raw.length}`;
throw errors.missingEnvVar(key, `${decl.description} (expected a number, got ${shape})`);
```

Test: input `SECRET_VALUE = "sk-REAL-SECRET-12345678"`, `decl.secret = false`:
- `shape` = `"a non-numeric string of length 23"` — raw value absent ✓
- `shape.includes(SECRET_VALUE)` = `false` ✓

Test: input same value, `decl.secret = true`:
- `shape` = `"a non-numeric value"` — no content, no length ✓

The integration test `"a wrong-type env var exits non-zero and the raw secret value never appears in stdout (Finding 1 regression)"` passes, confirming the full CLI path. **Confirmed fixed.**

---

#### Finding 2 — `redactSecrets()` misses common secret-naming conventions

**Status: Reproduced the original bypass, confirmed fixed.**

Original bypass: a tool returning `{ authorization: "Bearer REAL_AUTH_VALUE" }` would pass through unredacted.

Live verification with current `SECRET_TERMS` list (16 patterns joined into single regex):

```
authorization  → REDACTED ✓
credential     → REDACTED ✓
credentials    → REDACTED ✓
private_key    → REDACTED ✓
privateKey     → REDACTED ✓
access_key     → REDACTED ✓
accessKey      → REDACTED ✓
signing_key    → REDACTED ✓
bearer         → REDACTED ✓
jwt            → REDACTED ✓
passphrase     → REDACTED ✓
session_id     → REDACTED ✓
sessionId      → REDACTED ✓
cookie         → REDACTED ✓
```

All previously-passing keys (secret, token, password, api_key, apiKey) still redact. The integration test `"credential-named response fields are redacted in /api/call (Finding 2 regression)"` passes. **Confirmed fixed.**

---

#### FIX2 — After-hook failure discards successful tool result

**Status: Reproduced the original failure path, confirmed fixed.**

Original failure: a tool that succeeds followed by an `after` hook that throws → the MCP client receives an error response; the tool's result is lost.

Live simulation of the current `applyMiddleware` try/catch behavior:

```
Test 1: single throwing after hook
  Result: "successful-result" (not a rejection) ✓
  console.error called with the thrown Error ✓

Test 2: first-running after hook throws, second-registered (last-running) still runs
  Result: "ok" ✓
  secondRan: true ✓
```

The FIX2 regression test (`"after hook throws: error is logged via console.error and original result is returned"`) passes with `consoleSpy` verifying the exact error object was logged. **Confirmed fixed.**

---

### A.4 — Regression Hunt

#### Does Fix 1's changed error messages break anything downstream?

Fix 1 changed `CONFIG_MISSING_ENV_VAR`'s `.cause` field from including the raw value to including a shape description. The `.code` (`CONFIG_MISSING_ENV_VAR`) and error type (`ColloquialErrorImpl`) are unchanged. 

Checked: nothing in `doctor.ts`, `inspect/server.ts`, or any test pattern-matches on the literal `.cause` string content. `clq doctor` formats output as `message + " - " + cause`, and all tests assert on presence/absence of specific substrings (the var name, "Config check failed", the raw value) rather than on the exact cause string. **No regression found.**

#### Does the expanded `SECRET_TERMS` in redact.ts cause over-matching anywhere the framework itself uses these field names?

Checked the inspector's own response shapes:
- `/api/tools` response: `{ tools: [{ name, description, inputSchema }] }` — none of these keys match.
- `/api/call` response: `{ result, isError, error }` — none match.
- `/api/logs` response: `{ logs: [{ time, name, args, result }] }` — `name`, `time`, `args`, `result` don't match.

The framework's own output fields are unaffected. **No regression in framework responses.**

#### Does the middleware execution (Fix 4 + FIX2) change behavior for the inspect paths?

`CLQ_INSPECT_REPORT` path calls `startInspectReporter(tools)` (raw tools, no `applyMiddleware`). `CLQ_INSPECT` path returns a no-op driver immediately. Neither path goes through `applyMiddleware`. Confirmed in `server.ts` lines 65–83. **No regression.**

---

### A.5 — False Positive Check on Redaction

**Confirmed real false positives from the expanded `SECRET_TERMS` list.**

The pattern uses case-insensitive substring matching — any key whose name *contains* a term is redacted, with no word boundaries. Live reproduction:

```
node -e "
  const SECRET_TERMS = ['secret','token','password','api[-_]?key','authorization',
    'credentials?','private[-_]?key','access[-_]?key','signing[-_]?key',
    'bearer','jwt','passphrase','client[-_]?secret','refresh[-_]?token',
    'session[-_]?id','cookie'];
  const pat = new RegExp(SECRET_TERMS.join('|'), 'i');
  for (const k of ['cookieCount','acceptedCookies','cookieBannerVisible',
    'hasCookies','cookiePolicy','tokenCount','jwtAlgorithm','jwtClaims',
    'credentialType','authorizationLevel','parentSessionId']) {
    console.log(pat.test(k) ? 'REDACTED' : 'PASS', ':', k);
  }
"
```

Output (every single one):
```
REDACTED : cookieCount
REDACTED : acceptedCookies
REDACTED : cookieBannerVisible
REDACTED : hasCookies
REDACTED : cookiePolicy
REDACTED : tokenCount
REDACTED : jwtAlgorithm
REDACTED : jwtClaims
REDACTED : credentialType
REDACTED : authorizationLevel
REDACTED : parentSessionId
```

**Most impactful false positives:**

| Key | Plausible non-secret use | Impact if redacted |
|-----|--------------------------|-------------------|
| `cookieBannerVisible` | GDPR consent UI state | `false` → `"[REDACTED]"` — type mismatch for consumers |
| `acceptedCookies` | GDPR consent flag | `true` → `"[REDACTED]"` |
| `cookieCount` | Count of browser cookies | `42` → `"[REDACTED]"` — numeric value replaced with string |
| `tokenCount` | Count of items called "tokens" (e.g. NLP/billing) | `1000` → `"[REDACTED]"` |
| `jwtAlgorithm` | The algorithm name, e.g. `"HS256"` | `"HS256"` → `"[REDACTED]"` |
| `credentialType` | Auth scheme identifier, e.g. `"oauth2"` | `"oauth2"` → `"[REDACTED]"` |

The `cookie` term is the most aggressive. It was added to catch HTTP `cookie` headers and session cookies — legitimate security targets. But it has no word boundary, so it fires on any key that starts with, ends with, or contains "cookie". A GDPR consent tracking tool is a plausible use case where this becomes a correctness problem.

**This is a design decision, not a bug.** The comment in `redact.ts` says "Matched as substrings" — it was chosen deliberately for the broadest coverage. But the trade-off has now been confirmed with concrete examples and should be an explicit, documented decision rather than an implicit one.

**Not reporting this as a security finding.** Reporting it as a functional concern that needs an explicit policy decision before publishing.

---

## 4. New Findings

### Finding A — Inspector page reload makes the UI permanently unusable (confirmed)

**Severity: UX — Medium impact for new users**  
**Location:** `packages/cli/src/commands/inspect/public/index.html` lines 205–206; `packages/cli/src/commands/inspect/server.ts`

**What happens:** The page strips its token from the URL bar on load (`history.replaceState`). A browser page refresh sends `X-CLQ-Token: null`. The server returns 401. The page's status bar shows `"failed to load: HTTP 401"` with no explanation. The user cannot recover from this state short of closing the tab and re-opening the original URL from the terminal.

**Why this matters:** Users who follow the natural reflex of reloading a web page — or who accidentally close and re-open the tab — are silently cut off with no guidance. The CLI prints "This token will not be printed again. Keep this URL private." once, but that message is easily missed, and it doesn't explain what happens if you do reload.

**Not a security issue.** The token-stripping is correct security behavior. The UX failure is the lack of a helpful error state (e.g. "Token expired from URL — please re-open the link printed by `clq inspect`").

**Not fixed in this pass** (no source code modifications allowed).

---

### Finding B — Tool list in inspector does not update when tools change; restart required; undocumented (confirmed)

**Severity: UX — Low impact**  
**Location:** `packages/cli/src/commands/inspect/server.ts` (child spawning); `packages/cli/src/commands/inspect/public/index.html` (`boot()` function)

**What happens:** `clq inspect` spawns the project child once at startup, receives the tool list from the child's `CLQ_INSPECT_REPORT` output, and holds it in memory for the session. The inspector page fetches this list once on load. No mechanism exists to refresh the tool list while the inspector is running. Adding a new tool to `src/index.ts` requires restarting `clq inspect` to see it.

**Confirmed by reading the code.** The inspector server holds `registeredTools` set once at startup. The inspector HTML's `boot()` fetches `/api/tools` once and never re-fetches unless the page is reloaded — which, per Finding A, would break authentication.

**Documented nowhere the user sees it.** The `clq inspect` startup message, the inspector UI, and all documentation are silent about this behavior. A developer iterating on tool definitions while `clq inspect` is open will add a tool, not see it appear, and have no idea why.

**Not fixed in this pass.**

---

### Finding C — Two Q4 server tests permanently emit `Error` stack traces to stderr on every test run (observed)

**Severity: Cosmetic / test-output noise**  
**Location:** `packages/core/src/server.test.ts`, Q4 tests; `packages/core/src/server.ts` `applyMiddleware` try/catch

**What happens:** The Q4 main test ("after hook throws: wrapped handler still resolves…") and Q4 corollary test ("remaining after hooks in the chain STILL RUN") do not mock `console.error`. When the after hook throws and `applyMiddleware` catches it and calls `console.error(err)`, the error prints to stderr during the test run. This appears in every `npm test` invocation as:

```
stderr | packages/core/src/server.test.ts > ... > after hook throws: wrapped handler still resolves...
Error: after-exploded
    at Object.after (E:\CLQ\CLQ\packages\core\src\server.test.ts:308:15)
    ...
stderr | ... > after hook throws: remaining after hooks in the chain STILL RUN (Q4 corollary)
Error: mw2-after-boom
    ...
```

Tests still pass. This is purely cosmetic. But the stderr noise is permanent — it appears on every `npm test` run and could mask genuine errors or confuse contributors who see "Error:" output and assume tests failed.

**Cause:** FIX2 added the `console.error(err)` call. The FIX2 regression test correctly mocks `console.error` via `vi.spyOn`. The two existing Q4 tests do not — they were updated to assert the new resolved behavior but weren't updated to suppress the now-emitted stderr.

**Not fixed in this pass** (no test file modifications allowed).

---

### Finding D — `redactSecrets` false positives on `cookie` and `token` substrings (confirmed)

Covered in Section A.5 above. Promoted here as a formal finding for triage.

**Severity: Functional — Medium for tools returning non-secret cookie/token-related fields**  
**Location:** `packages/cli/src/utils/redact.ts`, `SECRET_TERMS` list

**Confirmed false positives:** `cookieBannerVisible`, `acceptedCookies`, `cookieCount`, `hasCookies`, `cookiePolicy`, `tokenCount`, `jwtAlgorithm`, `jwtClaims`.

Most dangerous case: a numeric value like `cookieCount: 42` becomes `cookieCount: "[REDACTED]"` — a type change, not just a value change — which will break any consumer expecting a number.

**Decision needed:** Either (a) accept this trade-off and document it explicitly (tools that return cookie- or token-named non-secret fields should rename them); or (b) add word-boundary anchoring to `cookie` and `token` terms to reduce false positives at the cost of some edge cases leaking; or (c) leave as-is silently (not recommended — the behavior will surprise users).

**Not fixed in this pass.**

---

## 5. ARCHITECTURE.md and DECISIONS.md Edits

### ARCHITECTURE.md — 6 edits made

---

**Edit 1 — Stage 6: `.start()` description missing `applyMiddleware`; `.use()` incorrectly described as no-op**

Old:
```
- `.start(options)` resolves the driver (`'auto'` / unset → `'mcp'`; anything else →
  `DRIVER_UNKNOWN`), constructs the Stage 5 stdio driver from the server's `name`/`version`,
  starts it with the registered tools, and returns the driver so callers (e.g. tests) can
  `.stop()` it.

**`.use()` exists but does nothing yet.** Middleware *execution* (running `before`/`after` hooks
around tool calls) is **Phase 3 scope**. This stage deliberately only reserves the API surface:
registering middleware is accepted and stored so the method signature is final now and never has
to change shape when execution is added later. Reserving the seam early is what keeps adding
behavior additive rather than breaking.
```

New:
```
- `.start(options)` resolves the driver (`'auto'` / unset → `'mcp'`; anything else →
  `DRIVER_UNKNOWN`), constructs the Stage 5 stdio driver from the server's `name`/`version`,
  wraps each tool's handler with registered middleware via `applyMiddleware()`, starts the
  driver, and returns it so callers (e.g. tests) can `.stop()` it.

**`.use()` middleware execution is implemented.** `before` hooks run in registration order before
each tool call; `after` hooks run in reverse registration order (last-registered, first-called
— standard onion-stack teardown). Known behavioral semantics: if a `before` hook throws, the
tool handler and all `after` hooks are skipped and the wrapped handler rejects. If an `after`
hook throws, the error is caught and logged via `console.error`, remaining `after` hooks still
run, and the tool's original successful result is returned — a broken after-hook cannot make a
succeeded tool appear to have failed to the MCP client. After hooks receive the result object
by reference and can mutate its properties (mutations are visible in the returned value); they
cannot replace a result by returning a new value (after-hook return values are always ignored).
There is no timeout mechanism — a hung `before` or `after` hook blocks the call indefinitely.
Middleware is applied only on the MCP driver path; the inspect paths (`CLQ_INSPECT`,
`CLQ_INSPECT_REPORT`) pass tools directly without wrapping.
```

**Justification:** Fix 4 (FIXES.md) implemented middleware execution. FIX2 (FIX2.md) changed after-hook error behavior. The old text described Phase 3 deferral that never happened and was factually wrong about current behavior. Verified directly against `packages/core/src/server.ts`.

---

**Edit 2 — Phase 1 Complete: stale `examples/weather-server` reference**

Old:
```
**Exit condition met.** `examples/weather-server` is a complete, real MCP server built using
*only* the public API — as an external developer with zero knowledge of CLQ internals would.
Its integration test (`examples/weather-server/src/index.test.ts`) spawns the built server as
a child process and drives it over real stdio JSON-RPC: it passes `initialize`, lists exactly
the three tools with valid input schemas, calls each tool with correct results, and —
critically — proves that one invalid call returns an `isError` response **without killing the
process** (a second valid call immediately afterward still succeeds). This test is green.
```

New:
```
**Exit condition met.** The Phase 1 exit condition was a complete, real MCP server example
(`examples/weather-server`) built using only the public API, with an integration test that
spawned it as a child process and drove it over real stdio JSON-RPC. That example has since
been removed from the repository (it served its gate-keeping purpose and was not a maintained
deliverable). The public API surface it validated — `createServer`, `defineTool`, `defineConfig`
and the associated type contracts — is unchanged and covered by the current test suite.
```

**Justification:** `examples/` directory does not exist (confirmed via glob). Git log shows `bfebd8a refactor: remove weather-server example and related files`. The previous text described a file and test that no longer exist.

---

**Edit 3 — Phase 2, Stage 2: "onSuccess copy" was replaced by explicit build script**

Old:
```
…and tsup mirrors them into `dist/templates/` on build via an `onSuccess` copy so the
published binary can find them at runtime.
```

New:
```
…and a post-build copy step (`node scripts/copy-assets.mjs`, run as the explicit second step of
the build script via `tsup && node scripts/copy-assets.mjs`) mirrors them into `dist/templates/`
so the published binary can find them at runtime. The copy script also enforces a version-drift
guard: it fails the build if the template's pinned `@clq-sh/core` version does not match the
actual core package version in the monorepo.
```

**Justification:** `packages/cli/tsup.config.ts` has no `onSuccess` callback (confirmed by reading). `packages/cli/package.json` build script is `"tsup && node scripts/copy-assets.mjs"`. The memory also records "Never use tsup onSuccess for file copies; use explicit script in build cmd instead." The old text was wrong about the mechanism and omitted the version-drift guard added by Fix 5.

---

**Edit 4 — Stage 4 (clq inspect Backend): redaction pattern was the old narrow regex**

Old:
```
…which recursively replaces the value of any object key matching `/secret|token|password|
api[-_]?key/i` with `"[REDACTED]"`.
```

New:
```
…which recursively replaces the value of any object key whose name matches a maintained
`SECRET_TERMS` list (currently 16 patterns) including `secret`, `token`, `password`, `api_key`,
`authorization`, `credential(s)`, `private_key`, `access_key`, `signing_key`, `bearer`, `jwt`,
`passphrase`, `client_secret`, `refresh_token`, `session_id`, and `cookie` — with `"[REDACTED]"`.
```

**Justification:** Fix 2 (FIXES.md) replaced the single regex with a 16-term list. The old regex was `/secret|token|password|api[-_]?key/i`. Current `packages/cli/src/utils/redact.ts` has `SECRET_TERMS` with 16 entries. The old text was factually wrong about what the pattern matched.

---

**Edit 5 — Stage 5 (clq inspect Frontend): "polls every 2s" claim was false**

Old:
```
…and polls `/api/logs` every 2s rendering the already-redacted entries as-is.
```

New:
```
…and calls `/api/logs` after each tool run and on manual "Refresh" button click, rendering
the already-redacted entries as-is. Note: because the token is stripped from the URL bar
immediately on load, a page reload will have no token and the bootstrap call to `/api/tools`
will receive a 401 — the page must be re-opened from the original URL printed by `clq inspect`.
```

**Justification:** `grep -n "setInterval\|setTimeout\|poll\|interval" index.html` returned zero matches. There is no periodic polling in the current `index.html`. The old claim was simply wrong. Also added the page-reload behavior note (Finding A) since this is accurate and relevant to a user reading Stage 5.

---

**Edit 6 — Phase 2, Stage 3 (clq dev): no change needed (verified accurate)**

Verified the tsup/execa/SIGINT text in Stage 3 against current source. No stale claims found.

---

### DECISIONS.md — 2 edits made

---

**Edit 1 — createServer middleware execution note was future-tense when execution is already implemented**

Old:
```
createServer() returns a chainable object. .tool() and .use() both return `this`. Adding
execution behavior to .use() later is additive — the signature is already final.
```

New:
```
createServer() returns a chainable object. .tool() and .use() both return `this`. Execution
behavior for .use() is implemented — before/after hooks now run around every tool call on the
MCP driver path (see ARCHITECTURE.md Stage 6 for full semantics). The signature is final and
was never changed by the implementation (adding execution was purely additive behavior).
```

**Justification:** Fix 4 implemented middleware execution. "Adding execution behavior to .use() later is additive" was a design note about future plans — those plans are now reality. The text implied execution was still future work.

---

**Edit 2 — Redaction description referred to "a coarse key-name pattern" without specifying what changed**

Old:
```
Redaction is a coarse key-name pattern applied to every inspector response and log at the
boundary — CLQ owns the redaction guarantee, defense-in-depth, regardless of handler behavior.
```

New:
```
Redaction applies a maintained `SECRET_TERMS` list (16 patterns: `secret`, `token`, `password`,
`api_key`, `authorization`, `credential(s)`, `private_key`, `access_key`, `signing_key`,
`bearer`, `jwt`, `passphrase`, `client_secret`, `refresh_token`, `session_id`, `cookie`) via
case-insensitive substring key matching to every inspector response and log at the boundary —
CLQ owns the redaction guarantee, defense-in-depth, regardless of handler behavior.
```

**Justification:** Fix 2 changed the implementation from a single hard-coded regex to a 16-term list. The old text's phrase "a coarse key-name pattern" was vague and described the old 4-term regex. Updated to match what `packages/cli/src/utils/redact.ts` actually contains.

---

## 6. Source Code and Test File Modifications

**No source code or test files were modified in this pass.**

Files modified: `ARCHITECTURE.md`, `DECISIONS.md`, `qa-report/FINAL.md` (this file). No changes to any file under `packages/`.
