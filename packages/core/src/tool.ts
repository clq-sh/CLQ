import type { ZodTypeAny, z } from "zod"
import { errors } from "./errors.js"
import type { ColloquialContext, ColloquialToolDefinition } from "./types.js"

export function defineTool<
  TInputSchema extends ZodTypeAny,
  TOutputSchema extends ZodTypeAny | undefined = undefined,
>(config: {
  name: string
  description: string
  input: TInputSchema
  output?: TOutputSchema
  requiresAuth?: boolean
  requiredScope?: string
  handler: (args: {
    input: z.infer<TInputSchema>
    ctx: ColloquialContext
  }) => Promise<
    TOutputSchema extends ZodTypeAny ? z.infer<TOutputSchema> : unknown
  >
}): ColloquialToolDefinition {
  if (!config.description?.trim()) {
    throw errors.missingDescription(config.name)
  }

  const wrappedHandler = async (args: {
    input: unknown
    ctx: ColloquialContext
  }): Promise<unknown> => {
    const inputResult = config.input.safeParse(args.input)
    if (!inputResult.success) {
      throw errors.invalidInput(config.name, inputResult.error)
    }

    const handlerReturn = await config.handler({
      input: inputResult.data,
      ctx: args.ctx,
    })

    if (config.output) {
      const outputResult = config.output.safeParse(handlerReturn)
      if (!outputResult.success) {
        throw errors.invalidOutput(config.name, outputResult.error)
      }
      return outputResult.data
    }

    return handlerReturn
  }

  return {
    name: config.name,
    description: config.description,
    input: config.input,
    output: config.output,
    requiresAuth: config.requiresAuth,
    requiredScope: config.requiredScope,
    handler: wrappedHandler,
  }
}
