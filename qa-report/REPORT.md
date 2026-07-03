# CLQ QA and Security Audit Report

**Date:** 2026-07-02  
**Audited versions:** `@clq-sh/core@0.1.4`, `@clq-sh/cli@0.1.4`  
**Environment:** Windows 10 Pro 10.0.19045, Node.js v18.20.6, pnpm

---

## 1. Summary

CLQ works end-to-end for a new user on the happy path. `clq init`, `clq add`, `clq dev`, `clq doctor`, and `clq inspect` all function as documented. The test suite is comprehensive and passes 128/128. The inspector's auth model (Origin + token gate, loopback-only binding) is correctly implemented with no bypass found.

**The single biggest risk if shipped today is a confirmed secret leak in `clq doctor`:** when an env var is declared as `type: "number"` in `clq.config.ts` but the actual runtime value is non-numeric (e.g., a mistyped or misrouted API key), `clq doctor` prints the full literal value to stdout as part of the error message. For teams that log CI stdout or pipe `clq doctor` output to dashboards, this is a credential-exposure incident waiting to happen.

A secondary confirmed finding: `redactSecrets()` — the function that guards inspector API responses — does not cover several common secret-field naming conventions (`authorization`, `credential`, `access_key`, `credentials`, `private_key`, `bearer`, `jwt`, `passphrase`, `signing_key`). Tool handlers that return data in any of these fields will leak it through `/api/call` and `/api/logs` responses. This is defense-in-depth that does not currently defend against the most common real-world naming patterns.

All dependency audit vulnerabilities are in **dev dependencies only** (vitest, vite, esbuild used during testing and building) and are not shipped to end users.

---

## 2. Test Suite Results

### Command run
```
pnpm build && pnpm test
```

### Build output (clean)
```
packages/core build: ESM Build success in 98ms
packages/core build: DTS Build success in 9534ms
packages/cli build: ESM Build success in 131ms
```

