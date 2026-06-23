import { type Options, type ResultPromise, execa } from "execa"

/**
 * This is the ONLY sanctioned way this CLI spawns a process. command and args are
 * always separate — never build a shell string. Never pass shell: true.
 */
export function execSafe(
  command: string,
  args: string[] = [],
  options?: Options,
): ResultPromise {
  return execa(command, args, options)
}
