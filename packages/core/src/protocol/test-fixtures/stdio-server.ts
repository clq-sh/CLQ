import { z } from "zod"
import { defineTool } from "../../tool.js"
import { createMCPStdioDriver } from "../mcp-stdio-driver.js"

const echo = defineTool({
  name: "echo",
  description: "Echo a string back to the caller.",
  input: z.object({ message: z.string() }),
  handler: async ({ input }) => ({ echoed: input.message }),
})

const add = defineTool({
  name: "add",
  description: "Add two numbers and return their sum.",
  input: z.object({ a: z.number(), b: z.number() }),
  handler: async ({ input }) => ({ sum: input.a + input.b }),
})

const driver = createMCPStdioDriver({
  name: "clq-stdio-fixture",
  version: "0.0.0",
})

// No top-level await — keeps both the ESM and CJS tsup builds valid.
// The stdio transport keeps the event loop alive once started.
driver.start({ tools: [echo, add] }).catch((err) => {
  console.error(err)
  process.exit(1)
})