### Test output (verbatim)
```
 RUN  v2.1.9 E:/CLQ/CLQ

 ✓ packages/cli/src/__e2e__/full-flow.test.ts (7 tests) 42992ms
   ✓ CLQ full end-to-end pipeline > clq init e2e-test scaffolds the expected file tree 773ms
   ✓ CLQ full end-to-end pipeline > clq add ping-tool creates a valid, non-empty tool file 486ms
   ✓ CLQ full end-to-end pipeline > pnpm install and pnpm build succeed in the scaffolded project 10920ms
   ✓ CLQ full end-to-end pipeline > clq doctor exits 0 on a clean project 3257ms
   ✓ CLQ full end-to-end pipeline > clq doctor exits non-zero and the raw secret value never appears in stdout 2048ms
   ✓ CLQ full end-to-end pipeline > clq inspect: forged-Origin→403, no-token→401, valid→200, SIGINT exits cleanly 5861ms
   ✓ CLQ full end-to-end pipeline > clq dev starts watching and exits cleanly on SIGINT with no orphan processes 2973ms
 ✓ packages/cli/src/commands/inspect/server.test.ts (12 tests) 94167ms
   ✓ clq inspect backend (two-process, security) > binds to 127.0.0.1 specifically 3038ms
   ✓ clq inspect backend (two-process, security) > GET / serves the static UI with no token and no Origin 7994ms
   ✓ clq inspect backend (two-process, security) > a traversal path is not served the static file and never leaks host files 7955ms
   ✓ clq inspect backend (two-process, security) > forged Origin is rejected with 403 before any token logic 7984ms
   ✓ clq inspect backend (two-process, security) > no Origin header + valid token is accepted (browser same-origin fetch) 7990ms
   ✓ clq inspect backend (two-process, security) > no Origin header + no token is rejected with 401 8004ms
   ✓ clq inspect backend (two-process, security) > correct Origin but no token is rejected with 401 7917ms
   ✓ clq inspect backend (two-process, security) > correct Origin + token returns the tool list 7936ms
   ✓ clq inspect backend (two-process, security) > a secret-named response field is redacted, never leaked 8042ms
   ✓ clq inspect backend (two-process, security) > an unknown tool name yields a clean 404 JSON error, not a crash 7985ms
   ✓ clq inspect backend (two-process, security) > child crash before tool registration rejects within 5 s with actionable error 2251ms
   ✓ clq inspect backend (two-process, security) > a busy port causes a clean increment, not a throw 2917ms
 ✓ packages/cli/src/commands/dev.test.ts (3 tests) 13887ms
   ✓ clq dev (built binary, real tsx watch) > watches, restarts on change, and exits promptly on SIGINT 5464ms
   ✓ clq dev (built binary, real tsx watch) > outside any project: fails cleanly without watching 3054ms
   ✓ clq dev (built binary, real tsx watch) > missing entry file: fails cleanly 3060ms
 ✓ packages/core/src/server.test.ts (9 tests) 18ms
 ✓ packages/cli/src/commands/init.test.ts (9 tests) 230ms
 ✓ packages/core/src/config.test.ts (10 tests) 10ms
 ✓ packages/core/src/protocol/translate.test.ts (8 tests) 18ms
 ✓ packages/core/src/protocol/mcp-stdio-driver.test.ts (4 tests) 12449ms
   ✓ MCP stdio driver (real SDK, spawned process) > responds to initialize with a well-formed result 564ms
 ✓ packages/cli/src/commands/doctor.test.ts (3 tests) 21103ms
   ✓ clq doctor (built CLI, spawned) > a clean project exits 0 2689ms
   ✓ clq doctor (built CLI, spawned) > a missing required env var exits non-zero and names its description 2167ms
   ✓ clq doctor (built CLI, spawned) > an injected secret exits non-zero and the raw value never appears in stdout 2216ms
 ✓ packages/core/src/tool.test.ts (6 tests) 16ms
 ✓ packages/cli/src/commands/add.test.ts (4 tests) 118ms
 ✓ packages/core/src/errors.test.ts (35 tests) 21ms
 ✓ packages/cli/src/build-templates.test.ts (4 tests) 2260ms
 ✓ packages/cli/src/utils/secret-scan.test.ts (5 tests) 49ms
 ✓ packages/core/src/types.test.ts (4 tests) 4ms
 ✓ packages/cli/src/index.test.ts (3 tests) 3896ms
   ✓ clq CLI (built binary) > --version prints the package version 561ms
   ✓ clq CLI (built binary) > --help exits 0 567ms
   ✓ clq CLI (built binary) > an unknown command exits non-zero and leaks no stack trace 536ms
 ✓ packages/cli/src/utils/exec-safe.test.ts (2 tests) 187ms

 Test Files  17 passed (17)
       Tests  128 passed (128)
    Start at  00:22:09
    Duration  203.14s (transform 1.07s, setup 0ms, collect 3.10s, tests 191.43s, environment 6ms, prepare 3.83s)
```

**Result: PASS — 128/128 tests, 17/17 test files, zero failures.**

---

## 3. Manual CLI Walkthrough

All commands run against a fresh scaffolded project at `/tmp/qa-test-proj` (outside the repo). Build first: `pnpm --filter @clq-sh/core build && pnpm --filter @clq-sh/cli build`.

### `clq init`

```
node dist/index.js init qa-test-proj
# Output:
Created qa-test-proj.

  cd qa-test-proj
  pnpm install
  pnpm build

Test your tools:
  clq inspect          # browser UI — run tools interactively
  clq dev              # hot-reload dev server

Connect to Claude Desktop — add to claude_desktop_config.json:
  "qa-test-proj": { "command": "node", "args": ["<absolute-path>/qa-test-proj/dist/index.js"] }
```

**PASS.** Creates the expected tree: `package.json`, `clq.config.ts`, `tsconfig.json`, `tsup.config.ts`, `.gitignore`, `.env.example`, `src/index.ts`. All `{{projectName}}` placeholders are replaced.

