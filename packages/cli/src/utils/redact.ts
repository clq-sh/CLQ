const SECRET_KEY_PATTERN = /secret|token|password|api[-_]?key/i

/**
 * Recursively replace the value of any object key whose name looks like a secret
 * with "[REDACTED]". Defense in depth: a leaking handler can never expose credentials
 * through the inspector UI regardless of where the data came from.
 */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets)
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY_PATTERN.test(k) ? "[REDACTED]" : redactSecrets(v)
    }
    return out
  }
  return value
}
