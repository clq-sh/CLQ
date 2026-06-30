import { describe, expect, test } from "vitest"
import { z } from "zod"
import { ColloquialErrorImpl, errors } from "./errors.js"

/** Produces a genuine ZodError from a real failed parse — never mocked. */
function realZodError(issueCount: number): z.ZodError {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (let i = 0; i < issueCount; i++) {
    shape[`field${i}`] = z.string()
  }
  const result = z.object(shape).safeParse({})
  if (result.success) {
    throw new Error("expected parse to fail")
  }
  return result.error
}

const factories = {
  missingDescription: () => errors.missingDescription("getWeather"),
  invalidInput: () => errors.invalidInput("getWeather", realZodError(2)),
  invalidOutput: () => errors.invalidOutput("getWeather", realZodError(2)),
  toolNotFound: () => errors.toolNotFound("getWeather"),
  missingEnvVar: () => errors.missingEnvVar("API_KEY"),
  unauthorized: () => errors.unauthorized("getWeather", "weather:read"),
}

describe.each(Object.entries(factories))("errors.%s", (_name, make) => {
  const err = make()

  test("is an Error and a ColloquialErrorImpl", () => {
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(ColloquialErrorImpl)
  })

  test("name is ColloquialError", () => {
    expect(err.name).toBe("ColloquialError")
  })

  test("code matches /^[A-Z_]+$/", () => {
    expect(err.code).toMatch(/^[A-Z_]+$/)
  })

  test("code, message and fix are non-empty", () => {
    expect(err.code.length).toBeGreaterThan(0)
    expect(err.message.length).toBeGreaterThan(0)
    expect(err.fix).toBeTruthy()
    expect((err.fix ?? "").length).toBeGreaterThan(0)
  })

  test('no present field contains "undefined" or "[object Object]"', () => {
    for (const value of [err.code, err.message, err.cause, err.fix]) {
      if (value === undefined) continue
      expect(value).not.toContain("undefined")
      expect(value).not.toContain("[object Object]")
    }
  })
})

describe("formatZodIssues (via invalidInput.cause)", () => {
  test("renders a real single-issue ZodError readably", () => {
    const cause = errors.invalidInput("t", realZodError(1)).cause ?? ""
    expect(cause).toContain("field0")
    expect(cause).not.toContain("undefined")
    expect(cause).not.toContain("[object Object]")
    expect(cause).not.toContain("...and")
  })

  test("caps at 3 issues and reports the remainder", () => {
    const cause = errors.invalidInput("t", realZodError(6)).cause ?? ""
    expect(cause).toContain("...and 3 more")
    expect((cause.match(/field\d/g) ?? []).length).toBe(3)
    expect(cause).not.toContain("undefined")
    expect(cause).not.toContain("[object Object]")
  })

  test('handles a top-level issue with empty path without "undefined"', () => {
    const result = z.string().safeParse(123)
    expect(result.success).toBe(false)
    if (result.success) return
    const cause = errors.invalidInput("t", result.error).cause ?? ""
    expect(cause.length).toBeGreaterThan(0)
    expect(cause).not.toContain("undefined")
    expect(cause).not.toContain("[object Object]")
  })
})

describe("optional-argument branches", () => {
  test("missingEnvVar falls back to default cause", () => {
    expect(errors.missingEnvVar("API_KEY").cause).toBe(
      "This variable is required by clq.config.ts",
    )
    expect(errors.missingEnvVar("API_KEY", "Needed for X").cause).toBe(
      "Needed for X",
    )
  })

  test("unauthorized cause reflects presence of scope", () => {
    expect(errors.unauthorized("t").cause).toBe(
      "This tool requires authentication.",
    )
    expect(errors.unauthorized("t", "admin").cause).toContain("scope 'admin'")
  })
})
