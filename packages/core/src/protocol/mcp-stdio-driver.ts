import { randomUUID } from "node:crypto"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import type {
  ColloquialContext,
  ColloquialDriver,
  ColloquialToolDefinition,
} from "../types.js"
import { buildToolsList, dispatchToolCall } from "./translate.js"

/**
 * The first ColloquialDriver: serves CLQ tools over MCP via stdio using the official SDK.
 * All protocol meaning is delegated to the pure Stage 4 functions; this file only owns I/O.
 */
export function createMCPStdioDriver(serverInfo: {
  name: string
  version: string
}): ColloquialDriver {
  let server: Server | undefined
  let transport: StdioServerTransport | undefined

  return {
    name: "mcp-stdio",
    async start(config) {
      server = new Server(serverInfo, { capabilities: { tools: {} } })

      server.setRequestHandler(ListToolsRequestSchema, async () => {
        return buildToolsList(config.tools as ColloquialToolDefinition[])
      })

      server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const ctx: ColloquialContext = {
          requestId: randomUUID(),
          timestamp: Date.now(),
        }
        return dispatchToolCall(
          config.tools as ColloquialToolDefinition[],
          request.params.name,
          request.params.arguments,
          ctx,
        )
      })

      transport = new StdioServerTransport()
      await server.connect(transport)
    },
    async stop() {
      await transport?.close()
    },
  }
}