**Issue (UX):** Running `clq init` with no project name argument and no TTY fails with:
```
Error: SystemError [ERR_TTY_INIT_FAILED]: TTY initialization failed: uv_tty_init returned EBADF (bad file descriptor)
```
This is not a security issue, but it means the interactive prompt mode (`@clack/prompts`) crashes in non-TTY contexts (pipes, CI, scripts). The error is not user-friendly — exit code is 1 but no error message from `clq` itself.

**Issue (packaging):** The template `package.json` hardcodes `"@clq-sh/core": "0.1.4"`. This version string is not updated automatically when the CLI version bumps; it requires a manual edit to `src/templates/default/package.json`. When a new version ships, users running `clq init` will scaffold projects referencing a stale core version. The build-templates test (which passes) verifies that `dist/templates` matches `src/templates` after build, but does NOT verify that the pinned version is current.

### `clq add`

```
# Inside qa-test-proj:
node dist/index.js add ping-tool   # PASS: creates src/tools/ping-tool.ts
node dist/index.js add my-tool     # PASS: creates src/tools/my-tool.ts
node dist/index.js add ../../escape  # PASS: rejected with "Name must contain only letters, numbers, and hyphens."
node dist/index.js add my-tool     # PASS: rejected as duplicate (use --force to overwrite)
node dist/index.js add my-tool --force  # PASS: overwrites

# Outside any project:
node dist/index.js add my-tool   # PASS: fails with "No CLQ project found."
```

**Issue (minor):** `validateSlug` uses the `/i` flag, allowing uppercase in tool names (`MyTool`, `ALLCAPS`, `CamelCase` all pass). The regex is `^[a-z0-9][a-z0-9-]*$/i`. Also, leading digits are allowed (`1tool` passes validation and produces `src/tools/1tool.ts`). This is not a security issue but could produce unconventional file names and is inconsistent with the CLI docs that show lowercase kebab-case names.

### `clq dev`

```
# Inside a project with built artifacts:
node dist/index.js dev
# Output:
Watching src/index.ts (Ctrl+C to stop)
  Test interactively:  clq inspect  (run in another terminal)
  This is a stdio MCP server — connect via an MCP client to use it.

^C  (SIGINT exits cleanly, no orphan processes observed)
```

**PASS.** Starts tsx watch, banner appears, SIGINT terminates both the CLI process and the tsx child. The E2E test suite verifies the full process tree is gone after SIGINT.

**Note (Windows):** The E2E test acknowledges a known Windows-specific behavior: SIGINT terminates the process without running signal handlers, so the tsx child may survive momentarily. The test force-kills the full tree as a fallback. This is a known platform limitation, not a bug, and the cleanup logic handles it.

### `clq inspect`

```
# Inside a project:
node dist/index.js inspect
# Output:
Inspector running at http://127.0.0.1:7317/?token=<64-char-hex>
This token will not be printed again. Keep this URL private.
```

**PASS.** Server binds exclusively to `127.0.0.1`. Token is 64 hex characters (256-bit entropy). Static UI is served at `/`. Security gate at all `/api/*` routes: forged Origin → 403, missing/wrong token → 401, valid → 200.

SIGINT shuts down gracefully. Token is scrubbed from the URL bar by the UI after the page loads. The static `index.html` never embeds the token.

### `clq doctor`

```
# Clean project:
node dist/index.js doctor
# Output:
Checking project configuration...
  ✓ Config valid, all required env vars present
Checking dependencies...
  ✓ Dependencies installed
Scanning for hardcoded secrets...
  ✓ No hardcoded secrets detected
# Exit: 0 — PASS

# Project with missing dependencies (not installed):
  ✓ Config valid, all required env vars present
  ✗ Run pnpm install
# Exit: 1 — PASS

# Project with hardcoded GitHub-shaped token:
  ✗ GitHub token found in src/tools/ping-tool.ts:1 → ghp***r8
# Exit: 1 — PASS (raw token is masked)
```

