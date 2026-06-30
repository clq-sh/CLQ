import fs from "node:fs"
import path from "node:path"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { loadConfig } from "@clq-sh/core/config"
import type { CAC } from "cac"
import { execSafe } from "../utils/exec-safe.js"
import { findProjectRoot } from "../utils/find-project-root.js"
import { scanDirectory } from "../utils/secret-scan.js"

const here = dirname(fileURLToPath(import.meta.url))

// clq.config.ts is TypeScript that imports @clq-sh/core, so the built CLI (plain node)
// cannot import it directly. A short-lived `tsx` child whose module resolution is the
// project itself imports the config and serializes the plain declaration object back as
// a single JSON line. The env validation (loadConfig) then runs here in the doctor
// process, so the real env values are never sent to or read by the child at all.
//
// MUST be a single line: on Windows the `tsx` launcher is a .CMD shim, and a multi-line
// -e argument gets mangled by cmd.exe (newlines break the argument), producing no output.
const CONFIG_LOAD_SCRIPT =
  "import('node:url').then(async ({ pathToFileURL }) => { try { " +
  "const mod = await import(pathToFileURL(process.env.CLQ_CONFIG_PATH).href); " +
  "const cfg = (mod.default && mod.default.default) ? mod.default.default : mod.default; " +
  "process.stdout.write(JSON.stringify({ ok: true, config: cfg })) " +
  "} catch (e) { " +
  "process.stdout.write(JSON.stringify({ ok: false, message: e && e.message })) " +
  "} })"

type ConfigCheck = { ok: boolean; message?: string; fix?: string }

async function checkConfig(root: string): Promise<ConfigCheck> {
  const configPath = path.join(root, "clq.config.ts")
  if (!fs.existsSync(configPath)) {
    return { ok: false, message: "clq.config.ts not found." }
  }

  let loaded: { ok: boolean; config?: unknown; message?: string }
  try {
    const result = await execSafe("tsx", ["-e", CONFIG_LOAD_SCRIPT], {
      cwd: root,
      env: { ...process.env, CLQ_CONFIG_PATH: configPath },
      preferLocal: true,
      localDir: here,
      reject: false,
    })
    loaded = JSON.parse(String(result.stdout))
  } catch {
    return { ok: false, message: "Could not load clq.config.ts." }
  }
  if (!loaded || loaded.ok !== true) {
    return {
      ok: false,
      message: loaded?.message ?? "Could not load clq.config.ts.",
    }
  }

  try {
    loadConfig(loaded.config as Parameters<typeof loadConfig>[0])
    return { ok: true }
  } catch (err) {
    const e = err as { message?: string; cause?: string; fix?: string }
    const msg = [e.message, e.cause].filter(Boolean).join(" - ")
    return { ok: false, message: msg, fix: e.fix }
  }
}

export function registerDoctorCommand(cli: CAC): void {
  cli
    .command("doctor", "Run a full health check on the current project")
    .action(async () => {
      const root = findProjectRoot()
      if (!root) {
        console.error("No CLQ project found.")
        process.exitCode = 1
        return
      }

      let allPassed = true

      console.log("Checking project configuration...")
      const config = await checkConfig(root)
      if (config.ok) {
        console.log("  ✓ Config valid, all required env vars present")
      } else {
        allPassed = false
        console.log(`  ✗ Config check failed: ${config.message}`)
        if (config.fix) console.log(`    Fix: ${config.fix}`)
      }

      console.log("Checking dependencies...")
      const nodeModulesExists = fs.existsSync(path.join(root, "node_modules"))
      console.log(
        nodeModulesExists
          ? "  ✓ Dependencies installed"
          : "  ✗ Run pnpm install",
      )
      if (!nodeModulesExists) allPassed = false

      console.log("Scanning for hardcoded secrets...")
      const findings = scanDirectory(path.join(root, "src"))
      if (findings.length === 0) {
        console.log("  ✓ No hardcoded secrets detected")
      } else {
        allPassed = false
        for (const f of findings) {
          console.log(
            `  ✗ ${f.patternName} found in ${f.file}:${f.line} → ${f.masked}`,
          )
        }
      }

      process.exitCode = allPassed ? 0 : 1
    })
}
