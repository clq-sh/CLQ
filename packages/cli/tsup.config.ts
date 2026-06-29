import { defineConfig } from "tsup"

// Non-TypeScript assets (templates, inspector HTML) are copied by
// scripts/copy-assets.mjs, which runs as the second step of the build script.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
})
