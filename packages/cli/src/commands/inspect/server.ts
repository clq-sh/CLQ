import crypto from "node:crypto"
import { readFileSync } from "node:fs"
import http from "node:http"
import path from "node:path"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { execSafe } from "../../utils/exec-safe.js"
import { redactSecrets } from "../../utils/redact.js"

const here = dirname(fileURLToPath(import.meta.url))

const indexHtml: string = (() => {
  try {
    return readFileSync(path.join(here, "public", "index.html"), "utf8")
  } catch {
    return "<!doctype html><title>CLQ Inspector</title><p>Inspector UI asset not found.</p>"
  }
})()

type ChildMessage =
  | { type: "tools"; tools: { name: string }[] }
  | {
      type: "result"
      id: number
      output?: unknown
      error?: string
      notFound?: boolean
    }

type LogEntry = {
  time: number
  name: string
  args: unknown
  result: unknown
}

export interface InspectServer {
  server: http.Server
  port: number
  token: string
  close: () => Promise<void>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Bind a server to 127.0.0.1, retrying on EADDRINUSE up to `maxAttempts` ports. A FRESH
 * server is created per attempt via `makeServer` — reusing one http.Server object across
 * listen() calls does not reliably re-bind on Windows, so each attempt gets its own.
 */
function listenWithRetry(
  makeServer: () => http.Server,
  startPort: number,
  maxAttempts: number,
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    let attempt = 0
    const tryListen = (port: number) => {
      const server = makeServer()
      const onError = (err: NodeJS.ErrnoException) => {
        server.close()
        if (err.code === "EADDRINUSE" && attempt < maxAttempts - 1) {
          attempt++
          tryListen(port + 1)
          return
        }
        reject(err)
      }
      server.once("error", onError)
      // Bind explicitly to loopback — never undefined, never 0.0.0.0 — and exclusively
      // (no port sharing), so a port already in use reliably yields EADDRINUSE to retry.
      server.listen({ port, host: "127.0.0.1", exclusive: true }, () => {
        server.removeListener("error", onError)
        resolve({ server, port })
      })
    }
    tryListen(startPort)
  })
}

