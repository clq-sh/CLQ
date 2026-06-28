# CLQ Phase Audit Report

**Date:** 2026-06-28  
**Auditor:** Claude Code (claude-sonnet-4-6[1m])  
**Scope:** Phase 1 + Phase 2 verification pass — no new features built

---

## 1. Summary

| Metric | Value |
|---|---|
| Total test files | 17 |
| Total tests | 119 |
| Passing | 119 |
| Failing | 0 |
| Toolchain errors (lint / typecheck / build) | 0 |
| Small fixes applied this session | 1 |
| Items needing manual verification | 2 |

**One-line verdict:** All 119 automated tests pass, the full toolchain is clean, every Phase 1 and Phase 2 checklist item is confirmed with direct evidence, and one pre-existing silent failure (weather-server test no-op) was fixed.

---

## 2. Phase 1 Checklist — Results

| Item | Status | Evidence |
|---|---|---|
| ARCHITECTURE.md Stage 1 section exists | PASS | Lines 3–12: "Stage 1 — Core Contracts" with all 7 types documented |
| ARCHITECTURE.md Stage 2 section exists | PASS | Lines 14–22: "Stage 2 — Error System" |
| ARCHITECTURE.md Stage 3 section exists | PASS | Lines 24–32: "Stage 3 — defineTool()" |
| ARCHITECTURE.md Stage 4 section exists | PASS | Lines 34–41: "Stage 4 — Protocol Translation" |
| ARCHITECTURE.md Stage 5 section exists | PASS | Lines 43–54: "Stage 5 — MCP Stdio Driver" |
| ARCHITECTURE.md Stage 6 section exists | PASS | Lines 56–65: "Stage 6 — createServer()" |
| ARCHITECTURE.md Stage 7 section exists | PASS | Lines 67–73: "Stage 7 — Config System" |
| ARCHITECTURE.md "Phase 1 Complete" section exists | PASS | Lines 75–88: "Phase 1 — Complete" with public API surface enumerated |
| DECISIONS.md exists with continuous log | PASS | File read; 38 lines covering all major decisions from core types through Phase 2 CLI with no gaps |
| Public API "." exports: only approved symbols | PASS | `grep -n "export" packages/core/src/index.ts` shows exactly 4 lines: `export * from "./types.js"`, `export { defineTool }`, `export { createServer }`, `export { defineConfig }`. types.ts re-checked: exports only the 7 approved interfaces |
| "./inspect" subpath export exists in core/package.json | PASS | Lines 19–28 of core/package.json: full import+require+types entries for "./inspect" |
| "./config" subpath export exists in core/package.json | PASS | Lines 29–38 of core/package.json: full import+require+types entries for "./config" |
| weather-server integration test is green | PASS (after fix) | Was silently skipping; fixed by adding vitest.config.ts (see Section 6). After fix: 6/6 tests pass |
| pnpm install | PASS | "Already up to date. Done in 2s" — lockfile current |
| pnpm lint | PASS | "Checked 65 files in 72ms. No fixes applied." |
| pnpm typecheck | PASS | No output = zero errors |
| pnpm build | PASS | All 4 packages built: core, cli, testing, weather-server |

---

## 3. Phase 2 Checklist — Results

