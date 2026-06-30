import { randomUUID } from "node:crypto"
import { buildToolsList } from "./protocol/translate.js"
import type { ColloquialContext, ColloquialToolDefinition } from "./types.js"

type CallRequest = { type: "call"; id: number; name: string; args: unknown }

/**
 * Runs inside a project process that `clq inspect` spawns (when CLQ_INSPECT_REPORT is
 * set). Opens NO network listener of its own — the inspector parent holds the only
 * HTTP listener, keeping the whole surface to a single 127.0.0.1-bound port.
 *
 * Protocol over stdio:
 *   - on start, writes `{ type: "tools", tools }` to stdout
 *   - for each `{ type: "call", id, name, args }` line on stdin, runs the handler
 *     and writes back `{ type: "result", id, output }` (or an error variant)
 */
export function startInspectReporter(tools: ColloquialToolDefinition[]): void {
  const write = (msg: unknown): void => {
    process.stdout.write(`${JSON.stringify(msg)}\n`)
  }

  write({ type: "tools", tools: buildToolsList(tools).tools })

  let buffer = ""
  process.stdin.setEncoding("utf8")
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk
    let nl = buffer.indexOf("\n")
    while (nl !== -1) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (line) void handleLine(line)
      nl = buffer.indexOf("\n")
    }
  })
  process.stdin.resume()

  async function handleLine(line: string): Promise<void> {
    let req: CallRequest
    try {
      req = JSON.parse(line) as CallRequest
    } catch {
      return
    }
    if (req.type !== "call") return

    const tool = tools.find((t) => t.name === req.name)
    if (!tool) {
      write({
        type: "result",
        id: req.id,
        notFound: true,
        error: `Tool '${req.name}' is not registered on this server.`,
      })
      return
    }

    const ctx: ColloquialContext = {
      requestId: randomUUID(),
      timestamp: Date.now(),
    }
    try {
      const output = await tool.handler({ input: req.args, ctx })
      write({ type: "result", id: req.id, output })
    } catch (err) {
      write({
        type: "result",
        id: req.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}
