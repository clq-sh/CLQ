# CLQ — Phase 1 Build Document
### Stage-by-stage execution plan with QA gates and Claude Code prompts

> Companion to `clq.md`. This document is operational, not visionary. Every stage below produces working, tested code. No stage starts until the previous stage's QA passes.

---

## How To Use This Document

1. Open a Claude Code session.
2. For Stage 0 only: paste nothing extra, just the Stage 0 prompt.
3. For every stage after that: paste `ARCHITECTURE.md` and `DECISIONS.md` (they grow each stage) plus the specific files named in "Context to load" — then paste the stage prompt.
4. Let Claude Code build it.
5. Run the CLI test commands yourself. Do not move on if any fail.
6. Commit with the message format: `stage(N): <stage name>`.
7. Move to the next stage.

This keeps every Claude Code session small and cheap — you only ever load the files relevant to the stage in front of you, never the whole codebase.

**Non-negotiable rule across every stage:** if a test is missing, the stage is not done. No exceptions, no "I'll add tests later."

---

## Troubleshooting — Read This Before Reporting a Stage "Broken"

The single most common failure across every stage looks like this:

```
Cannot find module 'X' or its corresponding type declarations.
WARN   Local package.json exists, but node_modules missing, did you mean to install?
```

**This is not a code bug. It means a dependency got added to a package.json but `pnpm install` was never re-run afterward.** Editing package.json doesn't install anything — pnpm has to be told to go fetch and link it. Several stages in this document instruct Claude Code to add a new dependency (zod in Stage 2, zod-to-json-schema in Stage 4, @modelcontextprotocol/sdk in Stage 5). After any stage where a new dependency was added, run this before anything else:

```bash
pnpm install
```

Then re-run the stage's typecheck/test/build commands. Most "broken" reports resolve at this single step. Symptoms that are actually downstream of this same root cause and will usually disappear once `pnpm install` is run:

- "Cannot find module" errors
- Implicit `any` type errors on parameters typed using the missing module's types
- `.d.ts` / DTS build failures during `pnpm build` (the JS itself often builds fine via esbuild, which doesn't typecheck — only the type-declaration build step fails)
- Unused `@ts-expect-error` directives (when types collapse to `any` because a module failed to resolve, deliberate type violations stop being type errors, making the suppression comment itself an error)

**The second most common failure:** `pnpm --filter <package> test <pattern>` returns nothing at all — no error, no output. This means that package's `package.json` has no `"test"` script defined. Confirm every package has `"test": "vitest run"` in its `scripts` block (Stage 0 sets this up — if it's missing, add it).

If a problem persists after `pnpm install` and confirming the test script exists, paste the exact file content alongside the error — don't paste the error alone. Type errors three layers downstream of a missing dependency look identical to genuine logic bugs in the log output; the actual file content is what disambiguates them.

---

## Stage Map

| Stage | Name | Produces |
|---|---|---|
| 0 | Monorepo Bootstrap | Empty buildable workspace, tooling configured |
| 1 | Core Contracts | All TypeScript interfaces, zero implementation |
| 2 | Error System | ColloquialError, error catalog |
| 3 | Zod Tool Definition API | `defineTool()` |
| 4 | Protocol Engine | Pure MCP translation logic |
| 5 | MCP Stdio Driver | Real server speaking to a real transport |
| 6 | createServer() | The public entry point, wiring everything |
| 7 | Config System | `defineConfig()`, env validation |
| 8 | Integration Test | Claude Desktop handshake — Phase 1 exit condition |

---
---

## Stage 0 — Monorepo Bootstrap

### Goal
A pnpm monorepo that installs, builds, tests, and lints — with nothing in it yet.

### Expected Outcome
- `pnpm install` succeeds
- `pnpm build` succeeds across all packages (even though they export nothing)
- `pnpm test` runs and exits 0 (zero tests is a valid pass at this stage)
- `pnpm lint` runs clean
- Git repo initialized, MIT LICENSE in place, minimal README

### Files Created
```
colloquial/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── biome.json
├── vitest.workspace.ts
├── .gitignore
├── LICENSE
├── README.md
└── packages/
    ├── core/
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── tsup.config.ts
    │   └── src/index.ts        (empty export, e.g. `export {}`)
    ├── cli/
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── tsup.config.ts
    │   └── src/index.ts
    └── testing/
        ├── package.json
        ├── tsconfig.json
        ├── tsup.config.ts
        └── src/index.ts
```

### QA — What To Test
- `pnpm install` exits 0, lockfile generated
- `pnpm build` produces `dist/index.js`, `dist/index.cjs`, `dist/index.d.ts` in each package
- `pnpm test` exits 0
- `pnpm biome check .` exits 0 with no errors
- `pnpm -r exec node -e "console.log('ok')"` runs in every package without module resolution errors

### CLI Test Commands
```bash
pnpm install
pnpm build
pnpm test
pnpm biome check .
git log --oneline -1
```

### Claude Code Prompt