**PASS** for standard cases. One confirmed security regression (see Finding 1 below).

---

## 4. Security Findings

### Finding 1 — MEDIUM: Secret value exposed in `clq doctor` stdout on type mismatch

**Severity:** Medium  
**Affected file:** `packages/core/src/config.ts`, lines 43–49

**Reproduction:**

1. Create a `clq.config.ts` with a `type: "number"` env var:
   ```ts
   export default defineConfig({
     name: "my-server",
     version: "0.1.0",
     env: {
       SERVICE_PORT: { type: "number", description: "The port number for the service." }
     }
   })
   ```
2. Set the env var to a non-numeric value (e.g., a misrouted API key):
   ```
   SERVICE_PORT=sk-REAL-SECRET-12345678 clq doctor
   ```
3. Observe stdout:
   ```
   Checking project configuration...
     ✗ Config check failed: Required environment variable 'SERVICE_PORT' is not set. - The port number for the service. (expected a number, got "sk-REAL-SECRET-12345678")
       Fix: Set SERVICE_PORT in your .env file or environment before starting the server.
   ```

**Root cause:** In `loadConfig()`:
```ts
if (Number.isNaN(n)) {
  throw errors.missingEnvVar(
    key,
    `${decl.description} (expected a number, got "${raw}")`,  // raw = process.env[key]
  )
}
```
The raw env var value is embedded in the error description. This description becomes the `cause` field of the error, and `clq doctor` prints `message + " - " + cause` to stdout.

**Impact:** If a CI/CD system logs `clq doctor` output (common: used as a health check before deployment), or if a user shares terminal output while debugging, the literal secret value appears in cleartext. The `secret?: boolean` field on `EnvVarDeclaration` does not change this behavior — there is no code that reads it.

**Scope of real-world risk:** High if teams run `clq doctor` in CI with secrets in the environment. Low if they only run it locally in isolation.

---

### Finding 2 — LOW: `redactSecrets()` does not cover common secret-naming conventions

**Severity:** Low  
**Affected file:** `packages/cli/src/utils/redact.ts`, line 1

**Pattern in use:**
```ts
const SECRET_KEY_PATTERN = /secret|token|password|api[-_]?key/i
```

**Keys that pass through unredacted (confirmed with code execution):**

| Key name | Typical content | Redacted? |
|---|---|---|
| `authorization` | `Bearer sk-...` | ✗ NO |
| `Authorization` | `Bearer sk-...` | ✗ NO |
| `credential` | secret value | ✗ NO |
| `credentials` | secret value | ✗ NO |
| `private_key` | PEM key | ✗ NO |
| `privateKey` | PEM key | ✗ NO |
| `access_key` | AWS/etc key | ✗ NO |
| `accessKey` | AWS/etc key | ✗ NO |
| `signing_key` | HMAC key | ✗ NO |
| `bearer` | Bearer token value | ✗ NO |
| `jwt` | JWT string | ✗ NO |
| `passphrase` | passphrase | ✗ NO |
| `apiKey` | API key | ✓ YES |
| `TOKEN` | token value | ✓ YES |
| `secret` | secret value | ✓ YES |

**Reproduction:** A tool that returns data with `authorization` or `access_key` fields:
```ts
handler: async () => ({
  authorization: "Bearer REAL_AUTH_VALUE",
  credential: "REAL_CRED_VALUE",
  access_key: "REAL_ACCESS_KEY",
})
```
The inspector's `/api/call` response and `/api/logs` response would contain the literal values for `authorization`, `credential`, and `access_key`.

**Impact:** Defense-in-depth does not cover common patterns. A tool handler that proxies an HTTP response (e.g., from an OAuth endpoint that returns `{ access_key, authorization }`) or that returns structured auth objects would leak credentials through the inspector. The impact is constrained to the loopback-only inspector with its 401/403 gate, but anyone with the token can extract them.

**Note:** The existing test in `server.test.ts` tests redaction of an `apiKey` field — which DOES match the pattern. It does not test `authorization` or `credential`.

