import type { ZodError } from "zod"
import type { ColloquialError } from "./types.js"

/** Concrete, throwable implementation of the ColloquialError contract. */
export class ColloquialErrorImpl extends Error implements ColloquialError {
  readonly code: string
  readonly cause?: string
  readonly fix?: string

  constructor(props: ColloquialError) {
    super(props.message)
    this.code = props.code
    this.message = props.message
    this.cause = props.cause
    this.fix = props.fix
    this.name = "ColloquialError"
  }
}

/** Joins Zod issues into a short, human-readable string capped at 3 shown. */
function formatZodIssues(error: ZodError): string {
  const issues = error.issues
  const shown = issues.slice(0, 3).map((issue) => {
    const path = issue.path.join(".")
    return path ? `${path}: ${issue.message}` : issue.message
  })
  const extra = issues.length - shown.length
  const suffix = extra > 0 ? `; ...and ${extra} more` : ""
  return shown.join("; ") + suffix
}

/** Factory catalog of every framework error, each returning a ready-to-throw instance. */
export const errors = {
  missingDescription(toolName: string): ColloquialErrorImpl {
    return new ColloquialErrorImpl({
      code: "TOOL_MISSING_DESCRIPTION",
      message: `Tool '${toolName}' is missing a description.`,
      cause: "AI agents rely on tool descriptions to decide when to call them.",
      fix: "Add a clear, one-sentence description explaining what this tool does and when to use it.",
    })
  },

  invalidInput(toolName: string, zodError: ZodError): ColloquialErrorImpl {
    return new ColloquialErrorImpl({
      code: "TOOL_INVALID_INPUT",
      message: `Tool '${toolName}' received invalid input.`,
      cause: formatZodIssues(zodError),
      fix: "Check the input matches the tool's input schema.",
    })
  },

  invalidOutput(toolName: string, zodError: ZodError): ColloquialErrorImpl {
    return new ColloquialErrorImpl({
      code: "TOOL_INVALID_OUTPUT",
      message: `Tool '${toolName}' returned invalid output.`,
      cause: formatZodIssues(zodError),
      fix: "Check the handler's return value matches the tool's output schema.",
    })
  },

  toolNotFound(toolName: string): ColloquialErrorImpl {
    return new ColloquialErrorImpl({
      code: "TOOL_NOT_FOUND",
      message: `Tool '${toolName}' is not registered on this server.`,
      fix: "Check the tool name matches exactly, or register it with server.tool().",
    })
  },

  missingEnvVar(varName: string, description?: string): ColloquialErrorImpl {
    return new ColloquialErrorImpl({
      code: "CONFIG_MISSING_ENV_VAR",
      message: `Required environment variable '${varName}' is not set.`,
      cause: description ?? "This variable is required by colloquial.config.ts",
      fix: `Set ${varName} in your .env file or environment before starting the server.`,
    })
  },

  unauthorized(toolName: string, requiredScope?: string): ColloquialErrorImpl {
    return new ColloquialErrorImpl({
      code: "TOOL_UNAUTHORIZED",
      message: `Call to '${toolName}' was rejected — missing required authorization.`,
      cause: requiredScope
        ? `This tool requires scope '${requiredScope}'.`
        : "This tool requires authentication.",
      fix: "Provide a valid authenticated token with the correct scope.",
    })
  },
}
