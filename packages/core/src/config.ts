import { errors } from "./errors.js"

/** Declares one expected environment variable: its type, docs, and optional default/secret flag. */
type EnvVarDeclaration = {
  type: "string" | "number" | "boolean"
  description: string
  secret?: boolean
  default?: string | number | boolean
}

/** The shape a colloquial.config.ts file exports: identity, version, and declared env vars. */
type ColloquialConfigInput = {
  name: string
  version: string
  env?: Record<string, EnvVarDeclaration>
}

/**
 * Declares a config with full TypeScript checking of its shape. This is an identity
 * function at runtime — env LOADING is deferred to loadConfig() because process.env is
 * only meaningful at server-start time, not when the config module is first imported.
 */
export function defineConfig(
  config: ColloquialConfigInput,
): ColloquialConfigInput {
  return config
}

/**
 * Reads and coerces declared env vars from process.env at server-start time. Throws a
 * CONFIG_MISSING_ENV_VAR error for any required var that is absent or fails type coercion,
 * so misconfiguration fails loudly up front rather than confusingly mid-request.
 */
export function loadConfig(
  config: ColloquialConfigInput,
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
