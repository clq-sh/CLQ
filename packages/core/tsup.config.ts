import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "test-fixtures/stdio-server": "src/protocol/test-fixtures/stdio-server.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
})
