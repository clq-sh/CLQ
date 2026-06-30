# CLQ Beta Readiness Audit — 2026-06-30

---

## 1. Executive Summary

CLQ's core technical foundation is production-quality: `defineTool` is ergonomic and correct, Zod validation at both boundaries is a genuine differentiator, `clq inspect` is the best MCP dev-tool that currently exists, and the security posture (origin-before-token, loopback-only, secret redaction, exec injection prevention) is exemplary. The framework completely fails at onboarding: the README never mentions MCP, the docs link is `https://example.com/docs`, and `clq init` leaves developers stranded after `pnpm build` with no guidance on how to test or connect their server. The generated template exposes three lines of framework-internal boilerplate (`CLQ_INSPECT_REPORT`, `CLQ_INSPECT`, and a magic `export const tools`) that a developer must understand and maintain to use `clq inspect` — a direct violation of the Level 1 "Never Read The Spec" promise. Four critical fixes (README, init next steps, protocol leak removal, missing .gitignore/.env.example) are required before any design partner can be handed this repo. All four are concentrated in two Claude Code sessions.

---

## 2. Scores

| Dimension | Score | Reason |
|---|---|---|
| Developer Experience | 5/10 | API is elegant, but generated template leaks framework internals and leaves developers without guidance post-init |
| API Design | 8/10 | defineTool / createServer / defineConfig are minimal, typed, and chainable — no unnecessary surface |
| Documentation | 1/10 | README never mentions MCP, has a placeholder docs link, no quick start, no code example |
| Error Messages | 7/10 | Four-field format (code/message/cause/fix) is excellent; loses points because `fix` is silently dropped from MCP wire responses |
| CLI | 6/10 | Commands are well-designed; `clq init` stops at `pnpm build` with no testing or connection guidance |
| Debugging | 7/10 | `clq inspect` is genuinely impressive; `clq dev` output is minimal and gives no follow-up instruction |
| Examples | 5/10 | weather-server is a real example with integration tests, but it is not linked anywhere and the generated template uses echo/hello-world |
| Learning Curve | 4/10 | Protocol leaks in the template (env vars, magic export) mean developers must understand CLQ internals to safely modify generated code |
| Production Readiness | 5/10 | SIGTERM handled in CLI; generated project has no .gitignore, .env.example, or demonstrated env-var pattern |
| OSS Polish | 3/10 | LICENSE exists; CONTRIBUTING.md, CHANGELOG.md, GitHub Actions CI, and issue templates are all missing |

**Overall Score: 5.1 / 10**

---

## 3. Beta Readiness Verdict

**NOT READY**

The technical core is solid enough for a beta. The onboarding layer is not. Four critical blockers must be resolved before a design partner is handed the repo — all of them are in documentation, the generated template, and the init command output, not in the framework code itself.

---

## 4. Ship Blockers (Critical Findings)

1. **README is non-functional.** Never mentions MCP. First paragraph says "Colloquial is a TypeScript monorepo for building conversational interfaces." Docs link is `https://example.com/docs`. No quick start, no code example, no install instructions for the CLI. A developer landing on this repo cannot determine what it does or how to start.

2. **`clq init` leaves developers stranded.** Next steps stop at `pnpm build`. Nothing about `clq dev`, `clq inspect`, or how to connect to Claude Desktop. The developer has a compiled binary and zero guidance on what to do with it.

3. **Protocol leaks in the generated template.** The generated `src/index.ts` contains three lines of framework-internal boilerplate that developers must understand and maintain:
   - `export const tools = [echo]` — an undocumented magic export required for `clq inspect` to work
   - `if (process.env.CLQ_INSPECT_REPORT) { startInspectReporter(tools) }` — framework-internal env var, visible in user code
   - `if (!process.env.CLQ_INSPECT) { server.start(...) }` — second framework-internal env var
   
   Any developer who reorganizes their code without understanding these contracts will silently break `clq inspect`. This directly violates the Level 1 "Never Read The Spec" promise. The fix is to move this branching inside `createServer().start()`, making the template's entry point three lines.

4. **Generated template has no `.gitignore` or `.env.example`.** A developer's first `git init && git commit` would commit `dist/`, `node_modules/`, and potentially `.env`. This is a data-loss and credential-leak risk on day one.

