import { errors } from "./errors.js"
import { startInspectReporter } from "./inspect.js"
import { createMCPStdioDriver } from "./protocol/mcp-stdio-driver.js"
import type {
  ColloquialContext,
  ColloquialDriver,
  ColloquialMiddleware,
  ColloquialServerConfig,
  ColloquialToolDefinition,
} from "./types.js"

type StartOptions = { driver?: "mcp" | "auto"; transport?: "stdio" }

/**
 * Wrap each tool's handler with registered middleware before/after hooks.
 * Returns the original array unchanged (same object references) when no
 * middleware is registered — this preserves object identity in tests and
 * avoids unnecessary allocation on the happy path.
 */
function applyMiddleware(
  tools: ColloquialToolDefinition[],
  middleware: ColloquialMiddleware[],
): ColloquialToolDefinition[] {
  if (middleware.length === 0) return tools
  return tools.map((tool) => ({
    ...tool,
    handler: async (args: { input: unknown; ctx: ColloquialContext }) => {
      for (const mw of middleware) {
        await mw.before?.(args.ctx)
      }
      const result = await tool.handler(args)
      for (const mw of [...middleware].reverse()) {
        try {
          await mw.after?.(args.ctx, result)
        } catch (err) {
          console.error(err)
        }
      }
      return result
    },
  }))
}

/**
 * Creates a chainable server. Middleware registered with .use() is executed
 * as before/after hooks around every tool call when the MCP driver is started.
 */
export function createServer(config: ColloquialServerConfig) {
  const tools: ColloquialToolDefinition[] = []
  const middleware: ColloquialMiddleware[] = []

  const api = {
    tool(def: ColloquialToolDefinition) {
      if (tools.some((t) => t.name === def.name)) {
        throw errors.duplicateTool(def.name)
      }
      tools.push(def)
      return api
    },
    use(mw: ColloquialMiddleware) {
      middleware.push(mw)
      return api
    },
    async start(options: StartOptions = {}): Promise<ColloquialDriver> {
      // CLQ_INSPECT_REPORT is set by `clq inspect` when it spawns the project process.
      // Report the tool list over stdio and skip the MCP server — the inspector parent
      // holds the only listener. User code never needs to know this env var exists.
      if (process.env.CLQ_INSPECT_REPORT) {
        startInspectReporter(tools)
        return {
          name: "inspect-reporter",
          start: async () => {},
          stop: async () => {},
        }
      }
      // CLQ_INSPECT alone (no report) means we're under the inspector but it only
      // needs the process alive, not the MCP server running.
      if (process.env.CLQ_INSPECT) {
        return {
          name: "inspect-idle",
          start: async () => {},
          stop: async () => {},
        }
      }
      const driverName =
        options.driver === "auto" || !options.driver ? "mcp" : options.driver
      if (driverName !== "mcp") {
        throw errors.unknownDriver(driverName)
      }
      const driver = createMCPStdioDriver({
        name: config.name,
        version: config.version,
      })
      await driver.start({ tools: applyMiddleware(tools, middleware) })
      return driver // returned so caller can call .stop() in tests
    },
  }
  return api
}