```
Build a pnpm TypeScript monorepo named "colloquial" at the current directory.

PACKAGES (3, each independent, no cross-deps yet):
- packages/core    → name "@clq-sh/core"
- packages/cli     → name "@clq-sh/cli"
- packages/testing → name "@clq-sh/testing"

ROOT CONFIG:
- package.json: private, workspaces via pnpm-workspace.yaml (packages: ["packages/*"]),
  scripts: build="pnpm -r run build", test="vitest run", lint="biome check .",
  typecheck="pnpm -r exec tsc --noEmit"
- devDependencies at root: typescript ^5.5, tsup ^8, vitest ^2, @biomejs/biome ^1.8, @types/node ^20
- tsconfig.base.json: strict true, target ES2022, module NodeNext, moduleResolution NodeNext,
  declaration true, skipLibCheck true, esModuleInterop true
- biome.json: enable formatter + linter, recommended ruleset, indentWidth 2, semicolons as needed
- vitest.workspace.ts: include all packages/*/src/**/*.test.ts
- .gitignore: node_modules, dist, .turbo, *.log
- LICENSE: MIT, copyright "The Systems Infrastructure Company, Inc."
- README.md: exactly 4 sections — what it is (2 sentences), install command, link to docs (placeholder), nothing else.

EACH PACKAGE:
- package.json: extends root devDeps where needed, "type": "module", main/module/types
  pointing at dist/, exports field for ESM+CJS dual output,
  scripts: { "build": "tsup", "test": "vitest run" }
  (the per-package "test" script is required — without it, `pnpm --filter <pkg> test <pattern>`
  silently does nothing instead of running or erroring, which is confusing to debug)
- tsconfig.json: extends ../../tsconfig.base.json, include src
- tsup.config.ts: entry ["src/index.ts"], format: ["esm","cjs"], dts: true, clean: true
- src/index.ts: just `export {}` for now — no logic yet, this stage is tooling only

DO NOT implement any framework logic. This stage is scaffolding only.
After creating everything, run pnpm install, pnpm build, pnpm test, pnpm lint yourself
and fix anything that fails before finishing.

Also create two empty living documents at the repo root:
- ARCHITECTURE.md with a single header "# CLQ Architecture Decisions" and nothing else
- DECISIONS.md with a single header "# CLQ Technical Decisions Log" and nothing else
We will append to both in every future stage.
```

---
---

## Stage 1 — Core Contracts

### Goal
Every interface the entire framework depends on, defined once, with zero implementation. This is the contract layer described in clq.md — it must not change shape across future phases, only grow with optional fields.

### Context to Load
`ARCHITECTURE.md`, `packages/core/src/index.ts`

### Expected Outcome
- `packages/core/src/types.ts` exporting every core interface
- Nothing executable — pure `.d.ts`-equivalent TypeScript
- `index.ts` re-exports all types
- ARCHITECTURE.md updated with the contract list and the "why" for each

### Files Created
```
packages/core/src/types.ts
packages/core/src/types.test.ts   (type-level tests only)
```

### Required Interfaces (exact shapes Claude Code must produce)
```typescript
interface ColloquialError {
  code: string            // machine-readable, e.g. "TOOL_VALIDATION_FAILED"
  message: string         // human-readable
  cause?: string          // likely cause, plain English
  fix?: string            // suggested fix, plain English
}

interface ColloquialContext {
  user?: { id: string; [key: string]: unknown }
  requestId: string
  timestamp: number
}

interface ColloquialToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string
  description: string
  input: unknown          // a Zod schema, typed loosely here to avoid circular dep
  output?: unknown        // optional Zod schema
  requiresAuth?: boolean
  requiredScope?: string
  handler: (args: { input: TInput; ctx: ColloquialContext }) => Promise<TOutput>
}

interface ColloquialDriver {
  name: string
  start: (config: ColloquialDriverStartConfig) => Promise<void>
  stop: () => Promise<void>
}

interface ColloquialDriverStartConfig {
  tools: ColloquialToolDefinition[]
  [key: string]: unknown
}

interface ColloquialServerConfig {
  name: string
  version: string
}

interface ColloquialMiddleware {
  name: string
  before?: (ctx: ColloquialContext) => Promise<void>
  after?: (ctx: ColloquialContext, result: unknown) => Promise<void>
}
```

### QA — What To Test
- Type-only tests using `expect-type` (add as devDependency) confirming each interface
  accepts valid shapes and rejects invalid ones
- `tsc --noEmit` passes with zero errors
- No runtime test needed — there is no runtime code yet

### CLI Test Commands
```bash
pnpm --filter @clq-sh/core typecheck
pnpm --filter @clq-sh/core test
pnpm build
```

### Claude Code Prompt

```
Context: packages/core/src/index.ts currently exports nothing. We are adding the
foundational type contracts for the CLQ framework. These types must NEVER change
shape in future phases — only gain new OPTIONAL fields. Treat this file as sacred.

Create packages/core/src/types.ts exporting these exact interfaces (add JSDoc comment
above each explaining its purpose in one line):

- ColloquialError { code: string; message: string; cause?: string; fix?: string }
- ColloquialContext { user?: { id: string; [key: string]: unknown }; requestId: string; timestamp: number }
- ColloquialToolDefinition<TInput = unknown, TOutput = unknown> { name: string; description: string;
  input: unknown; output?: unknown; requiresAuth?: boolean; requiredScope?: string;
  handler: (args: { input: TInput; ctx: ColloquialContext }) => Promise<TOutput> }
- ColloquialDriver { name: string; start: (config: ColloquialDriverStartConfig) => Promise<void>;
  stop: () => Promise<void> }
- ColloquialDriverStartConfig { tools: ColloquialToolDefinition[]; [key: string]: unknown }
- ColloquialServerConfig { name: string; version: string }
- ColloquialMiddleware { name: string; before?: (ctx: ColloquialContext) => Promise<void>;
  after?: (ctx: ColloquialContext, result: unknown) => Promise<void> }

Update packages/core/src/index.ts to `export * from './types.js'`

Add devDependency expect-type to packages/core/package.json.

Create packages/core/src/types.test.ts using vitest + expect-type with type-level
assertions for at least: ColloquialError requires code+message, ColloquialToolDefinition
requires name+description+input+handler, ColloquialDriver requires name+start+stop.

Append to ARCHITECTURE.md a new section "## Stage 1 — Core Contracts" listing each
interface and a one-sentence reason it exists. Append to DECISIONS.md: "Interfaces are
frozen contracts. New fields must be optional. No breaking changes, ever."

Run pnpm --filter @clq-sh/core typecheck and pnpm --filter @clq-sh/core test yourself.
Fix anything that fails. Do not implement any logic beyond types in this stage.
```

