import { cpSync } from "node:fs"
import { resolve } from "node:path"
import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  // Templates are data, not code — tsup won't bundle them. Mirror them into dist so
  // the published binary can read src/templates/default at runtime from dist/templates.
  onSuccess: async () => {
    cpSync(resolve("src/templates"), resolve("dist/templates"), {
      recursive: true,
    })
  },
})
