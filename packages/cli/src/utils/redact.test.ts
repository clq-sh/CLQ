/**
 * Unit tests for redactSecrets() covering all field names added in
 * qa-report/REPORT.md Finding 2 fix.
 */
import { describe, expect, test } from "vitest"
import { redactSecrets } from "./redact.js"

const LEAK_VALUE = "SHOULD-NOT-APPEAR-IN-OUTPUT"

describe("redactSecrets — original patterns still redacted", () => {
  for (const key of [
    "secret",
    "token",
    "password",
    "apiKey",
    "api_key",
    "API_KEY",
    "TOKEN",
  ]) {
    test(`redacts key "${key}"`, () => {
      const result = redactSecrets({ [key]: LEAK_VALUE }) as Record<
        string,
        unknown
      >
      expect(result[key]).toBe("[REDACTED]")
      expect(JSON.stringify(result)).not.toContain(LEAK_VALUE)
    })
  }
})

describe("redactSecrets — new patterns from Finding 2 are now redacted", () => {
  // Each entry: [keyName, description]
  const newlyCoveredKeys: [string, string][] = [
    ["authorization", "HTTP Authorization header value"],
    ["Authorization", "HTTP Authorization header (title-case)"],
    ["credential", "singular credential"],
    ["credentials", "plural credentials"],
    ["private_key", "private key with underscore"],
    ["privateKey", "private key camelCase"],
    ["access_key", "access key with underscore"],
    ["accessKey", "access key camelCase"],
    ["signing_key", "signing key with underscore"],
    ["signingKey", "signing key camelCase"],
    ["bearer", "bearer token value"],
    ["jwt", "JSON Web Token"],
    ["passphrase", "passphrase"],
    ["client_secret", "OAuth client secret with underscore"],
    ["clientSecret", "OAuth client secret camelCase"],
    ["refresh_token", "OAuth refresh token with underscore"],
    ["refreshToken", "OAuth refresh token camelCase"],
    ["session_id", "session identifier with underscore"],
    ["sessionId", "session identifier camelCase"],
    ["cookie", "HTTP cookie value"],
  ]

  for (const [key, description] of newlyCoveredKeys) {
    test(`redacts key "${key}" (${description})`, () => {
      const result = redactSecrets({ [key]: LEAK_VALUE }) as Record<
        string,
        unknown
      >
      expect(result[key], `key "${key}" must be "[REDACTED]"`).toBe(
        "[REDACTED]",
      )
      expect(
        JSON.stringify(result),
        `raw value must not appear in serialized result for key "${key}"`,
      ).not.toContain(LEAK_VALUE)
    })
  }
})

describe("redactSecrets — non-secret keys still pass through", () => {
  for (const key of [
    "name",
    "status",
    "ok",
    "count",
    "url",
    "timestamp",
    "userId",
  ]) {
    test(`does not redact key "${key}"`, () => {
      const val = "non-secret-value"
      const result = redactSecrets({ [key]: val }) as Record<string, unknown>
      expect(result[key]).toBe(val)
    })
  }
})

describe("redactSecrets — word-boundary anchoring: false positives are NOT redacted (FIXD)", () => {
  // These keys were incorrectly redacted before word-boundary anchoring.
  // They must pass through unchanged — including their original type.
  const falsePositiveKeys: [string, unknown][] = [
    ["cookieCount", 42],
    ["acceptedCookies", true],
    ["cookieBannerVisible", false],
    ["hasCookies", true],
    ["cookiePolicy", "strict"],
    ["tokenCount", 1000],
    ["jwtAlgorithm", "HS256"],
    ["jwtClaims", { sub: "u123" }],
    ["credentialType", "oauth2"],
    ["authorizationLevel", 3],
    ["parentSessionId", "sess-abc"],
  ]

  for (const [key, val] of falsePositiveKeys) {
    test(`does NOT redact key "${key}" (non-secret compound)`, () => {
      const result = redactSecrets({ [key]: val }) as Record<string, unknown>
      expect(result[key], `"${key}" must not be redacted`).toStrictEqual(val)
      expect(result[key]).not.toBe("[REDACTED]")
    })
  }
})