---

## 5. Prioritized Roadmap

### Critical (must fix before any design partner contact)

| # | Finding | Impact |
|---|---|---|
| C1 | README rewrite | Blocks all discovery and onboarding |
| C2 | `clq init` next steps are incomplete | Blocks first success moment |
| C3 | Protocol leaks in generated template | Violates Level 1 promise; developers must learn MCP internals |
| C4 | No `.gitignore` or `.env.example` in template | Risk of committing secrets and build artifacts |

### High (fix before sharing with beta users)

| # | Finding | Impact |
|---|---|---|
| H1 | Echo tool in template is a hello-world toy | Kills the "dramatically easier" value prop; doesn't demonstrate env vars, API calls, or error handling |
| H2 | `loadConfig` / env-var pattern not shown in template | Key differentiator is invisible; developers won't find it |
| H3 | `fix` field silently dropped from MCP wire responses | Actionable error guidance is lost exactly when developers most need it |
| H4 | `clq dev` output provides no follow-up guidance | Developers don't know to use `clq inspect` or how to connect an MCP client |
| H5 | `clq inspect` silent 20-second timeout on startup failure | When entry file has a syntax error or missing dep, inspect waits 20s then shows "no tools" with no error; should surface stderr immediately |

### Medium (important but not beta blockers)

| # | Finding | Impact |
|---|---|---|
| M1 | No `.env` auto-loading in `clq dev` | Error messages tell developers to set vars in `.env`, but the server doesn't read `.env`; fix message is misleading |
| M2 | `clq doctor` doesn't check for `dist/index.js` | Developer who forgot to build gets no warning |
| M3 | weather-server example not linked from README | The best example exists but cannot be found |
| M4 | No SIGTERM handler in generated template's entry point | The server process itself doesn't handle graceful shutdown — only the CLI wrappers do |
| M5 | `clq inspect` stderr from child is silently discarded | Even outside the timeout case, errors from the project process are invisible |

### Nice-to-Have (post-beta)

| # | Finding |
|---|---|
| N1 | No CONTRIBUTING.md |
| N2 | No CHANGELOG.md |
| N3 | No GitHub Actions CI workflow |
| N4 | No `.github/ISSUE_TEMPLATE/` |
| N5 | `clq doctor` could run TypeScript type-check |
| N6 | `clq add` could prompt for a description interactively |
| N7 | Inspector poll interval (2s) is hardcoded; should be a config option |

---

## 6. Implementation Prompts

---

### PROMPT 1 — Critical: Rewrite README.md

**Target subsystem:** `README.md` at repo root

**Context:** The current README says "Colloquial is a TypeScript monorepo for building conversational interfaces." — it never mentions MCP, has no working install instructions for the CLI, no code example, and links to `https://example.com/docs`. Any developer who finds the repo leaves immediately.

**What to build:** Rewrite README.md from scratch. Do not leave any existing content. The new README must:

1. Open with a one-sentence concrete description: what CLQ is, what MCP is, and the value proposition.
   Example: "CLQ is a TypeScript framework for building MCP servers — the tool interface that lets Claude, Cursor, and other AI assistants call your code."

2. Show a minimal code example (3-5 lines of defineTool + createServer) BEFORE any prose explanation. Developers decide in 10 seconds; the code sample is the decision.

3. Quick start section: exactly 5 commands, annotated:
   ```sh
   npm install -g @clq-sh/cli   # install the CLQ CLI globally
   clq init my-server           # scaffold a new MCP server
   cd my-server && pnpm install
   pnpm build
   clq inspect                  # open interactive browser test UI
   ```

4. Core API section covering: `defineTool`, `createServer`, `defineConfig`. One paragraph and one code snippet each. Link to the weather-server example for a full working implementation.

5. CLI reference table: clq init / clq add / clq dev / clq inspect / clq doctor — one-line description each.

6. "Connecting to Claude Desktop" section with the exact JSON config snippet (using a relative dist path) and instructions to restart Claude Desktop.

7. "Adding tools" section showing `clq add my-tool` and what gets generated.

8. No placeholder links. If a page doesn't exist yet, omit the link entirely rather than linking to `example.com`.

