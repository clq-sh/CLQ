import { cpSync } from "node:fs"
import { resolve } from "node:path"
import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  // Templates and the inspector UI are data, not code — tsup won't bundle them. Mirror
  // them into dist so the published binary can read them at runtime. The bundle collapses
  // to dist/index.js, so dist/public matches `resolve(here, "public")` in server.ts.
  onSuccess: async () => {
    cpSync(resolve("src/templates"), resolve("dist/templates"), {
      recursive: true,
    })
    cpSync(resolve("src/commands/inspect/public"), resolve("dist/public"), {
      recursive: true,
    })
  },
})
