import { expectTypeOf } from "expect-type"
import { describe, expect, test } from "vitest"
import { execSafe } from "./exec-safe.js"

describe("execSafe", () => {
  test("runs a process and resolves with its stdout", async () => {
    const result = await execSafe("node", ["-e", "console.log(42)"])
    expect(String(result.stdout).trim()).toBe("42")
  })

  test("first two params are strictly (string, string[]) — no string|string[] union", () => {
    type Command = Parameters<typeof execSafe>[0]
    // `args` has a default, so the slot is optional; NonNullable strips that.
    type Args = NonNullable<Parameters<typeof execSafe>[1]>

    // The command is a plain string, never an array, never a union.
    expectTypeOf<Command>().toEqualTypeOf<string>()
    expectTypeOf<Command>().not.toEqualTypeOf<string | string[]>()

    // The args are a plain string[], never string | string[].
    expectTypeOf<Args>().toEqualTypeOf<string[]>()
    expectTypeOf<Args>().not.toEqualTypeOf<string | string[]>()
  })
})