**Acceptance criteria:**
- A developer who has never heard of CLQ reads the first paragraph and knows: (a) what CLQ does, (b) what an MCP server is, (c) why they should use CLQ instead of the MCP SDK directly
- The quick start is exactly 5 commands
- The README contains at least one real code example (not echo, not hello world)
- No links to `example.com` or any placeholder URL
- `clq inspect` is mentioned as the primary testing tool

**Tests to write or update:** None (markdown file). The audit criterion is human review.

**Documentation to update:** This file IS the documentation. Nothing else.

---

### PROMPT 2 — Critical: Remove protocol leaks from the generated template by encapsulating inspect branching in `createServer().start()`

**Target subsystem:**
- `packages/core/src/server.ts`
- `packages/cli/src/templates/default/src/index.ts`
- `packages/core/src/server.test.ts`

**Context:** The generated `src/index.ts` currently contains three lines of framework-internal boilerplate that users must understand and maintain:

```ts
// CURRENT — what every new developer sees
export const tools = [echo]                          // magic export for clq inspect
...
if (process.env.CLQ_INSPECT_REPORT) {               // framework internal
  import("@clq-sh/core/inspect").then(({ startInspectReporter }) => {
    startInspectReporter(tools)
  })
}
if (!process.env.CLQ_INSPECT) {                     // framework internal
  server.start({ driver: "mcp", transport: "stdio" })
}
```

If a developer refactors their server or moves tools into separate files without understanding these contracts, `clq inspect` silently stops working. The spec says "Never Read The Spec" — this directly violates it.

**What to build:**

**Step 1 — Move the inspect branching inside `createServer().start()`:**

In `packages/core/src/server.ts`, modify the `start()` method to internally handle the inspect env vars. The `tools` array is already accessible inside the closure:

```ts
async start(options: StartOptions = {}): Promise<ColloquialDriver> {
  // Inspect report mode: the parent inspector process spawned us specifically to
  // report our tools over stdio. Start the reporter and skip the MCP server.
  if (process.env.CLQ_INSPECT_REPORT) {
    const { startInspectReporter } = await import("./inspect.js")
    startInspectReporter(tools)
    // Return a no-op driver so callers can still call .stop() safely.
    return { name: "inspect", start: async () => {}, stop: async () => {} }
  }
  // Inspect mode (no report): the inspector parent spawned us but only needs to
  // ensure the child process is running. Skip the MCP server.
  if (process.env.CLQ_INSPECT) {
    return { name: "inspect-idle", start: async () => {}, stop: async () => {} }
  }
  // Normal run: start the MCP stdio server.
  const driverName = options.driver === "auto" || !options.driver ? "mcp" : options.driver
  if (driverName !== "mcp") {
    throw errors.unknownDriver(driverName)
  }
  const driver = createMCPStdioDriver({ name: config.name, version: config.version })
  await driver.start({ tools })
  return driver
}
```

**Step 2 — Simplify the generated template to 3 functional lines:**

Replace `packages/cli/src/templates/default/src/index.ts` with:

```ts
import { createServer, defineTool } from "@clq-sh/core"
import { z } from "zod"

const echo = defineTool({
  name: "echo",
  description: "Echo a message back to the caller.",
  input: z.object({ message: z.string() }),
  output: z.object({ echoed: z.string() }),
  handler: async ({ input }) => ({ echoed: input.message }),
})

const server = createServer({ name: "{{projectName}}", version: "0.1.0" })
server.tool(echo)
server.start()
```

No `export const tools`. No env var checks. No `@clq-sh/core/inspect` import.

**Backwards compatibility note:** The current inspect protocol requires the child process to call `startInspectReporter`. With this change, `createServer().start()` calls it automatically. Any existing user code that manually checks `CLQ_INSPECT_REPORT` and calls `startInspectReporter` will still work: when `CLQ_INSPECT` is set by the inspect parent, the user's `if (!process.env.CLQ_INSPECT) server.start()` pattern means `start()` is never called, so there is no double-registration. For users upgrading to the new template pattern (no env checks), the framework handles it transparently.

