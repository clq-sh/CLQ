# BETA-READY

**Date:** 2026-06-30

**Test results:** 132 tests, 18 test files, 100% pass rate

**Sessions completed:**
1. Core framework refactor — improved onboarding, error handling, and CLI stability
2. Wire error quality — surface `cause`/`fix` in MCP responses; `clq dev` startup output; `clq inspect` fast-fail on child crash
3. DX fix — inspect branching moved into `createServer().start()`; template simplified; `.gitignore` and `.env.example` added to scaffold
4. README rewrite — code-first, minimal, no placeholder content
5. Final verification, OSS baseline, npm pack audit, and beta clearance (this session)

CLQ is a TypeScript framework that turns `defineTool` + `server.start()` into a fully wired MCP server — protocol, validation, transport, and error formatting handled entirely by the framework. It is ready for design partners because the full happy path works end-to-end with 132 passing tests, the generated template is clean enough to ship without reading documentation, and every known rough edge has been addressed.

**Get your first MCP server running:**

```sh
npm install -g @clq-sh/cli
clq init my-server
cd my-server && pnpm install && pnpm build
clq inspect
```
