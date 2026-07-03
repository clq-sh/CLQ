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

  test("number type-mismatch error never includes the raw value — even a secret-shaped one (Finding 1 regression)", () => {
    // Reproduces qa-report/REPORT.md Finding 1 exactly:
    // a secret-shaped value set for a number-typed var must never appear in any error field.
    const SECRET_VALUE = "sk-REAL-SECRET-12345678"
    process.env.CLQ_PORT = SECRET_VALUE
    let caught: unknown
    try {
      loadConfig({
        name: "svc",
        version: "1.0.0",
        env: { CLQ_PORT: { type: "number", description: "Port number." } },
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ColloquialErrorImpl)
    const e = caught as ColloquialErrorImpl
    expect(e.code).toBe("CONFIG_MISSING_ENV_VAR")
    // Must still be actionable: names the var and expected type.
    expect(e.message).toContain("CLQ_PORT")
    expect(e.cause).toContain("expected a number")
    // The raw secret value must NEVER appear in any error field.
    for (const text of [e.message, e.cause ?? "", e.fix ?? ""]) {
      expect(text).not.toContain(SECRET_VALUE)
    }
    // Length info is safe to include for non-secret vars, so check it's there.
    expect(e.cause).toContain(`length ${SECRET_VALUE.length}`)
  })

  test("secret:true on a number var omits even the string length from the error (Finding 3)", () => {
    // When a var is explicitly marked secret: true, no shape or length info should
    // appear — only the expected type. This prevents fingerprinting via length.
    const SECRET_VALUE = "sk-ABCDE-12345"
    process.env.CLQ_SECRET = SECRET_VALUE
    let caught: unknown
    try {
      loadConfig({
        name: "svc",
        version: "1.0.0",
        env: {
          CLQ_SECRET: {
            type: "number",
            description: "Secret numeric config.",
            secret: true,
          },
        },
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ColloquialErrorImpl)
    const e = caught as ColloquialErrorImpl
    expect(e.cause).toContain("expected a number")
    // Neither the raw value nor any length info should be in any field.
    for (const text of [e.message, e.cause ?? "", e.fix ?? ""]) {
      expect(text).not.toContain(SECRET_VALUE)
      expect(text).not.toContain(`length`)
    }
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
    expect(e.cause).toContain("Signing secret for tokens.")
    for (const text of [e.message, e.cause ?? "", e.fix ?? ""]) {
      expect(text).not.toContain("[object Object]")
      expect(text).not.toContain("undefined")
    }
  })
})
