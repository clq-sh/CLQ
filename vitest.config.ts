import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    passWithNoTests: true,
    // Several integration tests build their package in beforeAll by shelling out
    // to `pnpm ... build`. Running test files in parallel would launch concurrent
    // pnpm/tsup invocations that contend on the store and dist output. Serialize
    // test files so those builds never overlap.
    fileParallelism: false,
  },
})
