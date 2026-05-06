import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface ParseResult {
  values: Record<string, string>;
  errors: Array<{ line: number; message: string }>;
}

export function parseDotenv(content: string): ParseResult {
  const values: Record<string, string> = {};
  const errors: Array<{ line: number; message: string }> = [];

  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;

    const exportMatch = /^export\s+(.+)$/.exec(line);
    const body = exportMatch ? exportMatch[1]! : line;

    const eq = body.indexOf("=");
    if (eq === -1) {
      errors.push({ line: index + 1, message: `missing "=" in entry "${line}"` });
      continue;
    }

    const key = body.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      errors.push({ line: index + 1, message: `invalid key "${key}"` });
      continue;
    }

    let value = body.slice(eq + 1).trim();

    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value
        .slice(1, -1)
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    } else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      value = value.slice(1, -1);
    } else {
      const hashIndex = value.indexOf(" #");
      if (hashIndex !== -1) value = value.slice(0, hashIndex).trim();
    }

    values[key] = value;
  }

  return { values, errors };
}

export interface LoadEnvFileOptions {
  override?: boolean;
}

export function loadEnvFile(path: string, options: LoadEnvFileOptions = {}): ParseResult {
  if (!existsSync(path)) {
    throw new Error(`env file not found: ${path}`);
  }
  const content = readFileSync(path, "utf-8");
  const result = parseDotenv(content);

  for (const [key, value] of Object.entries(result.values)) {
    if (options.override || process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  return result;
}

export function loadEnvFileFromArgs(
  args: string[],
  cwd: string,
  options: LoadEnvFileOptions = {},
): { path: string; loaded: number } | null {
  const idx = args.indexOf("--env-file");
  if (idx === -1) return null;
  const value = args[idx + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("--env-file requires a path");
  }
  const fullPath = resolve(cwd, value);
  const result = loadEnvFile(fullPath, options);
  if (result.errors.length > 0) {
    const firstError = result.errors[0]!;
    throw new Error(`env file ${value} parse error on line ${firstError.line}: ${firstError.message}`);
  }
  return { path: fullPath, loaded: Object.keys(result.values).length };
}
