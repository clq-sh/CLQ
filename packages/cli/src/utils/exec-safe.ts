import { type Options, type ResultPromise, execa } from "execa"

// The ONLY sanctioned way this CLI spawns a process. command and args are always
// separate — never a shell string, never shell: true. Shell injection is structurally
// impossible when command and args are kept as distinct values.
export function execSafe(
  command: string,
  args: string[] = [],
  options?: Options,
): ResultPromise {
  return execa(command, args, options)
}