---
---

## Stage 2 — Error System

### Goal
Every error CLQ ever throws is structured, human-readable, and catchable. Built second so every later stage uses it from day one instead of retrofitting.

### Context to Load
`ARCHITECTURE.md`, `packages/core/src/types.ts`

### Expected Outcome
- `ColloquialErrorImpl` class implementing `ColloquialError`, extends native `Error`
- An `errors` catalog object with factory functions for known error cases
- Every factory produces code + message + cause + fix

### Files Created
```
packages/core/src/errors.ts
packages/core/src/errors.test.ts
```

### Required Error Factories (minimum set for Phase 1)
```
errors.missingDescription(toolName: string)
errors.invalidInput(toolName: string, zodError: unknown)
errors.invalidOutput(toolName: string, zodError: unknown)
errors.toolNotFound(toolName: string)
errors.missingEnvVar(varName: string, description?: string)
errors.unauthorized(toolName: string, requiredScope?: string)
```

### QA — What To Test
- Each factory returns an object with all four fields populated and non-empty
- `code` values are SCREAMING_SNAKE_CASE and unique across the catalog
- `ColloquialErrorImpl` is `instanceof Error`
- Error messages never contain the literal string "undefined" or "[object Object]"
- Zod errors passed in are formatted into a readable `cause`, not dumped raw

### CLI Test Commands
```bash
# This stage adds zod as a new dependency — install before testing:
pnpm install
pnpm --filter @clq-sh/core test errors
pnpm --filter @clq-sh/core typecheck
```

### Claude Code Prompt

```
Context: packages/core/src/types.ts defines ColloquialError. Build the runtime error
system on top of it.

Create packages/core/src/errors.ts:

1. Class ColloquialErrorImpl extends Error implementing ColloquialError
   - constructor(props: ColloquialError)
   - assigns code, cause, fix as properties
   - sets this.message = props.message
   - sets this.name = 'ColloquialError'

2. An exported `errors` object (factory catalog) with these functions, each returning
   a `new ColloquialErrorImpl(...)`:
   - missingDescription(toolName: string) → code "TOOL_MISSING_DESCRIPTION"
     message: `Tool '${toolName}' is missing a description.`
     cause: "AI agents rely on tool descriptions to decide when to call them."
     fix: "Add a clear, one-sentence description explaining what this tool does and when to use it."
   - invalidInput(toolName: string, zodError: import('zod').ZodError) → code "TOOL_INVALID_INPUT"
     message: `Tool '${toolName}' received invalid input.`
     cause: format zodError.issues into a short readable string, e.g. "field 'location': Required"
     fix: "Check the input matches the tool's input schema."
   - invalidOutput(toolName: string, zodError: import('zod').ZodError) → code "TOOL_INVALID_OUTPUT"
     (same pattern as invalidInput but about the handler's return value)
   - toolNotFound(toolName: string) → code "TOOL_NOT_FOUND"
     message: `Tool '${toolName}' is not registered on this server.`
     fix: "Check the tool name matches exactly, or register it with server.tool()."
   - missingEnvVar(varName: string, description?: string) → code "CONFIG_MISSING_ENV_VAR"
     message: `Required environment variable '${varName}' is not set.`
     cause: description ?? "This variable is required by colloquial.config.ts"
     fix: `Set ${varName} in your .env file or environment before starting the server.`
   - unauthorized(toolName: string, requiredScope?: string) → code "TOOL_UNAUTHORIZED"
     message: `Call to '${toolName}' was rejected — missing required authorization.`
     cause: requiredScope ? `This tool requires scope '${requiredScope}'.` : "This tool requires authentication."
     fix: "Provide a valid authenticated token with the correct scope."

Write a private helper `formatZodIssues(error: ZodError): string` that joins
`issue.path.join('.') + ': ' + issue.message` with semicolons, capped at 3 issues
shown plus "...and N more" if there are more.

Add zod as a dependency to packages/core/package.json if not present.

Write packages/core/src/errors.test.ts with vitest covering: every factory above,
asserting instanceof Error, instanceof ColloquialErrorImpl, all 4 fields non-empty,
code format matches /^[A-Z_]+$/, and that formatZodIssues output never contains
"undefined" or "[object Object]". Test with a real Zod schema parse failure to get
a genuine ZodError, don't mock it.

Export ColloquialErrorImpl and errors from packages/core/src/index.ts.

Append "## Stage 2 — Error System" to ARCHITECTURE.md explaining the 4-field error
contract. Append to DECISIONS.md: "All errors are human-readable. No raw stack traces
or 'undefined' shown to developers. Every error names a likely cause and a concrete fix."

Run the tests yourself, fix failures, confirm typecheck passes before finishing.
```

---
---

## Stage 3 — Zod-Native Tool Definition API

### Goal
`defineTool()` — the single most important function in the entire framework. The developer-facing heart of the DX.

### Context to Load
`ARCHITECTURE.md`, `packages/core/src/types.ts`, `packages/core/src/errors.ts`

### Expected Outcome
- `defineTool()` accepts a Zod input schema, optional Zod output schema, description, handler
- Returns a fully typed `ColloquialToolDefinition`
- Wraps the handler so input is validated before the handler runs and output is validated after
- Validation failures throw the correct `ColloquialErrorImpl` from Stage 2
- TypeScript correctly infers handler argument types from the Zod input schema

### Files Created
```
packages/core/src/tool.ts
packages/core/src/tool.test.ts
```

### QA — What To Test
- Valid input → handler called with correctly typed, parsed input → valid output returned
- Invalid input → throws `TOOL_INVALID_INPUT` before handler ever executes (handler must not run — assert with a spy/mock)
- Handler returns invalid output (when output schema given) → throws `TOOL_INVALID_OUTPUT`
- Missing description → throws `TOOL_MISSING_DESCRIPTION` at `defineTool()` call time, not at call time
- Tool with no output schema skips output validation entirely
- Type-level test: handler's `input` argument type matches `z.infer` of the input schema exactly

