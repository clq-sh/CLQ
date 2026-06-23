import { createServer, defineTool } from "@clq-sh/core"
import { z } from "zod"

/** Deterministic fake weather data so the example is reproducible without a network call. */
const WEATHER: Record<string, { temperature: number; condition: string }> = {
  "Addis Ababa": { temperature: 22, condition: "sunny" },
  London: { temperature: 14, condition: "cloudy" },
}

const SUPPORTED_CITIES = Object.keys(WEATHER)

const getWeatherTool = defineTool({
  name: "get_weather",
  description: "Get the current weather for a city.",
  input: z.object({ location: z.string().describe("City name") }),
  output: z.object({ temperature: z.number(), condition: z.string() }),
  handler: async ({ input }) => {
    return WEATHER[input.location] ?? { temperature: 18, condition: "clear" }
  },
})

const listCitiesTool = defineTool({
  name: "list_supported_cities",
  description: "List the cities this server has weather data for.",
  input: z.object({}),
  output: z.object({ cities: z.array(z.string()) }),
  handler: async () => ({ cities: SUPPORTED_CITIES }),
})

const convertTempTool = defineTool({
  name: "convert_temperature",
  description: "Convert a temperature from Celsius to Fahrenheit.",
  input: z.object({ celsius: z.number() }),
  output: z.object({ fahrenheit: z.number() }),
  handler: async ({ input }) => ({ fahrenheit: (input.celsius * 9) / 5 + 32 }),
})

const server = createServer({ name: "weather-server", version: "1.0.0" })
server.tool(getWeatherTool).tool(listCitiesTool).tool(convertTempTool)
server.start({ driver: "mcp", transport: "stdio" })
