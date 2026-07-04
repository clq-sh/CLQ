# qa-report — Audit Trail Index

This folder is the complete, timestamped record of CLQ's pre-v0.2.0 security and quality audit. Files are listed in the order they were produced. Do not edit any existing file; they are a historical record.

---

| File | Date | What it covers |
|------|------|----------------|
| [REPORT.md](REPORT.md) | 2026-07-02 | Initial audit of `@clq-sh/core@0.1.4` and `@clq-sh/cli@0.1.4`. Confirmed two security findings: Finding 1 (credential leak in `clq doctor` on type mismatch) and Finding 2 (redaction bypass in `clq inspect` — missing common secret-field naming patterns). 128 tests passing at time of audit. |
| [FIXES.md](FIXES.md) | 2026-07-02 | Implementation report for all fixes from REPORT.md. Fix 1: stop leaking raw env-var value in `clq doctor` error messages. Fix 2: expand `SECRET_TERMS` to 16 patterns covering the most common real-world naming conventions. Fix 3–5: additional hardening (secret length not leaked, config-isolation in doctor's tsx child, version-drift build guard). Test count grew from 128 → 175. |
| [MIDDLEWARE.md](MIDDLEWARE.md) | 2026-07-02 | Dedicated review of `applyMiddleware()` in `server.ts`. Confirms correct before/after hook ordering, identifies Q4 bug: an `after`-hook error discards the already-successful tool result (the MCP client sees a failure even though the tool succeeded). Test count: 175 at review time. |
| [FIX2.md](FIX2.md) | 2026-07-02 | Fix for the Q4 after-hook bug from MIDDLEWARE.md. `after`-hook errors are now caught, logged via `console.error`, remaining hooks still run, and the tool's successful result is always returned. |
| [FIXD.md](FIXD.md) | 2026-07-03 | Word-boundary anchoring pass on `SECRET_KEY_PATTERN`. Added `\b` anchors to prevent false-positive redaction of innocent keys like `primaryKey` and `foreignKey`. Includes 37 new unit tests. Note: this fix introduced a camelCase regression — see FIXD2. |
| [FIXD2.md](FIXD2.md) | 2026-07-04 | Camelcase regression fix. `\b` anchors from FIXD do not fire at camelCase transitions in JavaScript regex (`userApiKey` has no word boundary between `r` and `A`), so real secret keys like `apiKey` and `privateKey` were passing through unredacted. Replaced the single-regex approach with a key-splitting + two-tier lookup strategy. 28 additional unit tests added (65 total for redact). |
| [FIXD3.md](FIXD3.md) | 2026-07-04 | Verification pass confirming FIXD2's `isSecretKey()` implementation is correct against all 27 live checks (must-redact and must-not-redact). No code change required. |
| [FINAL.md](FINAL.md) | 2026-07-02 | Final QA pass. Confirms all three security findings (Finding 1, Finding 2, FIX2) are fixed and verified live. 183 tests passing. Documents four open non-security issues: inspector page-reload UX cliff (Finding A), tool-list staleness with no restart prompt (Finding B), cosmetic stderr noise from Q4 tests (Finding C), and confirmed false-positive redaction on `cookie`/`token` substrings (Finding D — a documented design trade-off, not a bug). |

---

The two most serious findings and their fixes are summarized in the [README Security & Quality section](../README.md#security--quality).
