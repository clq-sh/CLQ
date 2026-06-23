import { errors } from "./errors.js"
import { createMCPStdioDriver } from "./protocol/mcp-stdio-driver.js"
import type {
  ColloquialDriver,
  ColloquialMiddleware,
  ColloquialServerConfig,
  ColloquialToolDefinition,
} from "./types.js"

/** Options for starting a server: which driver and transport to use. */
type StartOptions = { driver?: "mcp" | "auto"; transport?: "stdio" }

/**
 * Creates a chainable server: register tools with .tool(), middleware with .use(),
 * then .start() to serve them over a driver. Middleware is reserved here but not yet
 * executed — execution is Phase 3 scope.
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
      const driverName =
        options.driver === "auto" || !options.driver ? "mcp" : options.driver
      if (driverName !== "mcp") {
        throw errors.unknownDriver(driverName)
      }
      const driver = createMCPStdioDriver({
        name: config.name,
        version: config.version,
      })
      await driver.start({ tools })
      return driver // returned so caller can call .stop() in tests
    },
  }
  return api
}
