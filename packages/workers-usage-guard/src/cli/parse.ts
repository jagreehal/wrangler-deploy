export type ParsedArgs = {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
};

const BOOLEAN_FLAGS = new Set([
  "force",
  "local",
  "remote",
  "json",
  "yes",
  "help",
  "version",
  "keep-data",
  "follow",
]);

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);

  if (args.length === 0) return { command: "help", positional: [], flags: {} };
  if (args[0] === "--version" || args[0] === "-v") return { command: "version", positional: [], flags: {} };
  if (args[0] === "--help" || args[0] === "-h") return { command: "help", positional: [], flags: {} };

  const command = args[0]!;
  const rest = args.slice(1);
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]!;
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    let key: string;
    let value: string | boolean | undefined;
    if (eq >= 0) {
      key = token.slice(2, eq);
      value = token.slice(eq + 1);
    } else {
      key = token.slice(2);
      const next = rest[i + 1];
      if (BOOLEAN_FLAGS.has(key) || !next || next.startsWith("--")) {
        value = true;
      } else {
        value = next;
        i += 1;
      }
    }
    flags[key] = value;
  }

  return { command, positional, flags };
}

export function requireString(flags: Record<string, string | boolean>, name: string, message?: string): string {
  const value = flags[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(message ?? `--${name} is required`);
  }
  return value;
}

export function optionalString(flags: Record<string, string | boolean>, name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

export function boolFlag(flags: Record<string, string | boolean>, name: string): boolean {
  return flags[name] === true;
}
