import type { ZodTypeAny } from "zod"
import { zodToJsonSchema } from "zod-to-json-schema"
import { ColloquialErrorImpl, errors } from "../errors.js"
import type { ColloquialContext, ColloquialToolDefinition } from "../types.js"

export function toolToMCPSchema(tool: ColloquialToolDefinition): {
  name: string
  description: string
  inputSchema: object
} {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: zodToJsonSchema(tool.input as ZodTypeAny),
  }
}

export function buildToolsList(tools: ColloquialToolDefinition[]): {
  tools: ReturnType<typeof toolToMCPSchema>[]
} {
  return { tools: tools.map(toolToMCPSchema) }
}

export type MCPCallResult =
  | { content: [{ type: "text"; text: string }] }
  | { isError: true; content: [{ type: "text"; text: string }] }

export async function dispatchToolCall(
  tools: ColloquialToolDefinition[],
  name: string,
  rawArgs: unknown,
  ctx: ColloquialContext,
): Promise<MCPCallResult> {
  const tool = tools.find((t) => t.name === name)
  if (!tool) {
    const notFound = errors.toolNotFound(name)
    const parts: string[] = [notFound.message]
    if (notFound.cause) parts.push(`Cause: ${notFound.cause}`)
    if (notFound.fix) parts.push(`Fix: ${notFound.fix}`)
    return {
      isError: true,
      content: [{ type: "text", text: parts.join("\n") }],
    }
  }

  try {
    const result = await tool.handler({ input: rawArgs, ctx })
    return { content: [{ type: "text", text: JSON.stringify(result) }] }
  } catch (err) {
    if (err instanceof ColloquialErrorImpl) {
      const parts: string[] = [err.message]
      if (err.cause) parts.push(`Cause: ${err.cause}`)
      if (err.fix) parts.push(`Fix: ${err.fix}`)
      return {
        isError: true,
        content: [{ type: "text", text: parts.join("\n") }],
      }
    }
    throw err
  }
}
