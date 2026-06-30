/** A structured, serializable error surfaced by any part of the CLQ framework. */
export interface ColloquialError {
  code: string
  message: string
  cause?: string
  fix?: string
}

/** Per-request execution context threaded through tools, drivers, and middleware. */
export interface ColloquialContext {
  user?: { id: string; [key: string]: unknown }
  requestId: string
  timestamp: number
}

export interface ColloquialToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string
  description: string
  input: unknown
  output?: unknown
  requiresAuth?: boolean
  requiredScope?: string
  handler: (args: { input: TInput; ctx: ColloquialContext }) => Promise<TOutput>
}

/** A transport/runtime that exposes tools to the outside world (e.g. stdio, HTTP). */
export interface ColloquialDriver {
  name: string
  start: (config: ColloquialDriverStartConfig) => Promise<void>
  stop: () => Promise<void>
}

export interface ColloquialDriverStartConfig {
  tools: ColloquialToolDefinition[]
  [key: string]: unknown
}

export interface ColloquialServerConfig {
  name: string
  version: string
}

/** A hook pair that runs around tool execution for cross-cutting concerns. */
export interface ColloquialMiddleware {
  name: string
  before?: (ctx: ColloquialContext) => Promise<void>
  after?: (ctx: ColloquialContext, result: unknown) => Promise<void>
}
