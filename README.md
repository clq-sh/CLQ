# CLQ — build MCP servers without reading the spec.

[![npm](https://img.shields.io/npm/v/@clq-sh/cli?color=0f0f0f&label=clq&style=flat-square)](https://www.npmjs.com/package/@clq-sh/cli) [![license](https://img.shields.io/github/license/clq-sh/CLQ?color=0f0f0f&style=flat-square)](LICENSE) [![MCP](https://img.shields.io/badge/MCP-ready-0f0f0f?style=flat-square)](https://modelcontextprotocol.io)

```typescript
import { createServer, defineTool } from "@clq-sh/core"
import { z } from "zod"
const getWeather = defineTool({
  name: "get_weather", description: "Get current weather for a city.",
  input: z.object({ city: z.string() }),
  handler: async ({ input }) => ({ temperature: 22, condition: "sunny" }),
})
createServer({ name: "my-server", version: "1.0.0" }).tool(getWeather).start()
```

That's a working MCP server. CLQ handles the protocol, transport, validation, and error formatting — you write the tools.

---

## Install

```sh
npm install -g @clq-sh/cli
clq init my-server
cd my-server && pnpm install && pnpm build
clq inspect
```

Opens a browser UI to test your tools.

---

## What is MCP?

MCP is the protocol that lets AI assistants like Claude call external tools — APIs, databases, scripts, anything. It is the standard wire interface between agents and the services they act on. [Learn more →](https://modelcontextprotocol.io)

---

## Core API

### `defineTool`

Defines a typed, named tool with Zod input/output schemas and an async handler. The `output` schema is optional but recommended: it lets agents trust tool responses without re-validating, cutting tokens and tightening feedback loops.

```typescript
const getWeather = defineTool({
  name: "get_weather",
  description: "Get current weather for a city.",
  input: z.object({ city: z.string().describe("City name") }),
  output: z.object({ temperature: z.number(), condition: z.string() }),
  handler: async ({ input }) => {
    const data = await fetchWeatherApi(input.city)
    return { temperature: data.temp_c, condition: data.description }
  },
})
```

Both boundaries are validated: input is checked before the handler runs; output is checked before the result leaves the framework. A schema mismatch throws a structured `CLQError` — never a raw crash.

### `createServer`

Registers tools; handles the rest.

```typescript
const server = createServer({ name: "my-server", version: "1.0.0" })
server.tool(getWeather).tool(listCities)
server.start()
```

### `defineConfig`

Declares required environment variables — missing vars fail loudly at startup, never silently mid-request.

```typescript
// clq.config.ts
import { defineConfig } from "@clq-sh/core"

export default defineConfig({
  name: "my-server",
  version: "1.0.0",
  env: {
    GITHUB_TOKEN: {
      type: "string",
      description: "GitHub personal access token",
      secret: true,
    },
  },
})
```

---

## CLI

| Command | What it does |
|---|---|
| `clq init <name>` | Scaffold a new MCP server |
| `clq add <tool>` | Add a new tool file |
| `clq dev` | Hot-reload dev server |
| `clq inspect` | Browser UI for testing tools |
| `clq doctor` | Health check + secret scan |

---

## Connect to Claude Desktop

Add this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["<absolute-path>/my-server/dist/index.js"]
    }
  }
}
```

Restart Claude Desktop after editing the config.

---

## Security & Quality

CLQ underwent a real security audit before the v0.2.0 release. Two confirmed findings were identified and fixed: a **credential leak in `clq doctor`** (a secret env var's raw value appeared in stdout on type mismatch) and a **redaction bypass in `clq inspect`** (the inspector's response sanitizer missed common naming conventions like `authorization`, `bearer`, `jwt`, and `private_key`, allowing tool handlers to leak credentials through the inspector UI). A subsequent word-boundary fix introduced a camelCase regression that was then caught and corrected. The full disclosed trail — original report, fix records, and final verification pass — is in [`qa-report/`](qa-report/README.md). The suite currently passes **211 tests** across 18 test files.

---

MIT — see [LICENSE](LICENSE).