### CLI Test Commands
```bash
pnpm --filter @clq-sh/core test tool
pnpm --filter @clq-sh/core typecheck
```

### Claude Code Prompt

```
Context: packages/core/src/types.ts has ColloquialToolDefinition. packages/core/src/errors.ts
has the `errors` catalog (missingDescription, invalidInput, invalidOutput). Build defineTool().

Create packages/core/src/tool.ts:

export function defineTool<TInputSchema extends import('zod').ZodTypeAny,
  TOutputSchema extends import('zod').ZodTypeAny | undefined = undefined>(config: {
  name: string
  description: string
  input: TInputSchema
  output?: TOutputSchema
  requiresAuth?: boolean
  requiredScope?: string
  handler: (args: {
    input: import('zod').infer<TInputSchema>
    ctx: ColloquialContext
  }) => Promise<TOutputSchema extends import('zod').ZodTypeAny ? import('zod').infer<TOutputSchema> : unknown>
}): ColloquialToolDefinition

Behavior:
1. At call time (when defineTool itself runs, not when the tool is later invoked):
   if !config.description?.trim() → throw errors.missingDescription(config.name)
2. Return a ColloquialToolDefinition whose `handler` is a WRAPPED version of
   config.handler that does, in order, every time it's invoked:
   a. result = config.input.safeParse(rawInput)
      if !result.success → throw errors.invalidInput(config.name, result.error)
   b. call the real handler with { input: result.data, ctx }
   c. if config.output exists:
        outResult = config.output.safeParse(handlerReturnValue)
        if !outResult.success → throw errors.invalidOutput(config.name, outResult.error)
        return outResult.data
      else return handlerReturnValue unchanged

Import zod as a type and runtime dependency (already added in Stage 2).

Write packages/core/src/tool.test.ts with vitest:
- valid input + valid output → returns expected result
- invalid input → throws, AND assert via vi.fn() spy that the real handler was NEVER called
- valid input + invalid output (handler returns wrong shape) → throws TOOL_INVALID_OUTPUT
- empty description ("" or whitespace only) → throws TOOL_MISSING_DESCRIPTION at defineTool() call,
  before any input is ever processed
- tool defined with no `output` key → handler return value passed through with zero validation
- add one type-only test using expect-type confirming the handler's `input` param type
  equals z.infer<typeof someSchema> for a sample object schema

Export defineTool from packages/core/src/index.ts.

Append "## Stage 3 — defineTool()" to ARCHITECTURE.md: explain validation happens at
both the input boundary and the output boundary, and that description is mandatory
because it directly drives Agentic Experience (AX) — bad descriptions make AI agents
call tools incorrectly. Append to DECISIONS.md: "defineTool() takes a single options
object, never positional args, so future optional fields never break existing code."

Run tests and typecheck yourself, fix failures, before finishing.
```

---
---

## Stage 4 — Protocol Engine (Pure MCP Translation Logic)

### Goal
Pure, transport-free functions that translate between `ColloquialToolDefinition[]` and the MCP wire format. No real server yet — just the translation logic, unit-tested as plain functions. This isolation makes the hardest part of the system the easiest to test.

### Context to Load
`ARCHITECTURE.md`, `packages/core/src/types.ts`, `packages/core/src/errors.ts`

### Expected Outcome
- `toolToMCPSchema(tool)` — converts one tool's Zod input schema into MCP's JSON-Schema tool format
- `buildToolsList(tools)` — produces the full `tools/list` response shape
- `dispatchToolCall(tools, name, args, ctx)` — finds the matching tool, runs its handler, returns MCP-shaped result or MCP-shaped error
- Uses `zod-to-json-schema` for schema conversion

### Files Created
```
packages/core/src/protocol/translate.ts
packages/core/src/protocol/translate.test.ts
```

### QA — What To Test
- `toolToMCPSchema` produces valid JSON Schema with correct `type`, `properties`, `required` for a sample Zod object schema
- `buildToolsList` returns one entry per registered tool with `name`, `description`, `inputSchema`
- `dispatchToolCall` with a known tool name + valid args → returns `{ content: [...] }` shaped result
- `dispatchToolCall` with unknown tool name → returns MCP-shaped error referencing `TOOL_NOT_FOUND`
- `dispatchToolCall` with invalid args → returns MCP-shaped error referencing `TOOL_INVALID_INPUT`, handler never runs

### CLI Test Commands
```bash
# This stage adds zod-to-json-schema as a new dependency — install before testing:
pnpm install
pnpm --filter @clq-sh/core test protocol
pnpm --filter @clq-sh/core typecheck
```

### Claude Code Prompt

