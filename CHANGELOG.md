## [0.2.0] — 2026-07-04

### Security fixes

- **Finding 1 — credential leak in `clq doctor`:** when an env var was declared `type: "number"` but received a non-numeric runtime value, `loadConfig()` interpolated the raw value directly into the error message. `clq doctor` would print the full literal secret to stdout. Fixed by replacing the interpolation with a structural description (`"a non-numeric string of length N"` for non-secret vars; `"a non-numeric value"` for secret vars — no content, no length).

- **Finding 2 — redaction bypass in `clq inspect`:** `redactSecrets()` only matched a narrow initial list of key-name patterns, missing `authorization`, `credential(s)`, `access_key`, `private_key`, `bearer`, `jwt`, `passphrase`, `signing_key`, `session_id`, `cookie`, and more. A tool returning data under any of these names would leak the value through `/api/call` and `/api/logs`. Fixed by expanding `SECRET_TERMS` to 16 patterns covering the most common real-world naming conventions.

- **Redaction word-boundary regression + fix:** the initial word-boundary fix (FIXD) introduced `\b` anchors to prevent false positives, but `\b` does not fire at camelCase transitions in JavaScript (`userApiKey` → no boundary between `r` and `A`). This caused real secret keys like `apiKey`, `apiSecret`, and `privateKey` to pass through unredacted. Fixed (FIXD2) by splitting keys on `_`, `-`, and camelCase boundaries before matching against a two-tier lookup: a set of single-word terms and a set of compound terms requiring both parts to be present. 65 unit tests cover the full matrix.

### Correctness fix

- **Middleware `after`-hook error handling:** if an `after` hook threw, the rejection propagated out of the wrapped handler and the MCP client received a failure even though the tool had already succeeded. Fixed so `after`-hook errors are caught, logged via `console.error`, and the remaining `after` hooks still run — a broken after-hook can never make a succeeded tool appear to have failed.

### Build integrity

- **Version-drift guard in `copy-assets.mjs`:** the template scaffold's pinned `@clq-sh/core` version is now checked against the monorepo's actual core version at build time. A mismatch fails the build immediately rather than silently shipping a template that installs a different core version than the one it was tested against.

### Documentation

- README restructured for a first-time visitor: marketing comparison table removed, Zod output schema note relocated into context, Security & Quality section added.
- `qa-report/README.md` added: index of all audit reports in chronological order with one-line descriptions.
- `BETA-READY.md` removed: content was redundant with the README install section; removal noted in the README.

---

## [0.1.0] — initial alpha release

CLQ ships a complete TypeScript framework for building MCP servers: `defineTool`, `createServer`, Zod input/output validation, and a five-command CLI (`init`, `add`, `dev`, `inspect`, `doctor`). The inspector browser UI, hot-reload dev server, and secret scanner are included and tested across 132 automated tests.
