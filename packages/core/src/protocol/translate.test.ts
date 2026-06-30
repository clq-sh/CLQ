import { describe, expect, test } from "vitest"
import { z } from "zod"
import { ColloquialErrorImpl } from "../errors.js"
import { defineTool } from "../tool.js"
import type { ColloquialContext } from "../types.js"
import {
  buildToolsList,
  dispatchToolCall,
  toolToMCPSchema,
} from "./translate.js"

const ctx: ColloquialContext = { requestId: "req-1", timestamp: 0 }

const weatherTool = defineTool({
  name: "getWeather",
  description: "Get the weather for a location.",
  input: z.object({ location: z.string() }),
  handler: async ({ input }) => ({ forecast: `sunny in ${input.location}` }),
})

const echoTool = defineTool({
  name: "echo",
  description: "Echo a message back.",
  input: z.object({ message: z.string() }),
  handler: async ({ input }) => input.message,
})

describe("toolToMCPSchema", () => {
  test("produces a JSON schema with typed properties and required fields", () => {
    const schema = toolToMCPSchema(weatherTool)
    expect(schema.name).toBe("getWeather")
    expect(schema.description).toBe("Get the weather for a location.")

    const inputSchema = schema.inputSchema as {
      properties: { location: { type: string } }
      required: string[]
    }
    expect(inputSchema.properties.location.type).toBe("string")
    expect(inputSchema.required).toContain("location")
  })
})

describe("buildToolsList", () => {
  test("maps every tool and preserves names", () => {
    const list = buildToolsList([weatherTool, echoTool])
    expect(list.tools).toHaveLength(2)
    expect(list.tools.map((t) => t.name)).toEqual(["getWeather", "echo"])
  })
})

describe("dispatchToolCall", () => {
  test("valid args return a success content block", async () => {
    const result = await dispatchToolCall(
      [weatherTool],
      "getWeather",
      { location: "Paris" },
      ctx,
    )
    expect(result).not.toHaveProperty("isError")
    expect(result.content[0].type).toBe("text")
    expect(JSON.parse(result.content[0].text)).toEqual({
      forecast: "sunny in Paris",
    })
  })

  test("unknown tool name returns isError with toolNotFound message", async () => {
    const result = await dispatchToolCall([weatherTool], "nope", {}, ctx)
    expect(result).toMatchObject({ isError: true })
    expect(result.content[0].text).toContain(
      "Tool 'nope' is not registered on this server.",
    )
    expect(result.content[0].text).toContain("Fix:")
  })

  test("invalid args against a real tool surface TOOL_INVALID_INPUT", async () => {
    const result = await dispatchToolCall(
      [weatherTool],
      "getWeather",
      { location: 123 },
      ctx,
    )
    expect(result).toMatchObject({ isError: true })
    expect(result.content[0].text).toContain(
      "Tool 'getWeather' received invalid input.",
    )
    expect(result.content[0].text).toContain("Cause:")
    expect(result.content[0].text).toContain("Fix:")
  })

  test("ColloquialErrorImpl with cause and fix surfaces all fields in error text", async () => {
    const richTool = defineTool({
      name: "rich",
      description: "Throws a rich error.",
      input: z.object({}),
      handler: async () => {
        throw new ColloquialErrorImpl({
          code: "TEST_ERROR",
          message: "Something went wrong.",
          cause: "The database was unavailable.",
          fix: "Check your connection string.",
        })
      },
    })
    const result = await dispatchToolCall([richTool], "rich", {}, ctx)
    expect(result).toMatchObject({ isError: true })
    expect(result.content[0].text).toContain("Something went wrong.")
    expect(result.content[0].text).toContain(
      "Cause: The database was unavailable.",
    )
    expect(result.content[0].text).toContain(
      "Fix: Check your connection string.",
    )
  })

  test("ColloquialErrorImpl with only message does not emit Cause or Fix lines", async () => {
    const simpleTool = defineTool({
      name: "simple",
      description: "Throws a simple error with only a message.",
      input: z.object({}),
      handler: async () => {
        throw new ColloquialErrorImpl({
          code: "TEST_SIMPLE",
          message: "Just the message.",
        })
      },
    })
    const result = await dispatchToolCall([simpleTool], "simple", {}, ctx)
    expect(result).toMatchObject({ isError: true })
    expect(result.content[0].text).toBe("Just the message.")
    expect(result.content[0].text).not.toContain("Cause:")
    expect(result.content[0].text).not.toContain("Fix:")
  })

  test("non-ColloquialError thrown by a handler is rethrown, not swallowed", async () => {
    const boomTool = defineTool({
      name: "boom",
      description: "Throws an unexpected error.",
      input: z.object({}),
      handler: async () => {
        throw new TypeError("kaboom")
      },
    })
    await expect(dispatchToolCall([boomTool], "boom", {}, ctx)).rejects.toThrow(
      "kaboom",
    )
  })
})
