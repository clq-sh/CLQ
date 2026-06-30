import { createServer, defineTool } from "@clq-sh/core"
import { z } from "zod"

const getWeather = defineTool({
  name: "get_weather",
  description:
    "Get current weather for a city. Returns temperature in Celsius and a short condition.",
  input: z.object({
    city: z.string().describe("City name, e.g. 'London' or 'Addis Ababa'"),
  }),
  output: z.object({
    temperature: z.number().describe("Temperature in Celsius"),
    condition: z.string().describe("Weather condition, e.g. 'sunny' or 'cloudy'"),
  }),
  handler: async ({ input }) => {
    // Replace with a real API call:
    // const res = await fetch(`https://your-weather-api.io/current?city=${encodeURIComponent(input.city)}`)
    // const data = await res.json() as { temp_c: number; description: string }
    // return { temperature: data.temp_c, condition: data.description }
    return { temperature: 22, condition: "sunny" }
  },
})

const server = createServer({ name: "{{projectName}}", version: "0.1.0" })
server.tool(getWeather)
server.start()