---

### Finding 3 — INFO: `secret: boolean` in `EnvVarDeclaration` is declared but never read

**Severity:** Informational  
**Affected file:** `packages/core/src/config.ts`, lines 3–8

The type definition includes:
```ts
type EnvVarDeclaration = {
  type: "string" | "number" | "boolean"
  description: string
  secret?: boolean     // ← declared
  default?: string | number | boolean
}
```

`loadConfig()` never reads `decl.secret`. A user who writes:
```ts
env: {
  API_KEY: { type: "string", description: "Secret key.", secret: true }
}
```
gets no extra protection from the `secret: true` flag. The type-mismatch leak (Finding 1) would still occur. No documentation warns that this flag is unused; the field's presence implies it does something.

**Impact:** Low — misplaced trust. Users who explicitly mark vars as secret may assume extra protection they do not have.

---

### Finding 4 — INFO: Path traversal via URL cannot reach host files (confirmed safe)

**Severity:** Informational (confirmed not vulnerable)

The inspector serves the static page only when `req.method === "GET" && url.pathname === "/"`. Any other URL path (including traversal attempts like `/../../../etc/passwd`) falls through to the Origin/token gate and returns 401 or 403, never reaching any filesystem operation. The `indexHtml` content is loaded once at module init from a fixed path — it is not a dynamic file lookup per request. Confirmed by the existing test:
```
a traversal path is not served the static file and never leaks host files  7955ms  PASS
```

---

### Finding 5 — INFO: `/api/logs` auth gate confirmed correct; body cap confirmed

**Severity:** Informational (confirmed safe)

Manual verification:
- `GET /api/logs` with no token → **401** ✓
- `GET /api/logs` with wrong Origin + valid token → **403** ✓  
- `GET /api/logs` with valid token (no Origin) → **200** ✓

`POST /api/call` body cap (1MB) is enforced by `req.destroy()` at `raw.length > 1_000_000`. A 1.1MB payload causes the server to destroy the connection; the client receives `"fetch failed"`. The server remains healthy after the oversized request.

---

### Finding 6 — INFO: Prototype pollution via JSON.parse is not exploitable

**Severity:** Informational (confirmed safe)

Sending `{"name":"getAuth","args":{"__proto__":{"polluted":true}}}` to `/api/call` does not set `Object.prototype.polluted`. Confirmed:
```
[5] Prototype pollution payload: 404
[5] polluted on Object.prototype: undefined (clean)
```

The 404 is expected (registeredTools was empty in the test fixture) but the pollution check is the relevant result. `JSON.parse` in modern V8 does not propagate prototype poisoning.

---

## 5. Dependency Audit Results

```
pnpm audit
```

**Result: 6 vulnerabilities (1 critical, 1 high, 3 moderate, 1 low)**

All are in **development dependencies only**. None are in packages included in `@clq-sh/core` or `@clq-sh/cli` published artifacts.

| Severity | Package | Version | Advisory | Paths |
|---|---|---|---|---|
| **CRITICAL** | vitest | 2.1.9 | [GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp): Arbitrary file read/execute via UI server | dev only |
| **HIGH** | vite | 5.4.21 | [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff): `server.fs.deny` bypass on Windows alternate paths | dev only |
| **MODERATE** | vite | 5.4.21 | [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9): Path traversal in optimized deps `.map` handling | dev only |
| **MODERATE** | vite | 5.4.21 | [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3): NTLMv2 hash disclosure via UNC paths on Windows | dev only |
| **MODERATE** | esbuild | 0.21.5 | [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99): CSRF via dev server cross-origin requests | dev only |
| **LOW** | esbuild | 0.27.7 | [GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr): Arbitrary file read on Windows when dev server is running | dev only (tsup) |

**Risk assessment:** The critical vitest vulnerability requires the Vitest UI server to be actively running (it is not enabled by default and not used in this project). All other vulnerabilities apply to development server scenarios, not CI test runs or production usage. None of these vulnerabilities affect published packages.