export async function startInspectServer(opts: {
  root: string
  port?: number
}): Promise<InspectServer> {
  const token = crypto.randomBytes(32).toString("hex")
  const entry = path.join(opts.root, "src", "index.ts")

  const child = execSafe("tsx", [entry], {
    cwd: opts.root,
    env: { ...process.env, CLQ_INSPECT: "1", CLQ_INSPECT_REPORT: "1" },
    preferLocal: true,
    localDir: here,
    stdio: ["pipe", "pipe", "pipe"],
    reject: false,
  })

  let registeredTools: { name: string }[] = []
  let resolveRegistered: () => void = () => {}
  const registeredPromise = new Promise<void>((r) => {
    resolveRegistered = r
  })
  const pending = new Map<number, (msg: ChildMessage) => void>()
  let nextId = 1

  let stdoutBuf = ""
  child.stdout?.setEncoding("utf8")
  child.stdout?.on("data", (chunk: string) => {
    stdoutBuf += chunk
    let nl = stdoutBuf.indexOf("\n")
    while (nl !== -1) {
      const line = stdoutBuf.slice(0, nl).trim()
      stdoutBuf = stdoutBuf.slice(nl + 1)
      if (line) {
        let msg: ChildMessage | undefined
        try {
          msg = JSON.parse(line) as ChildMessage
        } catch {
          msg = undefined
        }
        if (msg?.type === "tools") {
          registeredTools = msg.tools
          resolveRegistered()
        } else if (msg?.type === "result" && pending.has(msg.id)) {
          const cb = pending.get(msg.id)
          pending.delete(msg.id)
          cb?.(msg)
        }
      }
      nl = stdoutBuf.indexOf("\n")
    }
  })
  // Drain stderr so the child never blocks on a full pipe; not parsed.
  child.stderr?.on("data", () => {})

  function callTool(
    name: string,
    args: unknown,
  ): Promise<ChildMessage & { type: "result" }> {
    return new Promise((resolve, reject) => {
      const id = nextId++
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error("Tool call timed out."))
      }, 15_000)
      pending.set(id, (msg) => {
        clearTimeout(timer)
        resolve(msg as ChildMessage & { type: "result" })
      })
      child.stdin?.write(
        `${JSON.stringify({ type: "call", id, name, args })}\n`,
      )
    })
  }

  const logs: LogEntry[] = []

  const sendJson = (
    res: http.ServerResponse,
    status: number,
    body: unknown,
  ): void => {
    res.writeHead(status, { "content-type": "application/json" })
    res.end(JSON.stringify(body))
  }

  const readJson = (req: http.IncomingMessage): Promise<unknown> =>
    new Promise((resolve) => {
      let raw = ""
      req.on("data", (c) => {
        raw += c
        if (raw.length > 1_000_000) req.destroy() // basic body cap
      })
      req.on("end", () => {
        try {
          resolve(raw ? JSON.parse(raw) : {})
        } catch {
          resolve({})
        }
      })
      req.on("error", () => resolve({}))
    })

  // Set once the listener is bound; used to compute the only allowed Origin.
  let boundPort = 0

  const requestListener = (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: "Internal error." })
    })
  }

  async function handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const expectedOrigin = `http://127.0.0.1:${boundPort}`
    const url = new URL(req.url ?? "/", expectedOrigin)

    // Serve the static UI at GET / BEFORE any Origin/token gate. This adds NO new
    // trust surface: the page is a constant asset that holds no token and no project
    // data — anyone who can reach this loopback port could fetch it, and learn
    // nothing. The gate must come after because a top-level browser navigation to
    // `/?token=…` sends no Origin header and would otherwise be rejected at 403,
    // before the user ever sees the page that supplies the token to the API. Every
    // /api/* route below still enforces Origin + token — that is the real boundary.
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      })
      res.end(indexHtml)
      return
    }

    // SECURITY: Origin is checked unconditionally, before anything else. A wrong-origin
    // request is rejected here and never reaches token validation, so it cannot even
    // learn whether a token would have been accepted.
    if (req.headers.origin !== expectedOrigin) {
      sendJson(res, 403, { error: "Forbidden: invalid origin." })
      return
    }

    // SECURITY: token checked only after origin has passed.
    if (req.headers["x-clq-token"] !== token) {
      sendJson(res, 401, { error: "Unauthorized." })
      return
    }

    if (req.method === "GET" && url.pathname === "/api/tools") {
      sendJson(res, 200, redactSecrets({ tools: registeredTools }))
      return
    }

    if (req.method === "POST" && url.pathname === "/api/call") {
      const body = (await readJson(req)) as { name?: string; args?: unknown }
      const name = body?.name
      if (
        typeof name !== "string" ||
        !registeredTools.some((t) => t.name === name)
      ) {
        sendJson(res, 404, {
          error: `Tool '${String(name)}' is not registered on this server.`,
        })
        return
      }
      const msg = await callTool(name, body?.args)
      if (msg.error) {
        sendJson(res, 200, {
          isError: true,
          error: redactSecrets(msg.error),
        })
        return
      }
      const result = redactSecrets(msg.output)
      logs.push({
        time: Date.now(),
        name,
        args: redactSecrets(body?.args),
        result,
      })
      if (logs.length > 200) logs.shift()
      sendJson(res, 200, { ok: true, result })
      return
    }

    if (req.method === "GET" && url.pathname === "/api/logs") {
      sendJson(res, 200, { logs })
      return
    }

    sendJson(res, 404, { error: "Not found." })
  }

  const { server, port } = await listenWithRetry(
    () => http.createServer(requestListener),
    opts.port ?? 7317,
    5,
  )
  boundPort = port

  await Promise.race([registeredPromise, sleep(20_000)])

  const close = async (): Promise<void> => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    try {
      child.kill("SIGTERM")
      await Promise.race([child, sleep(2_000)])
    } catch {
      /* child already gone */
    }
  }

  return { server, port, token, close }
}