**Acceptance criteria:**
- Generated `src/index.ts` contains zero references to `CLQ_INSPECT_REPORT`, `CLQ_INSPECT`, or `@clq-sh/core/inspect`
- `clq inspect` end-to-end test (`packages/cli/src/__e2e__/full-flow.test.ts` step 6) passes unchanged
- The `start()` method returns a `ColloquialDriver` in all three cases (MCP, inspect-report, inspect-idle)
- `packages/core/src/server.test.ts` adds tests for:
  - `start()` with `CLQ_INSPECT_REPORT=1` calls `startInspectReporter` and returns a driver
  - `start()` with `CLQ_INSPECT=1` returns a driver without starting MCP
  - The returned no-op driver satisfies the `ColloquialDriver` interface (has `start`, `stop`, `name`)
- The e2e file tree test (`step 1`) still passes — `src/index.ts` must exist and contain `createServer`

**Documentation to update:** ARCHITECTURE.md Phase 2 section — update the description of the two-process design to note that env var branching moved into `createServer().start()`.

---

### PROMPT 3 — Critical: Complete `clq init` next steps and add `.gitignore` / `.env.example` to the generated template

**Target subsystem:**
- `packages/cli/src/commands/init.ts`
- `packages/cli/src/utils/copy-template.ts`
- `packages/cli/src/templates/default/` (add two new files)
- `packages/cli/src/commands/init.test.ts`
- `packages/cli/src/__e2e__/full-flow.test.ts`

**Context:** Two separate problems are solved together because both touch the generated template:

**Problem A:** `clq init` tells developers to `pnpm build` and stops. No mention of `clq inspect` (the interactive test UI), `clq dev` (the dev server), or how to connect to Claude Desktop. The developer is stranded.

**Problem B:** The generated template has no `.gitignore` or `.env.example`. A developer's first `git init && git add . && git commit` would commit `dist/`, `node_modules/`, and any `.env` file.

**What to build:**

**Step 1 — Update `clq init` output in `packages/cli/src/commands/init.ts`:**

Replace:
```ts
console.log(`Created ${name}. Next steps:`)
console.log(`  cd ${name}`)
console.log("  pnpm install")
console.log("  pnpm build")
```

With:
```ts
console.log(`\nCreated ${name} — your new MCP server.\n`)
console.log("Next steps:")
console.log(`  cd ${name}`)
console.log("  pnpm install")
console.log("  pnpm build")
console.log("")
console.log("Then test your tools interactively:")
console.log("  clq inspect          # open browser UI to run tools")
console.log("")
console.log("Or start a hot-reloading dev server:")
console.log("  clq dev              # watches src/ and restarts on change")
console.log("")
console.log("To connect to Claude Desktop, add this to claude_desktop_config.json:")
console.log(`  \"${name}\": { \"command\": \"node\", \"args\": [\"<absolute-path>/dist/index.js\"] }`)
```

**Step 2 — Add `gitignore` to the template directory:**

Create `packages/cli/src/templates/default/gitignore` (without the leading dot — Git in the source repo would apply a `.gitignore` to the template directory itself if it had the dot prefix):

```
node_modules/
dist/
.env
*.local
```

**Step 3 — Add `.env.example` to the template directory:**

Create `packages/cli/src/templates/default/.env.example`:

```
# Copy this file to .env and fill in your values.
# Never commit .env to version control.
#
# Example:
# MY_API_KEY=your_api_key_here
```

**Step 4 — Update `copyTemplateDir` to rename `gitignore` → `.gitignore`:**

In `packages/cli/src/utils/copy-template.ts`, add one line in the copy loop to handle the rename:

```ts
const destName = entry.name === "gitignore" ? ".gitignore" : entry.name
const destPath = path.join(dest, destName)
```

**Acceptance criteria:**
- After `clq init`, the output mentions `clq inspect`, `clq dev`, and the Claude Desktop config pattern
- Generated project contains `.gitignore` with at minimum `node_modules/`, `dist/`, and `.env` entries
- Generated project contains `.env.example` with instructions
- `packages/cli/src/commands/init.test.ts` tests are updated to assert the new output lines
- `packages/cli/src/__e2e__/full-flow.test.ts` step 1 is updated to assert `.gitignore` and `.env.example` exist after `clq init`
- `gitignore` (no dot) exists in the template source; `.gitignore` (with dot) appears in the generated project

**Tests to write:**
- `init.test.ts`: assert stdout includes "clq inspect", "clq dev", and "claude_desktop_config"
- `init.test.ts`: assert the generated project contains `.gitignore` with the expected content
- `init.test.ts`: assert the generated project contains `.env.example`
- `full-flow.test.ts` step 1: add `.gitignore` and `.env.example` to the expected file tree check

---

### PROMPT 4 — High: Replace the echo tool in the template with a real-world example

**Target subsystem:**
- `packages/cli/src/templates/default/src/index.ts` (after Prompt 2 has been applied — the template is now three lines)

**Context:** The generated template's echo tool (`handler: async ({ input }) => ({ echoed: input.message })`) is a pure hello-world. It does not demonstrate: real-world parameters, API calls, env var usage, error handling, or typed output schemas beyond trivial examples. A developer looking at it cannot infer "this is dramatically easier than writing MCP by hand." The weather-server example (in `examples/weather-server`) proves CLQ can do real things, but it's not in the template.

**What to build:**

Replace the echo tool in `packages/cli/src/templates/default/src/index.ts` with a weather-like tool that shows the realistic CLQ pattern. The handler should have a comment showing how to make a real API call:

```ts
import { createServer, defineTool } from "@clq-sh/core"
import { z } from "zod"

