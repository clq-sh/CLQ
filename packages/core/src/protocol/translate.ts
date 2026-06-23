import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ColloquialErrorImpl, errors } from '../errors.js';
import type { ColloquialContext, ColloquialToolDefinition } from '../types.js';

/** Convert a single CLQ tool into its MCP tool descriptor (name + description + JSON Schema). */
export function toolToMCPSchema(tool: ColloquialToolDefinition): {
  name: string;
  description: string;
  inputSchema: object;
} {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: zodToJsonSchema(tool.input as ZodTypeAny),
  };
}

/** Build the MCP `tools/list` response payload from a set of CLQ tools. */
export function buildToolsList(tools: ColloquialToolDefinition[]): {
  tools: ReturnType<typeof toolToMCPSchema>[];
} {
  return { tools: tools.map(toolToMCPSchema) };
}

/** The MCP `tools/call` result shape: a text content block, optionally flagged as an error. */
export type MCPCallResult =
  | { content: [{ type: 'text'; text: string }] }
  | { isError: true; content: [{ type: 'text'; text: string }] };

/** Look up a tool by name, invoke its (already-validating) handler, and map the outcome to MCP wire format. */
export async function dispatchToolCall(
  tools: ColloquialToolDefinition[],
  name: string,
  rawArgs: unknown,
  ctx: ColloquialContext,
): Promise<MCPCallResult> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    return {
      isError: true,
      content: [{ type: 'text', text: errors.toolNotFound(name).message }],
    };
  }

  try {
    const result = await tool.handler({ input: rawArgs, ctx });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (err) {
    if (err instanceof ColloquialErrorImpl) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
    throw err;
  }
}
