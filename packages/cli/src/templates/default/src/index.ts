import { createServer, defineTool } from "@clq-sh/core"
import { z } from "zod"

const echo = defineTool({
  name: "echo",
  description: "Echo a message back to the caller.",
  input: z.object({ message: z.string() }),
  output: z.object({ echoed: z.string() }),
  handler: async ({ input }) => ({ echoed: input.message }),
})

// Export the same tool set passed to server.tool(). `clq inspect` imports { tools }
// (with CLQ_INSPECT set so the stdio driver below never starts) to introspect and call
// tools without launching a real MCP server.
export const tools = [echo]

const server = createServer({ name: "{{projectName}}", version: "0.1.0" })
for (const tool of tools) server.tool(tool)

// When spawned by `clq inspect`, report the tools to the inspector over stdio instead
// of starting the MCP server.
if (process.env.CLQ_INSPECT_REPORT) {
  import("@clq-sh/core/inspect").then(({ startInspectReporter }) => {
    startInspectReporter(tools)
  })
}

// Normal run: start the stdio MCP server. Skipped under inspection.
if (!process.env.CLQ_INSPECT) {
  server.start({ driver: "mcp", transport: "stdio" })
}