const getWeather = defineTool({
  name: "get_weather",
  description:
    "Get the current weather for a city. Returns temperature in Celsius and a short condition description.",
  input: z.object({
    city: z.string().describe("City name, e.g. 'London' or 'New York'"),
  }),
  output: z.object({
    temperature: z.number().describe("Temperature in Celsius"),
    condition: z.string().describe("Short weather description"),
  }),
  handler: async ({ input }) => {
    // TODO: Replace with a real API call, e.g.:
    // const res = await fetch(`https://api.weather.example.com/current?city=${encodeURIComponent(input.city)}`)
    // const data = await res.json()
    // return { temperature: data.temp_c, condition: data.description }
    return { temperature: 22, condition: "sunny" }
  },
})

const server = createServer({ name: "{{projectName}}", version: "0.1.0" })
server.tool(getWeather)
server.start()
```

**Why this specific choice:**
- Real input (`city`) that is obviously domain-relevant
- Real typed output schema (`temperature`, `condition`)
- Comment shows the actual pattern for a production fetch call
- Deterministic return value means `clq inspect` works out of the box without any external service
- Directly mirrors the weather-server example, which developers can refer to for a complete version

**Acceptance criteria:**
- No echo tool in any generated project
- The generated tool has a complete, non-TODO description
- The generated tool has both `input` and `output` schemas with field descriptions (`.describe(...)`)
- The handler comment shows how to make a real HTTP API call
- The return value is valid according to the output schema
- `clq inspect` can run the tool immediately after `pnpm build` and return a valid result
- `packages/cli/src/commands/add.test.ts` does not need changes (it generates from `tool.ts.template`, not `index.ts`)
- `packages/cli/src/__e2e__/full-flow.test.ts` step 1 must be updated if it checks for `echo` by name (check and update)

**Documentation to update:** Update the code example in README.md (being written in Prompt 1) to use `get_weather` instead of `echo`.

---

### PROMPT 5 — High: Surface `fix` and `cause` fields in MCP wire error responses

**Target subsystem:**
- `packages/core/src/protocol/translate.ts`
- `packages/core/src/protocol/translate.test.ts`

**Context:** When a tool handler throws a `ColloquialErrorImpl`, `dispatchToolCall` in `translate.ts` returns:

```ts
if (err instanceof ColloquialErrorImpl) {
  return { isError: true, content: [{ type: "text", text: err.message }] }
}
```

The `err.fix` and `err.cause` fields are silently dropped. The developer sees only the message; they never see the actionable fix. For example, `TOOL_MISSING_DESCRIPTION` has `fix: "Add a clear, one-sentence description..."` — this guidance is lost. This is the most painful omission: the four-field error design is one of CLQ's strongest features, but it evaporates at the wire boundary.

**What to build:**

In `packages/core/src/protocol/translate.ts`, update `dispatchToolCall`:

```ts
if (err instanceof ColloquialErrorImpl) {
  const parts: string[] = [err.message]
  if (err.cause) parts.push(`Cause: ${err.cause}`)
  if (err.fix) parts.push(`Fix: ${err.fix}`)
  return {
    isError: true,
    content: [{ type: "text", text: parts.join("\n") }],
  }
}
```

This preserves the existing single-line format when `cause` and `fix` are absent (most runtime errors like `TOOL_INVALID_INPUT` have both, but tool-not-found does not have `cause`).

**Acceptance criteria:**
- When a tool handler throws a `ColloquialErrorImpl` with a `cause`, the wire response text includes "Cause: <cause>"
- When a tool handler throws a `ColloquialErrorImpl` with a `fix`, the wire response text includes "Fix: <fix>"
- When `cause` or `fix` are absent, only the message appears (no "Cause: undefined" noise)
- The separator between parts is a newline (`\n`), not a semicolon
- Existing tests that assert on error response format are updated to expect the new format
- The weather-server integration test still passes (it checks `result.isError === true` and `content[0].text.includes("get_weather")` — verify these still hold)

**New tests to write in `packages/core/src/protocol/translate.test.ts`:**

```ts
test("dispatchToolCall includes cause and fix in error text when present", async () => {
  // Create a tool that throws a ColloquialErrorImpl with cause + fix
  const result = await dispatchToolCall(tools, "some-tool", badArgs, ctx)
  expect(result.content[0].text).toContain("Cause:")
  expect(result.content[0].text).toContain("Fix:")
})

