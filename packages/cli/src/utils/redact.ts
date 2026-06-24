const SECRET_KEY_PATTERN = /secret|token|password|api[-_]?key/i

/**
 * Recursively replace the VALUE of any object key whose name looks like a secret
 * (secret/token/password/api-key, case-insensitive) with "[REDACTED]". Defense in depth:
 * the inspector never returns a value held under a secret-named key, regardless of where
 * it came from, so a leaking handler can't expose credentials through the inspector UI.
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
