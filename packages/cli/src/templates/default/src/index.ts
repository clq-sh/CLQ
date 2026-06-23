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
server.start({ driver: "mcp", transport: "stdio" })