test("dispatchToolCall omits Cause/Fix lines when not present on the error", async () => {
  // Throw an error with only a message (no cause/fix)
  const result = await dispatchToolCall(tools, "some-tool", badArgs, ctx)
  expect(result.content[0].text).not.toContain("Cause:")
  expect(result.content[0].text).not.toContain("Fix:")
})
```

**Documentation to update:** ARCHITECTURE.md Stage 4 section — note that `dispatchToolCall` now includes `cause` and `fix` in the wire text when present.

---

### PROMPT 6 — High: Improve `clq dev` startup output and add post-start guidance

**Target subsystem:**
- `packages/cli/src/commands/dev.ts`
- `packages/cli/src/commands/dev.test.ts`

**Context:** After `clq dev` starts, it prints "Watching for changes..." and nothing else. Developers don't know:
- Which file is being watched
- That they can use `clq inspect` in another terminal to test interactively  
- That the server is a STDIO MCP server (not HTTP) and cannot be opened in a browser
- How to connect to Claude Desktop for real-AI testing

**What to build:**

In `packages/cli/src/commands/dev.ts`, replace:
```ts
console.log("Watching for changes...")
```

With a multi-line startup banner:
```ts
console.log(`Watching ${entry} for changes... (Ctrl+C to stop)\n`)
console.log("  To test interactively:  clq inspect  (in another terminal)")
console.log("  This is a stdio MCP server — connect it via an MCP client to use it.")
```

**Acceptance criteria:**
- `clq dev` output includes the absolute path to the entry file being watched
- `clq dev` output mentions `clq inspect` as the interactive testing tool
- `clq dev` output notes that this is an stdio server (not HTTP)
- The `packages/cli/src/commands/dev.test.ts` existing assertion `"Watching for changes"` still passes (the new message still contains this substring) OR is updated to match the new exact format — choose whichever keeps the test intent clear
- No other behavior changes: the subprocess spawning, signal handling, and exit behavior are unchanged

**Tests to write or update:**
- Update the existing `dev.test.ts` assertion that checks for "Watching for changes" to also assert for the entry file path and "clq inspect" mention in the output

---

### PROMPT 7 — High: `clq inspect` must surface child process errors instead of silently timing out

**Target subsystem:**
- `packages/cli/src/commands/inspect/server.ts`
- `packages/cli/src/commands/inspect/server.test.ts`

**Context:** In `startInspectServer`, the child process's stderr is currently discarded:

```ts
child.stderr?.on("data", () => {})
```

When the project's entry file fails to start (TypeScript error, missing dependency, crash on load), the child process exits immediately without sending a `{ type: "tools" }` message. `startInspectServer` currently:
1. Waits 20 seconds for the tools registration
2. Returns with `registeredTools = []`
3. The inspector UI shows "This project registers no tools."

The developer has no indication that their server crashed. They must hunt for errors elsewhere. For a first-time user, this is a dead end.

**What to build:**

**Step 1 — Capture stderr from the child:**

Change the stderr drain to capture content:
```ts
let stderrOutput = ""
child.stderr?.setEncoding("utf8")
child.stderr?.on("data", (chunk: string) => {
  stderrOutput += chunk
})
```

**Step 2 — Detect early child exit:**

Add a flag and listener for child exit before tools are registered:
```ts
let childExited = false
let childExitCode: number | null = null
child.on("exit", (code) => {
  childExited = true
  childExitCode = code
  resolveRegistered() // unblock the wait
})
```

**Step 3 — After the race, check if tools were actually registered:**

```ts
await Promise.race([registeredPromise, sleep(20_000)])