```
Context: packages/core/src/types.ts has ColloquialToolDefinition. packages/core/src/tool.ts
has defineTool() which already wraps handlers with validation. packages/core/src/errors.ts
has the errors catalog. We are now building the PURE translation layer between CLQ's
internal tool format and the MCP wire format. No real transport or SDK wiring yet —
that's Stage 5. This stage is pure functions only, fully unit-testable without any
process spawning or I/O.

Add dependency zod-to-json-schema to packages/core/package.json.

Create packages/core/src/protocol/translate.ts with:

1. toolToMCPSchema(tool: ColloquialToolDefinition): { name: string; description: string;
   inputSchema: object }
   - use zodToJsonSchema from 'zod-to-json-schema' on tool.input (cast to ZodTypeAny)
   - return { name: tool.name, description: tool.description, inputSchema: <converted schema> }

2. buildToolsList(tools: ColloquialToolDefinition[]): { tools: ReturnType<typeof toolToMCPSchema>[] }
   - maps every tool through toolToMCPSchema

3. type MCPCallResult =
   | { content: [{ type: 'text'; text: string }] }
   | { isError: true; content: [{ type: 'text'; text: string }] }

4. async dispatchToolCall(tools: ColloquialToolDefinition[], name: string, rawArgs: unknown,
   ctx: ColloquialContext): Promise<MCPCallResult>
   - find tool = tools.find(t => t.name === name)
   - if not found: catch via try/catch pattern — return
     { isError: true, content: [{ type: 'text', text: errors.toolNotFound(name).message }] }
   - else: try { result = await tool.handler({ input: rawArgs, ctx }) }
     - tool.handler already validates input/output internally (from defineTool), so just
       call it directly with rawArgs — do NOT re-validate here, that would duplicate Stage 3's job
     - on success: return { content: [{ type: 'text', text: JSON.stringify(result) }] }
     - on catch (err): if err is a ColloquialErrorImpl, return
       { isError: true, content: [{ type: 'text', text: err.message }] }
       else rethrow (unexpected errors should not be silently swallowed)

Write packages/core/src/protocol/translate.test.ts with vitest covering all 4 functions:
- toolToMCPSchema on a tool with z.object({ location: z.string() }) input produces a
  JSON schema with properties.location.type === 'string' and required including 'location'
- buildToolsList with 2 tools returns 2 entries with correct names
- dispatchToolCall with a real defineTool()-created tool + valid args → success content shape
- dispatchToolCall with unknown name → isError true, message matches toolNotFound's message
- dispatchToolCall with invalid args against a real tool (e.g. missing required field) →
  isError true, message contains the TOOL_INVALID_INPUT context (test this against a real
  tool built with defineTool(), not a mock, so the real validation path is exercised)

Export toolToMCPSchema, buildToolsList, dispatchToolCall, MCPCallResult type from
packages/core/src/index.ts (re-export from protocol/translate.js).

Append "## Stage 4 — Protocol Translation" to ARCHITECTURE.md: explain this layer is
pure and transport-agnostic by design — the same functions will be reused by stdio,
HTTP, and any future MCP transport without modification. Append to DECISIONS.md:
"Protocol translation never touches the network. Transports call into these pure
functions. This is what makes adding HTTP in Phase 3 additive, not a rewrite."

Run tests and typecheck yourself, fix failures, before finishing.
```

---
---

## Stage 5 — MCP Stdio Driver (Real Server, Real Transport)

### Goal
Wire Stage 4's pure logic into the real `@modelcontextprotocol/sdk`, producing an actual MCP server that speaks stdio and could be pointed at by Claude Desktop today.

### Context to Load
`ARCHITECTURE.md`, `packages/core/src/types.ts`, `packages/core/src/protocol/translate.ts`

### Expected Outcome
- `createMCPStdioDriver()` returns a `ColloquialDriver`
- `.start({ tools })` boots a real `Server` from the MCP SDK over `StdioServerTransport`
- Registers `ListToolsRequestSchema` and `CallToolRequestSchema` handlers using Stage 4's pure functions
- `.stop()` cleanly closes the transport

### Files Created
```
packages/core/src/protocol/mcp-stdio-driver.ts
packages/core/src/protocol/mcp-stdio-driver.test.ts
```

### QA — What To Test
This is the first stage where real process I/O matters. Test via child process spawning.

- Build a tiny test fixture server script that imports the driver, registers 2 fake tools, calls `.start()`
- Spawn it as a child process with `spawnSync`/`spawn` from `node:child_process`
- Write a JSON-RPC `initialize` request to its stdin, assert a valid `initialize` response on stdout
- Write a `tools/list` request, assert both fake tools appear with correct schemas
- Write a `tools/call` request for one tool with valid args, assert correct result
- Write a `tools/call` request with an unknown tool name, assert an MCP-shaped error response, not a crash

### CLI Test Commands
```bash
# This stage adds @modelcontextprotocol/sdk as a new dependency — install before testing:
pnpm install
pnpm --filter @clq-sh/core test mcp-stdio
pnpm --filter @clq-sh/core build
# manual smoke test after build:
node packages/core/dist/test-fixtures/stdio-server.js
# (then paste a raw JSON-RPC initialize message and press enter, confirm a response prints)
```

### Claude Code Prompt

