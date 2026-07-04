# @clq-sh/core

The framework layer for CLQ — define typed MCP tools, create servers, and declare environment config, without touching the MCP wire protocol.

```typescript
import { createServer, defineTool } from "@clq-sh/core"
import { z } from "zod"

const getWeather = defineTool({
  name: "get_weather",
  description: "Get current weather for a city.",
  input: z.object({ city: z.string() }),
  output: z.object({ temperature: z.number(), condition: z.string() }),
  handler: async ({ input }) => ({ temperature: 22, condition: "sunny" }),
})

createServer({ name: "my-server", version: "1.0.0" }).tool(getWeather).start()
```

## API

**`defineTool(config)`** — defines a named tool with Zod input/output schemas and an async handler. Both boundaries are validated: input before the handler runs, output before the result leaves the framework.

**`createServer(config)`** — chainable server builder. `.tool()` registers tools, `.use()` registers middleware, `.start()` launches the MCP stdio transport.

**`defineConfig(config)`** — declares required environment variables with types and descriptions. Missing or mistyped vars throw at startup, never silently mid-request.

## Install

This package is the framework core. For the full developer experience including the `clq` CLI, install [`@clq-sh/cli`](https://www.npmjs.com/package/@clq-sh/cli):

```sh
npm install -g @clq-sh/cli
clq init my-server
```

Or install `@clq-sh/core` directly if you only need the framework API:

```sh
npm install @clq-sh/core
```

---

For full documentation, guides, and CLI reference → **[github.com/clq-sh/CLQ](https://github.com/clq-sh/CLQ)**

MIT License