if (childExited && registeredTools.length === 0) {
  // Clean up the HTTP server that was just started
  await new Promise<void>((resolve) => server.close(() => resolve()))
  const stderr = stderrOutput.trim()
  const detail = stderr ? `\n\nError output:\n${stderr}` : ""
  throw new Error(
    `Failed to start project: the server process exited with code ${childExitCode ?? "unknown"} before registering any tools.${detail}\n\nMake sure 'pnpm build' succeeded and 'src/index.ts' can run without errors.`
  )
}
```

**Step 4 — Update the CLI command in `inspect.ts` to surface the error:**

The error thrown by `startInspectServer` will be caught by the `uncaughtException` handler in `packages/cli/src/index.ts`, which already prints `Error: ${err.message}` to stderr. Verify this works end-to-end.

**Acceptance criteria:**
- When the project's entry file has a syntax error or crashes on load, `clq inspect` prints a clear error message within a few seconds (not after 20s)
- The error message includes the exit code and any stderr output from the failed child
- The error message includes a actionable fix ("Make sure pnpm build succeeded...")
- `clq inspect` exits with a non-zero code in this case
- When the project starts successfully, behavior is unchanged
- `packages/cli/src/commands/inspect/server.test.ts` adds a test for the failure case:
  - Spawn inspect with a root containing a broken `src/index.ts` (e.g., `throw new Error("startup crash")`)
  - Assert `startInspectServer` rejects with an error containing "exited"
  - Assert the error message contains the word "build" (pointing to the fix)

---

## 7. Final Answer

**Can CLQ be confidently shipped to 5 design partners today?**

**No.** Not yet.

The core framework is technically excellent. `defineTool`, `createServer`, the inspect UI, and the error system are all ready for production. But the first thing every design partner does is read the README and run `clq init`. The README currently describes CLQ as a "TypeScript monorepo for building conversational interfaces" and links to `example.com/docs`. After `clq init && pnpm build`, the developer has a compiled binary and no idea what to do with it. The generated template exposes framework internals that break silently if modified naively.

**What must be done first (in order):**

1. **Session 1** — Run Prompt 1 (README rewrite). ~1 hour. This is the landing page for all design partners and must go first.

2. **Session 2** — Run Prompts 2, 3, and 4 together (init next steps + protocol leak fix in server.ts + .gitignore/.env.example). These all touch the template and init command; doing them together avoids redundant test runs. ~2-3 hours.

3. **Session 3** — Run Prompts 5, 6, and 7 together (fix field on wire + dev output + inspect error message). These are independent error/output improvements. ~1-2 hours.

4. **Session 4** — Replace echo tool in template with weather example (Prompt 4). This depends on Session 2 (which rewrites the template). ~30 minutes.

**Estimate: 3-4 focused Claude Code sessions.**

After those four sessions, CLQ can be shipped to 5 design partners with reasonable confidence. The core promise — "you can build a working MCP server in 5 minutes without reading a spec" — will be demonstrably true. The secondary promise — "when things go wrong, CLQ tells you exactly what to do" — will be meaningfully improved.

The Medium findings (auto-.env loading, doctor dist check, inspect stderr capture for the non-crash case) should be addressed before a public beta but are not blockers for design partners who can ask for help directly.