```
Context: packages/core/src/protocol/translate.ts has buildToolsList and dispatchToolCall
(pure functions). @modelcontextprotocol/sdk is the official MCP SDK — add it as a
dependency to packages/core/package.json (latest stable). We are now wiring the pure
translation layer into a REAL server using the REAL SDK, over stdio transport.

Create packages/core/src/protocol/mcp-stdio-driver.ts:

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { buildToolsList, dispatchToolCall } from './translate.js'
import type { ColloquialDriver, ColloquialToolDefinition, ColloquialContext } from '../types.js'

export function createMCPStdioDriver(serverInfo: { name: string; version: string }): ColloquialDriver {
  let server: Server | undefined
  let transport: StdioServerTransport | undefined

  return {
    name: 'mcp-stdio',
    async start(config) {
      server = new Server(serverInfo, { capabilities: { tools: {} } })

      server.setRequestHandler(ListToolsRequestSchema, async () => {
        return buildToolsList(config.tools as ColloquialToolDefinition[])
      })

      server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const ctx: ColloquialContext = { requestId: crypto.randomUUID(), timestamp: Date.now() }
        return dispatchToolCall(
          config.tools as ColloquialToolDefinition[],
          request.params.name,
          request.params.arguments,
          ctx
        )
      })

      transport = new StdioServerTransport()
      await server.connect(transport)
    },
    async stop() {
      await transport?.close()
    }
  }
}

(Adjust import paths/types if the installed SDK version's actual exports differ slightly
from the above — inspect node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.d.ts
and types.d.ts to confirm exact names before finalizing, and note any discrepancy in
DECISIONS.md.)

Create a test fixture at packages/core/src/protocol/test-fixtures/stdio-server.ts:
a minimal standalone script that imports createMCPStdioDriver, defines 2 simple tools
via defineTool() (one that echoes a string, one that adds two numbers), calls
driver.start({ tools: [...] }), and keeps the process alive listening on stdio.
Add it as a build entry in tsup.config.ts (additional entry point) so it compiles to
packages/core/dist/test-fixtures/stdio-server.js for manual testing.

Create packages/core/src/protocol/mcp-stdio-driver.test.ts using vitest +
node:child_process spawn:
- spawn the compiled test fixture (build first if needed, or use tsx to run the .ts
  directly via execa/spawn with 'tsx' loader — pick whichever is more reliable)
- send a JSON-RPC initialize message over stdin (newline-delimited JSON per MCP stdio spec)
- assert a well-formed initialize response comes back on stdout within a timeout (e.g. 3s)
- send a tools/list request, assert response includes both fixture tools by name
- send a tools/call request for the echo tool with valid args, assert correct result text
- send a tools/call request for a nonexistent tool name, assert an isError response,
  not a process crash (assert process is still alive / exit code not yet set)
- kill the child process in an afterEach/afterAll to avoid orphaned processes

Export createMCPStdioDriver from packages/core/src/index.ts.

Append "## Stage 5 — MCP Stdio Driver" to ARCHITECTURE.md: this is the first DRIVER
implementing the ColloquialDriver interface from Stage 1. Note explicitly that adding
a second driver (REST, Web3, future protocols) later means writing a new file that
implements the same ColloquialDriver interface — nothing here changes. Append to
DECISIONS.md: "Drivers are the only place that touch real I/O. Protocol logic
(Stage 4) stays pure and is reused by every driver."

Run the test yourself. This stage involves real process spawning — be patient with
timing, use generous timeouts (3-5s), and ensure no child process is left running
after the test suite exits. Fix failures before finishing.
```

---
---

## Stage 6 — createServer() — The Public Entry Point

### Goal
The actual function developers call. Wires tool registration, driver selection, and the (currently no-op) middleware system into one clean object.

### Context to Load
`ARCHITECTURE.md`, `packages/core/src/types.ts`, `packages/core/src/protocol/mcp-stdio-driver.ts`, `packages/core/src/tool.ts`

### Expected Outcome
- `createServer(config)` → object with `.tool()`, `.use()`, `.start()`
- `.tool(toolDef)` registers a tool, returns `this` for chaining
- `.use(middleware)` stores middleware in an array, does not execute it yet (Phase 1 scope — middleware execution is Phase 3, the slot just has to exist and not throw)
- `.start({ driver: 'mcp', transport: 'stdio' })` resolves to the stdio driver and calls its `.start()` with the registered tools
- `.start({ driver: 'auto' })` defaults to `'mcp'` + `'stdio'` in Phase 1 (only driver that exists)

### Files Created
```
packages/core/src/server.ts
packages/core/src/server.test.ts
```

### QA — What To Test
- `.tool()` called twice with different tools → both appear when `.start()` is invoked (assert via a spy on the driver's start method, don't spin up real stdio in this unit test — that's Stage 5's job)
- `.tool()` called twice with the SAME tool name → throws a clear error (duplicate registration)
- `.use()` accepts a middleware object and does not throw
- `.start({ driver: 'unknown-driver' })` throws a clear `ColloquialErrorImpl`, not a generic crash
- Chaining `server.tool(a).tool(b)` works because `.tool()` returns `this`

### CLI Test Commands
```bash
pnpm --filter @clq-sh/core test server
pnpm --filter @clq-sh/core typecheck
pnpm build
```

### Claude Code Prompt

```
Context: packages/core/src/protocol/mcp-stdio-driver.ts exports createMCPStdioDriver.
packages/core/src/tool.ts exports defineTool. packages/core/src/types.ts has
ColloquialServerConfig, ColloquialToolDefinition, ColloquialMiddleware, ColloquialDriver.

Add a new error factory to packages/core/src/errors.ts:
- duplicateTool(toolName: string) → code "TOOL_DUPLICATE_NAME"
  message: `A tool named '${toolName}' is already registered on this server.`
  fix: "Use a unique name for each tool."
- unknownDriver(driverName: string) → code "DRIVER_UNKNOWN"
  message: `Driver '${driverName}' is not recognized.`
  fix: "Use 'mcp' (the only available driver in this version) or 'auto'."

Create packages/core/src/server.ts:

type StartOptions = { driver?: 'mcp' | 'auto'; transport?: 'stdio' }

export function createServer(config: ColloquialServerConfig) {
  const tools: ColloquialToolDefinition[] = []
  const middleware: ColloquialMiddleware[] = []

  const api = {
    tool(def: ColloquialToolDefinition) {
      if (tools.some(t => t.name === def.name)) throw errors.duplicateTool(def.name)
      tools.push(def)
      return api
    },
    use(mw: ColloquialMiddleware) {
      middleware.push(mw)
      return api
    },
    async start(options: StartOptions = {}) {
      const driverName = options.driver === 'auto' || !options.driver ? 'mcp' : options.driver
      if (driverName !== 'mcp') throw errors.unknownDriver(driverName)
      const driver = createMCPStdioDriver({ name: config.name, version: config.version })
      await driver.start({ tools })
      return driver // returned so caller can call .stop() in tests
    }
  }
  return api
}

Write packages/core/src/server.test.ts with vitest:
- mock/spy createMCPStdioDriver (vi.mock the module) so this test stays a pure unit test
  and never touches real stdio — assert the mocked driver's start() was called with the
  exact array of registered tools
- registering 2 tools then calling .start() → driver.start called with both, in order
- registering a duplicate name → throws TOOL_DUPLICATE_NAME, message includes the name
- .use() with a valid middleware object → does not throw, returns api for chaining
- .start({ driver: 'something-fake' }) → throws DRIVER_UNKNOWN
- server.tool(a).tool(b) chains correctly (returns same api object both times)

Export createServer from packages/core/src/index.ts.

Append "## Stage 6 — createServer()" to ARCHITECTURE.md: note that .use() exists now
but does nothing yet — middleware EXECUTION is Phase 3 scope, this stage only reserves
the API surface so it never has to change shape later. Append to DECISIONS.md:
"createServer() returns a chainable object. .tool() and .use() both return `this`.
Adding execution behavior to .use() later is additive — the signature is already final."

Run tests, typecheck, and build yourself, fix failures, before finishing.
```

