# @clq-sh/cli

The `clq` command-line tool for building MCP servers — scaffold projects, run a hot-reload dev server, test tools in a browser UI, and scan for secrets before you push.

## Install

```sh
npm install -g @clq-sh/cli
```

## Commands

| Command | What it does |
|---|---|
| `clq init <name>` | Scaffold a new MCP server project |
| `clq add <tool>` | Add a new tool file to the current project |
| `clq dev` | Start a hot-reload dev server (wraps `tsx watch`) |
| `clq inspect` | Launch a browser UI for testing tools live |
| `clq doctor` | Health check: config validation, deps, secret scan |

## Quick start

```sh
clq init my-server
cd my-server && pnpm install && pnpm build
clq inspect          # opens browser UI to test your tools
```

## What gets scaffolded

`clq init` produces a ready-to-run TypeScript MCP server:

```
my-server/
  src/
    index.ts         ← createServer + tool registration
    tools/           ← one file per tool
  clq.config.ts      ← env var declarations
  tsconfig.json
  package.json
```

---

For full documentation, guides, and the framework API → **[github.com/clq-sh/CLQ](https://github.com/clq-sh/CLQ)**

MIT License
