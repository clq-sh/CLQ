import { errors } from "./errors.js"

type EnvVarDeclaration = {
  type: "string" | "number" | "boolean"
  description: string
  secret?: boolean
  default?: string | number | boolean
}

type CLQConfigInput = {
  name: string
  version: string
  env?: Record<string, EnvVarDeclaration>
}

/**
 * Identity function at runtime — env loading is deferred to loadConfig() because
 * process.env is only meaningful at server-start time, not at module import time.
 */
export function defineConfig(config: CLQConfigInput): CLQConfigInput {
  return config
}

/**
 * Reads and coerces declared env vars from process.env at server-start time.
 * Throws CONFIG_MISSING_ENV_VAR for any required var that is absent or unparseable,
 * so misconfiguration fails loudly up front rather than mid-request.
 */
export function loadConfig(
  config: CLQConfigInput,
): Record<string, string | number | boolean> {
  const resolved: Record<string, string | number | boolean> = {}
  for (const [key, decl] of Object.entries(config.env ?? {})) {
    const raw = process.env[key]
    if (raw === undefined) {
      if (decl.default !== undefined) {
        resolved[key] = decl.default
        continue
      }
      throw errors.missingEnvVar(key, decl.description)
    }
    if (decl.type === "number") {
      const n = Number(raw)
      if (Number.isNaN(n)) {
        throw errors.missingEnvVar(
          key,
          `${decl.description} (expected a number, got "${raw}")`,
        )
      }
      resolved[key] = n
    } else if (decl.type === "boolean") {
      resolved[key] = raw === "true" || raw === "1"
    } else {
      resolved[key] = raw
    }
  }
  return resolved
}