---
---

## Stage 7 — Config System

### Goal
`defineConfig()` — the `colloquial.config.ts` validation layer. Declares env vars with types and descriptions, validates at startup, fails loud and clear if something required is missing.

### Context to Load
`ARCHITECTURE.md`, `packages/core/src/types.ts`, `packages/core/src/errors.ts`

### Expected Outcome
- `defineConfig({ name, version, env })` returns a typed config object
- `env` declarations describe expected environment variables: type, description, optional default
- A separate `loadConfig(config)` function reads `process.env`, validates against the declared shape, throws `CONFIG_MISSING_ENV_VAR` with the variable's description in the error if missing and no default given

### Files Created
```
packages/core/src/config.ts
packages/core/src/config.test.ts
```

### QA — What To Test
- `defineConfig()` with no `env` block → valid config, `loadConfig()` resolves with empty env object
- `defineConfig()` with one required string env var, present in `process.env` → `loadConfig()` returns it correctly typed as string
- Required env var absent from `process.env`, no default → `loadConfig()` throws `CONFIG_MISSING_ENV_VAR`, message includes the variable name and its description
- Env var with a default, absent from `process.env` → `loadConfig()` returns the default
- Secret-flagged env vars are never included in any error message text (assert the actual secret value never appears in thrown error's message/cause/fix)

### CLI Test Commands
```bash
pnpm --filter @clq-sh/core test config
pnpm --filter @clq-sh/core typecheck
pnpm build
```

### Claude Code Prompt

```
Context: packages/core/src/errors.ts has the errors catalog including missingEnvVar.
Build the config declaration + loading system.

Create packages/core/src/config.ts:

type EnvVarDeclaration = {
  type: 'string' | 'number' | 'boolean'
  description: string
  secret?: boolean
  default?: string | number | boolean
}

type ColloquialConfigInput = {
  name: string
  version: string
  env?: Record<string, EnvVarDeclaration>
}

export function defineConfig(config: ColloquialConfigInput): ColloquialConfigInput {
  return config // Phase 1: identity function with a typed signature. Validation of the
                 // SHAPE happens here implicitly via TypeScript; runtime env LOADING
                 // happens separately in loadConfig() below, because env is only
                 // available at server start time, not at config-definition time.
}

export function loadConfig(config: ColloquialConfigInput): Record<string, string | number | boolean> {
  const resolved: Record<string, string | number | boolean> = {}
  for (const [key, decl] of Object.entries(config.env ?? {})) {
    const raw = process.env[key]
    if (raw === undefined) {
      if (decl.default !== undefined) { resolved[key] = decl.default; continue }
      throw errors.missingEnvVar(key, decl.description)
    }
    if (decl.type === 'number') {
      const n = Number(raw)
      if (Number.isNaN(n)) throw errors.missingEnvVar(key, `${decl.description} (expected a number, got "${raw}")`)
      resolved[key] = n
    } else if (decl.type === 'boolean') {
      resolved[key] = raw === 'true' || raw === '1'
    } else {
      resolved[key] = raw
    }
  }
  return resolved
}

Write packages/core/src/config.test.ts with vitest. Use vi.stubEnv or manually set/delete
process.env keys in beforeEach/afterEach to keep tests isolated:
- no env block → loadConfig returns {}
- required string var present → returned correctly as string
- required var absent, no default → throws CONFIG_MISSING_ENV_VAR, message contains
  the var name, cause contains the declared description
- var absent but has a default → returned default value, correct type
- number type var with a non-numeric raw value → throws with a clear message mentioning
  "expected a number"
- boolean type var with raw "true" → resolves to literal boolean true (not string "true")
- a var marked secret: true that throws because it's missing → assert the error's
  message/cause/fix strings do NOT contain any literal secret VALUE (there is none yet
  since it's missing, but assert the description is shown and nothing else leaks)

Export defineConfig, loadConfig from packages/core/src/index.ts.

Append "## Stage 7 — Config System" to ARCHITECTURE.md: defineConfig is a typed
declaration only; loadConfig does the actual reading of process.env, kept separate
because env access must happen at server-start time, not at module-import time.
Append to DECISIONS.md: "Config validation never silently passes through invalid
values. Wrong type or missing required var always throws before the server starts,
never fails confusingly later mid-request."

Run tests, typecheck, build yourself, fix failures, before finishing.
```

---
---

## Stage 8 — Integration Test: The Phase 1 Exit Condition

### Goal
One real, complete MCP server — built using ONLY the public API (`createServer`, `defineTool`, `defineConfig`) — that a real MCP client (Claude Desktop, or the official MCP Inspector CLI) can connect to and use correctly. This is the line that closes Phase 1.

### Context to Load
`ARCHITECTURE.md` (full), `packages/core/src/index.ts` (to confirm exact public exports)

### Expected Outcome
- A real example app in `examples/weather-server/` using public exports only
- 3 real tools: `get_weather`, `list_supported_cities`, `convert_temperature`
- A passing automated integration test simulating the exact Claude Desktop handshake sequence: `initialize` → `notifications/initialized` → `tools/list` → `tools/call` (multiple)
- A manual verification checklist for actually plugging it into Claude Desktop

### Files Created
```
examples/weather-server/
├── package.json
├── colloquial.config.ts
├── src/index.ts
└── src/index.test.ts
```

### QA — What To Test
- Full handshake sequence against the real built example, via the same child-process + stdio technique as Stage 5, but now hitting a REAL example app, not a fixture
- `tools/list` returns exactly 3 tools with correct names and valid JSON schemas
- `tools/call` for `get_weather` with a valid city → success result
- `tools/call` for `get_weather` with missing required field → MCP-shaped error, not a crash
- `tools/call` for `convert_temperature` chained conceptually after `get_weather` (simulating an agent using two tools in sequence) → both succeed independently
- Process stays alive and responsive after an error (one bad call must not kill the server for subsequent calls)

### CLI Test Commands
```bash
pnpm --filter weather-server test
pnpm build
node examples/weather-server/dist/index.js
# then manually paste a JSON-RPC initialize request and confirm a response

# Real-world manual check — add to claude_desktop_config.json:
# { "mcpServers": { "weather-test": { "command": "node",
#   "args": ["<absolute-path>/examples/weather-server/dist/index.js"] } } }
# Restart Claude Desktop, open a new chat, confirm the weather tools appear and work.
```

### Claude Code Prompt

```
Context: packages/core/src/index.ts publicly exports createServer, defineTool,
defineConfig (and types). This is the FINAL stage of Phase 1 — build a real, complete
example server using ONLY those public exports, as if you were an external developer
with zero knowledge of CLQ's internals.

Create examples/weather-server/ as a new workspace package (add to root
pnpm-workspace.yaml if not using a glob that already covers examples/*):

package.json: name "weather-server", private true, dependencies: "@clq-sh/core": "workspace:*", zod
colloquial.config.ts:
  import { defineConfig } from '@clq-sh/core'
  export default defineConfig({ name: 'weather-server', version: '1.0.0' })

src/index.ts — build exactly 3 tools using defineTool() and wire them with createServer():

1. get_weather: input { location: z.string().describe('City name') },
   output { temperature: z.number(), condition: z.string() },
   handler returns deterministic fake data based on a small hardcoded lookup
   (Addis Ababa → 22/'sunny', London → 14/'cloudy', else → 18/'clear') so tests are
   reproducible without a real network call.

2. list_supported_cities: input z.object({}) (no params),
   output { cities: z.array(z.string()) },
   handler returns the hardcoded list of supported city names.

3. convert_temperature: input { celsius: z.number() },
   output { fahrenheit: z.number() },
   handler returns celsius * 9/5 + 32.

At the bottom of src/index.ts:
  const server = createServer({ name: 'weather-server', version: '1.0.0' })
  server.tool(getWeatherTool).tool(listCitiesTool).tool(convertTempTool)
  server.start({ driver: 'mcp', transport: 'stdio' })

Add a tsup.config.ts and build script identical in style to packages/core's, output
to dist/index.js (single entry, no dts needed for an example app).

Write examples/weather-server/src/index.test.ts using vitest + node:child_process,
following the same spawn + newline-delimited JSON-RPC stdin/stdout pattern used in
Stage 5's mcp-stdio-driver.test.ts (reuse that pattern, do not reinvent it):

- spawn the built dist/index.js
- send initialize, assert valid response
- send notifications/initialized (no response expected, just confirm no crash)
- send tools/list, assert exactly 3 tools returned with names get_weather,
  list_supported_cities, convert_temperature, and that each has a valid inputSchema
- send tools/call for get_weather with { location: 'Addis Ababa' }, assert result
  content contains temperature 22 and condition 'sunny'
- send tools/call for get_weather with {} (missing required location), assert an
  isError response — and then immediately send a SECOND valid tools/call afterward
  in the same test, asserting the server is still responsive and returns a correct
  result (this proves one bad call doesn't kill the process)
- send tools/call for convert_temperature with { celsius: 0 }, assert fahrenheit: 32
- kill the child process at the end

After this test passes, write a short MANUAL-VERIFICATION.md inside
examples/weather-server/ with the exact JSON snippet to add to Claude Desktop's
config file (mcpServers entry pointing at the absolute path of dist/index.js) and
a 3-step checklist: restart Claude Desktop, start a new chat, ask "what's the
weather in Addis Ababa" and confirm the model calls the tool correctly.

Finally, append a closing section to ARCHITECTURE.md: "## Phase 1 — Complete" stating
the exit condition (this integration test) passed, listing the final public API surface
(createServer, defineTool, defineConfig, plus exported types), and noting Phase 1 is
the foundation Phase 2 (CLI) builds on without modifying any of it.

Run the integration test yourself. This is the most important test in the entire
codebase so far — be thorough, use generous timeouts, and do not finish until it is
fully green.
```

---
---

## Phase 1 Exit Checklist

Phase 1 is not done until every box is true:

- [ ] All 9 stages built in order, each with passing tests before moving to the next
- [ ] `pnpm build` succeeds at the repo root with zero errors
- [ ] `pnpm test` succeeds at the repo root with zero failures
- [ ] `pnpm lint` and `pnpm typecheck` both clean at the repo root
- [ ] Stage 8's integration test passes
- [ ] Manual verification: weather-server actually works inside real Claude Desktop
- [ ] `ARCHITECTURE.md` has one section per stage, written as you went, not retrofitted
- [ ] `DECISIONS.md` has the running log of every binding architectural choice
- [ ] Public API surface is exactly: `createServer`, `defineTool`, `defineConfig`, plus
      the core types — nothing more. If something extra leaked into the public exports,
      remove it before calling this done.

When every box is checked: commit, tag `v0.1.0-phase1`, and move to Phase 2 (the CLI).

---

*This document is the execution layer beneath `clq.md`. clq.md is the vision and the business. This is the build.*