**Recommendation:** Update vitest and vite before running the test suite on multi-user development machines where the Vitest UI might be opened. These updates are straightforward and non-breaking.

---

## 6. Coverage Gaps — Things Not Tested That Should Be Before Public Release

The following scenarios are not covered by any existing test and represent either security risks or correctness concerns that should be verified:

### Security / data-handling gaps

1. **`loadConfig()` type-mismatch secret leak is not tested.** The doctor test suite verifies that a *missing* required var exits non-zero and names its description, but does not test the case where a var is *present* but the wrong type. Adding a test with `SERVICE_PORT=not-a-number clq doctor` and asserting that `"not-a-number"` does not appear in stdout would catch the confirmed leak in Finding 1.

2. **`redactSecrets()` is not tested for the field names that are NOT redacted.** The existing test (`a secret-named response field is redacted, never leaked`) uses an `apiKey` output field, which matches the pattern. There is no test verifying that `authorization`, `credential`, or `access_key` are handled (or explicitly documenting that they are by design not redacted).

3. **`secret: boolean` being silently ignored is not tested or documented.** No test verifies that `secret: true` in the config declaration has or does not have any effect. The current behavior (no effect) is a silent contract violation. Either the field should be removed from the type, or it should be documented and ideally enforce something.

4. **The inspector `/api/logs` endpoint's token auth is not tested explicitly in the security tests.** There is no test for `GET /api/logs` with no token, wrong token, or wrong origin. The existing security tests only cover `/api/tools` and `/api/call`.

### Correctness / UX gaps

5. **`clq init` with no arguments outside a TTY crashes with an opaque Node.js error.** No test covers this path. The `@clack/prompts` interactive mode is never exercised in the test suite; all tests pass the project name as a CLI argument.

6. **`clq add` with an uppercase or leading-digit tool name is not tested.** `validateSlug` accepts `MyTool` (case-insensitive flag), `CamelCase`, and `1tool` (leading digit). The tests only cover lowercase kebab-case and explicitly invalid inputs. Whether uppercase names cause downstream issues (e.g., TypeScript module resolution, case-insensitive filesystem conflicts on macOS) is untested.

7. **`clq inspect` with a non-numeric `CLQ_INSPECT_PORT` env var is untested.** `Number(process.env.CLQ_INSPECT_PORT)` is called in `inspect.ts`; if the env var is not a valid number, this produces `NaN`, which gets passed to `startInspectServer`. The behavior of `http.createServer(...).listen({ port: NaN })` is platform-dependent and unspecified.

8. **The 200-entry log cap in the inspector is not tested.** `logs.shift()` is called when `logs.length > 200`, but no test verifies that the cap is enforced and that older entries are dropped (not accumulated, causing memory growth).

9. **Oversized body handling in `/api/call` is not tested.** The `req.destroy()` call at `raw.length > 1_000_000` is untested. Manually verified to work (server closes connection, client gets `fetch failed`), but there is no automated regression.

10. **Middleware registered with `.use()` is not executed.** `packages/core/src/server.ts` line 19 stores middleware in an array but the `start()` method never applies it around tool calls. The comment says "reserved for a future release." The middleware interface is public API that users might implement — there is no test that asserts middleware callbacks are NOT called (documenting the gap), and no documentation warning users that `.use()` is a no-op.

11. **The template package.json version pin is not validated against the current CLI version.** The build-templates test confirms `src/templates/default/package.json` is copied to `dist/templates` correctly, but does not assert that `"@clq-sh/core": "0.1.4"` matches the actual `@clq-sh/core` package version. These will drift when versions bump.

12. **MCP stdio driver input sanitization is not tested for very large tool payloads or deeply nested objects.** The MCP SDK handles framing, but the interaction between the SDK's internal limits and CLQ's Zod validation for large inputs is untested.

---

*Report generated by manual QA and security audit on 2026-07-02. Source files read but not modified. All tests run in-place against the current working tree.*
