/**
 * Tiny dependency-free argv parser. Supports `--key value`, `--key=value`,
 * boolean `--flag`, and `--no-flag` (=> flag:false). Everything else is a
 * positional argument.
 */
export interface ParsedArgs {
  readonly command?: string;
  readonly positionals: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const body = arg.slice(2);
    if (body.startsWith("no-")) {
      flags[body.slice(3)] = false;
      continue;
    }
    const eq = body.indexOf("=");
    if (eq >= 0) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[body] = next;
      i++;
    } else {
      flags[body] = true;
    }
  }

  const [command, ...rest] = positionals;
  return { ...(command ? { command } : {}), positionals: rest, flags };
}

/** Read a flag as a string, or undefined. */
export function flagStr(
  flags: Readonly<Record<string, string | boolean>>,
  key: string,
): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

/** Read a flag as a boolean (presence = true), with a default. */
export function flagBool(
  flags: Readonly<Record<string, string | boolean>>,
  key: string,
  fallback = false,
): boolean {
  const v = flags[key];
  if (v === undefined) return fallback;
  return v !== false;
}

/** Read a flag as an integer, or undefined when absent/invalid. */
export function flagInt(
  flags: Readonly<Record<string, string | boolean>>,
  key: string,
): number | undefined {
  const v = flags[key];
  if (typeof v !== "string") return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}