describe("redactSecrets — word-boundary anchoring: bare secret terms still redacted (FIXD)", () => {
  // Confirm that introducing word boundaries did not drop any true-positive
  // cases — especially the boundary-sensitive ones.
  const boundarySensitiveKeys: [string, string][] = [
    ["cookie", "session-cookie-value"],
    ["token", "bearer-token-value"],
    ["jwt", "eyJhbGciOiJIUzI1NiJ9.payload.sig"],
    ["sessionId", "sess-abc-123"],
    ["session_id", "sess-abc-123"],
    ["apiKey", "ak-12345"],
    ["api_key", "ak-12345"],
    //["tokenCount", "SHOULD-NOT-REACH-THIS-ASSERTION"], // excluded — should NOT redact
    //["jwtAlgorithm", "SHOULD-NOT-REACH-THIS-ASSERTION"], // excluded — should NOT redact
  ]
  
  for (const [key, val] of boundarySensitiveKeys) {
    test(`still redacts key "${key}" (true secret term)`, () => {
      const result = redactSecrets({ [key]: val }) as Record<string, unknown>
      expect(result[key], `"${key}" must be "[REDACTED]"`).toBe("[REDACTED]")
    })
  }
})

describe("redactSecrets — prefixed compounds MUST be redacted (FIXD2 regression)", () => {
  // These keys have a non-secret prefix word followed by a secret compound or
  // term. The \b word-boundary approach (FIXD) broke these because \b treats
  // the camelCase transition as a non-boundary (both sides are \w chars).
  const prefixedCompoundKeys: [string, string][] = [
    ["userApiKey", "user's API key"],
    ["user_api_key", "user's API key, snake_case"],
    ["clientAccessToken", "client access token"],
    ["client_access_token", "client access token, snake_case"],
    ["myAuthorization", "authorization field with prefix"],
    ["requestJwt", "JWT field with prefix"],
    ["someClientSecret", "OAuth client secret with prefix"],
    ["parentAccessKey", "access key belonging to a parent"],
    ["nested_private_key", "private key nested under another key"],
    ["userBearerToken", "bearer token for a user"],
  ]

  for (const [key, description] of prefixedCompoundKeys) {
    test(`redacts prefixed compound key "${key}" (${description})`, () => {
      const result = redactSecrets({ [key]: LEAK_VALUE }) as Record<
        string,
        unknown
      >
      expect(result[key], `key "${key}" must be "[REDACTED]"`).toBe(
        "[REDACTED]",
      )
      expect(JSON.stringify(result)).not.toContain(LEAK_VALUE)
    })
  }
})

describe("redactSecrets — structural behavior", () => {
  test("recurses into nested objects", () => {
    const input = {
      ok: true,
      auth: {
        bearer: "real-token",
        userId: "u123",
      },
    }
    const result = redactSecrets(input) as typeof input
    expect((result.auth as Record<string, unknown>).bearer).toBe("[REDACTED]")
    expect((result.auth as Record<string, unknown>).userId).toBe("u123")
  })

  test("recurses into arrays", () => {
    const input = [{ authorization: "Bearer sk-..." }, { name: "ok" }]
    const result = redactSecrets(input) as typeof input
    expect((result[0] as Record<string, unknown>).authorization).toBe(
      "[REDACTED]",
    )
    expect((result[1] as Record<string, unknown>).name).toBe("ok")
  })

  test("passes through primitives unchanged", () => {
    expect(redactSecrets("hello")).toBe("hello")
    expect(redactSecrets(42)).toBe(42)
    expect(redactSecrets(true)).toBe(true)
    expect(redactSecrets(null)).toBe(null)
  })
})