| Item | Status | Evidence |
|---|---|---|
| ARCHITECTURE.md Phase 2 Stage 0 (CLI Bootstrap) | PASS | Lines 90–97: "Phase 2, Stage 0 — CLI Bootstrap" |
| ARCHITECTURE.md Phase 2 Stage 1 (clq init) | PASS | Lines 99–109: "Phase 2, Stage 1 — clq init" |
| ARCHITECTURE.md Phase 2 Stage 2 (clq add) | PASS | Lines 111–121: "Phase 2, Stage 2 — clq add" |
| ARCHITECTURE.md Phase 2 Stage 3 (clq dev) | PASS | Lines 123–129: "Phase 2, Stage 3 — clq dev" |
| ARCHITECTURE.md Phase 2 Stage 4 (clq inspect backend) | PASS | Lines 131–139: "Phase 2, Stage 4 — clq inspect Backend" |
| ARCHITECTURE.md Phase 2 Stage 5 (clq inspect frontend) | PASS | Lines 141–149: "Phase 2, Stage 5 — clq inspect Frontend" |
| ARCHITECTURE.md Phase 2 Stage 6 (clq doctor) | PASS | Lines 151–157: "Phase 2, Stage 6 — clq doctor" |
| ARCHITECTURE.md Phase 2 Complete section | PASS | Lines 159–179: "Phase 2 — Complete" with full 8-step e2e test enumeration |
| inspect server binds to 127.0.0.1 | PASS | server.ts line 78: `server.listen({ port, host: "127.0.0.1", exclusive: true }, ...)` — explicit loopback, never undefined or 0.0.0.0 |
| Origin check before token check | PASS | server.ts lines 229–238: Origin check (`if (req.headers.origin !== expectedOrigin)`) → 403; token check (`if (req.headers["x-clq-token"] !== token)`) → 401. Origin is unconditionally first for all /api/* routes |
| Wrong Origin → 403 | PASS | server.ts line 230: `sendJson(res, 403, { error: "Forbidden: invalid origin." })` |
| Wrong token → 401 | PASS | server.ts line 236: `sendJson(res, 401, { error: "Unauthorized." })` |
| redact.ts redacts secret-named fields | PASS | redact.ts lines 1–19: `SECRET_KEY_PATTERN = /secret|token|password|api[-_]?key/i` replaces matching key values with "[REDACTED]" recursively |
| server.test.ts has all security test cases | PASS | Read file — 9 tests including: "binds to 127.0.0.1 specifically", "forged Origin is rejected with 403 before any token logic", "correct Origin but no token is rejected with 401", "correct Origin + token returns the tool list", "a secret-named response field is redacted, never leaked" |
| secret-scan.ts: real match value never placed on Finding | PASS | secret-scan.ts lines 44–54: `for (const m of matches)` — `m` used only for `maskValue(m)`, result assigned to `masked`. `m` is never assigned elsewhere, never returned, never logged, never placed on the Finding |
| dev.ts SIGINT handler awaits child before exit | PASS | dev.ts lines 43–55: `child.kill(signal)` then `await child` inside try/catch, then `process.exit(0)` — explicit await before exit |
| MANUAL-BETA-CHECKLIST.md exists at repo root with 5 items | PASS | File read; 5-item checklist at repo root covering: install+help, init, add, dev, inspect |

---

## 4. Stage 7 Deep-Dive

### 4a. full-flow.test.ts isolated run

Run command: `node_modules/.bin/vitest run packages/cli/src/__e2e__/full-flow.test.ts`

```
Test Files  1 passed (1)
      Tests  7 passed (7)
   Duration  38.95s
```

Individual test pass/fail lines:
```
✓ CLQ full end-to-end pipeline > clq init e2e-test scaffolds the expected file tree 488ms
✓ CLQ full end-to-end pipeline > clq add ping-tool creates a valid, non-empty tool file 449ms
✓ CLQ full end-to-end pipeline > pnpm install and pnpm build succeed in the scaffolded project 9684ms
✓ CLQ full end-to-end pipeline > clq doctor exits 0 on a clean project 2027ms
✓ CLQ full end-to-end pipeline > clq doctor exits non-zero and the raw secret value never appears in stdout 1995ms
✓ CLQ full end-to-end pipeline > clq inspect: forged-Origin→403, no-token→401, valid→200, SIGINT exits cleanly 4481ms
✓ CLQ full end-to-end pipeline > clq dev starts watching and exits cleanly on SIGINT with no orphan processes 2899ms
```

All 7 steps pass.

### 4b. CLQ_INSPECT_PORT handling

File: `packages/cli/src/commands/inspect.ts`, lines 18–21:

```typescript
const portOverride = process.env.CLQ_INSPECT_PORT
  ? Number(process.env.CLQ_INSPECT_PORT)
  : undefined
const inspector = await startInspectServer({ root, port: portOverride })
```

`CLQ_INSPECT_PORT` is read from `process.env`, coerced to `Number`, and passed as the optional `port` to `startInspectServer`. If absent or empty string (falsy), `undefined` is passed and the server defaults to port 7317 with retry.

### 4c. afterAll PID sweep assertion

File: `packages/cli/src/__e2e__/full-flow.test.ts`, lines 183–208 (afterAll block):

```typescript
afterAll(async () => {
  killByCommandLine(path.basename(workDir))
  await sleep(500)
  killByCommandLine(path.basename(workDir))

  // Final assertion: every PID this test file ever captured must be gone.
  for (const pid of allCapturedPids) {
    expect(
      isPidRunning(pid),
      `PID ${pid} should be gone after test cleanup but is still running`,
    ).toBe(false)
  }
  // ... cleanup ...
})
```

The `isPidRunning` function (lines 31–38):

```typescript
function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0) // signal 0 = existence check; throws ESRCH if gone
    return true
  } catch {
    return false
  }
}
```

Confirmed: the assertion is `expect(isPidRunning(pid)).toBe(false)` and `isPidRunning` calls `process.kill(pid, 0)` — signal 0 is the POSIX existence check, throws `ESRCH` if the process is gone. Both confirmed exactly as specified.

---

## 5. Known Issues Re-Check

### 5a. packages/core/package.json — ./config export

The full exports block from `packages/core/package.json`:

```json
"exports": {
  ".": {
    "import": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "require": {
      "types": "./dist/index.d.cts",
      "default": "./dist/index.cjs"
    }
  },
  "./inspect": {
    "import": {
      "types": "./dist/inspect.d.ts",
      "default": "./dist/inspect.js"
    },
    "require": {
      "types": "./dist/inspect.d.cts",
      "default": "./dist/inspect.cjs"
    }
  },
  "./config": {
    "import": {
      "types": "./dist/config.d.ts",
      "default": "./dist/config.js"
    },
    "require": {
      "types": "./dist/config.d.cts",
      "default": "./dist/config.cjs"
    }
  }
}
```

Status: **ALREADY PRESENT** — no fix needed. The `./config` entry was already in the file before this audit began, matching the `./inspect` pattern exactly.

### 5b. examples/weather-server test silently-passing issue

**Status: WAS BROKEN — FIXED THIS SESSION**

Before fix: `pnpm --filter weather-server test` printed "No test files found, exiting with code 0" — 0 tests ran, exit 0.

Root cause: the weather-server package has no local `vitest.config.ts`, so vitest walked up and picked up the root `vitest.config.ts`. The root config's `include` patterns (`packages/*/src/**/*.test.ts`, `examples/*/src/**/*.test.ts`) are relative to the monorepo root, not to the package directory. When invoked from within the package, `src/index.test.ts` (relative to the package) did not match those patterns.

Fix applied: added `examples/weather-server/vitest.config.ts` (identical to `packages/core/vitest.config.ts`):

```typescript
import { defineConfig } from "vitest/config"
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
})
```

After fix: `pnpm --filter weather-server test` runs all 6 tests and exits 0. The full workspace `pnpm test` run (which uses the root config from the root and already finds the file via `examples/*/src/**/*.test.ts`) was already including these 6 tests — so the fix only affects the isolated per-package run.

---

## 6. Items Fixed This Session

| File | Fix | Reason |
|---|---|---|
| `examples/weather-server/vitest.config.ts` (created) | Added local vitest config with `include: ["src/**/*.test.ts"]` | Without it, `pnpm --filter weather-server test` picked up the root vitest config whose include patterns don't match when run from the package directory; tests silently reported "No test files found" and exited 0 |

---

## 7. Remaining Manual-Only Items

The following cannot be verified by automated tests:

| Item | Why manual-only |
|---|---|
| Claude Desktop connection with actual MCP client | Requires a real MCP host (Claude Desktop app); cannot be driven by tests without the actual installed app |
| Browser-based `clq inspect` UI walkthrough | The UI is a static HTML page served locally; automated tests confirm the backend API endpoints work, but visual usability of the form generation, tool-calling UI, and log polling requires a human with a browser |

These are items 1 and 5 in `MANUAL-BETA-CHECKLIST.md` respectively, plus general MCP host integration.

---

## 8. Final Verdict

**Is this genuinely ready to hand to 5 beta testers? YES.**

Evidence:

1. **Full toolchain is clean.** `pnpm install`, `pnpm lint`, `pnpm typecheck`, and `pnpm build` all exit 0 with no warnings.

2. **119 tests pass, 0 fail, across 17 test files.** The suite covers unit, integration, and end-to-end layers including real process spawning, real network requests to the inspector, and real signal handling.

3. **The Stage 7 gate (full-flow.test.ts) passes all 7 steps in sequence** against a real project scaffolded outside the monorepo with real pnpm install and real pnpm build. This is the defined exit condition for Phase 2.

4. **Security properties are verified both statically (code read) and dynamically (tests green):**
   - Inspector binds 127.0.0.1 explicitly
   - Origin checked before token on every API request
   - Secret-named fields are redacted at the boundary
   - The real matched secret value never reaches a Finding object — only masked form
   - Path traversal is structurally impossible (exact-path allowlist, not filesystem lookup)

5. **No orphaned processes** — the SIGINT / PID sweep assertions in the e2e suite and dev unit tests confirm the shutdown sequence works on the target platform (Windows).

6. **The one known pre-existing defect (weather-server silent no-op test)** was fixed and verified.

7. **MANUAL-BETA-CHECKLIST.md** exists, has the 5-item unaided flow, and is appropriate for the beta cohort.

The two remaining manual items (Claude Desktop MCP connection and browser-based inspector UI walkthrough) are expected manual-only work for the beta period, not blockers.
