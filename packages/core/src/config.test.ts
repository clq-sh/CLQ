import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { defineConfig, loadConfig } from "./config.js"
import { ColloquialErrorImpl } from "./errors.js"

// Keys this suite manipulates; cleared before and after each test for isolation.
const TEST_KEYS = ["CLQ_API_KEY", "CLQ_PORT", "CLQ_DEBUG", "CLQ_SECRET"]

function clearKeys() {
  for (const key of TEST_KEYS) {
    delete process.env[key]
  }
}

beforeEach(clearKeys)
afterEach(clearKeys)

describe("defineConfig", () => {
  test("returns its input unchanged (identity)", () => {
    const cfg = { name: "svc", version: "1.0.0" }
    expect(defineConfig(cfg)).toBe(cfg)
  })
})

describe("loadConfig", () => {
  test("no env block returns an empty object", () => {
    expect(loadConfig({ name: "svc", version: "1.0.0" })).toEqual({})
  })

  test("required string var present is returned as a string", () => {
    process.env.CLQ_API_KEY = "abc123"
    const resolved = loadConfig({
      name: "svc",
      version: "1.0.0",
      env: { CLQ_API_KEY: { type: "string", description: "API key." } },
    })
    expect(resolved.CLQ_API_KEY).toBe("abc123")
    expect(typeof resolved.CLQ_API_KEY).toBe("string")
  })

  test("required var absent with no default throws CONFIG_MISSING_ENV_VAR", () => {
    let caught: unknown
    try {
      loadConfig({
        name: "svc",
        version: "1.0.0",
        env: {
          CLQ_API_KEY: {
            type: "string",
            description: "The upstream API key.",
          },
        },
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ColloquialErrorImpl)
    const e = caught as ColloquialErrorImpl
    expect(e.code).toBe("CONFIG_MISSING_ENV_VAR")
    expect(e.message).toContain("CLQ_API_KEY")
    expect(e.cause).toContain("The upstream API key.")
  })

  test("var absent but with a default returns the default at its declared type", () => {
    const resolved = loadConfig({
      name: "svc",
      version: "1.0.0",
      env: {
        CLQ_PORT: { type: "number", description: "Port.", default: 8080 },
        CLQ_DEBUG: { type: "boolean", description: "Debug.", default: false },
        CLQ_API_KEY: { type: "string", description: "Key.", default: "none" },
      },
    })
    expect(resolved.CLQ_PORT).toBe(8080)
    expect(typeof resolved.CLQ_PORT).toBe("number")
    expect(resolved.CLQ_DEBUG).toBe(false)
    expect(typeof resolved.CLQ_DEBUG).toBe("boolean")
    expect(resolved.CLQ_API_KEY).toBe("none")
  })

  test("number var with a non-numeric raw value throws mentioning 'expected a number'", () => {
    process.env.CLQ_PORT = "not-a-number"
    let caught: unknown
    try {
      loadConfig({
        name: "svc",
        version: "1.0.0",
        env: { CLQ_PORT: { type: "number", description: "Port." } },
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ColloquialErrorImpl)
    const e = caught as ColloquialErrorImpl
    expect(e.code).toBe("CONFIG_MISSING_ENV_VAR")
    expect(e.cause).toContain("expected a number")
  })

  test("number var with a valid raw value resolves to a number", () => {
    process.env.CLQ_PORT = "3000"
    const resolved = loadConfig({
      name: "svc",
      version: "1.0.0",
      env: { CLQ_PORT: { type: "number", description: "Port." } },
    })
    expect(resolved.CLQ_PORT).toBe(3000)
    expect(typeof resolved.CLQ_PORT).toBe("number")
  })

  test('boolean var with raw "true" resolves to literal boolean true', () => {
    process.env.CLQ_DEBUG = "true"
    const resolved = loadConfig({
      name: "svc",
      version: "1.0.0",
      env: { CLQ_DEBUG: { type: "boolean", description: "Debug." } },
    })
    expect(resolved.CLQ_DEBUG).toBe(true)
    expect(typeof resolved.CLQ_DEBUG).toBe("boolean")
  })

  test('boolean var with raw "1" is true, anything else is false', () => {
    process.env.CLQ_DEBUG = "1"
    expect(
      loadConfig({
        name: "svc",
        version: "1.0.0",
        env: { CLQ_DEBUG: { type: "boolean", description: "Debug." } },
      }).CLQ_DEBUG,
    ).toBe(true)

    process.env.CLQ_DEBUG = "yes"
    expect(
      loadConfig({
        name: "svc",
        version: "1.0.0",
        env: { CLQ_DEBUG: { type: "boolean", description: "Debug." } },
      }).CLQ_DEBUG,
    ).toBe(false)
  })

  test("a missing secret var error leaks no value and shows only its description", () => {
    let caught: unknown
    try {
      loadConfig({
        name: "svc",
        version: "1.0.0",
        env: {
          CLQ_SECRET: {
            type: "string",
            description: "Signing secret for tokens.",
            secret: true,
          },
        },
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ColloquialErrorImpl)
    const e = caught as ColloquialErrorImpl
    // The declared description is surfaced...
    expect(e.cause).toContain("Signing secret for tokens.")
    // ...and no field exposes a raw value or the literal word "secret: true" etc.
    for (const text of [e.message, e.cause ?? "", e.fix ?? ""]) {
      expect(text).not.toContain("[object Object]")
      expect(text).not.toContain("undefined")
    }
  })
})
