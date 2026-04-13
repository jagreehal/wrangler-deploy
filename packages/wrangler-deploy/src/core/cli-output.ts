export type OutputFormat = "text" | "json";

export interface JsonOutputOptions {
  fields?: string[];
  ndjson?: boolean;
}

let activeJsonOutputOptions: JsonOutputOptions = {};

export function setJsonOutputOptions(options: JsonOutputOptions): void {
  activeJsonOutputOptions = options;
}

function readFlagValues(args: string[], flagName: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === `--${flagName}` && args[index + 1] !== undefined) {
      values.push(args[index + 1]!);
      index += 1;
      continue;
    }

    if (arg?.startsWith(`--${flagName}=`)) {
      values.push(arg.slice(flagName.length + 3));
    }
  }
  return values;
}

export function parseOutputFields(args: string[]): string[] | undefined {
  const values = readFlagValues(args, "fields")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

export function parseOutputFormat(args: string[]): OutputFormat {
  const formatIndex = args.indexOf("--format");
  if (formatIndex !== -1 && ["json", "ndjson"].includes(args[formatIndex + 1] ?? "")) {
    return "json";
  }

  if (args.includes("--json") || args.includes("--ndjson")) {
    return "json";
  }

  return "text";
}

export function isDryRun(args: string[]): boolean {
  return args.includes("--dry-run");
}

export function redactSensitiveText(input: string): string {
  return input.replace(/\b[a-zA-Z0-9_-]{40,}\b/g, "[REDACTED]");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeSelected(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      target[key] = mergeSelected({ ...current }, value);
      continue;
    }
    target[key] = value;
  }
  return target;
}

function selectField(value: unknown, path: string[]): unknown {
  if (path.length === 0) return value;
  if (Array.isArray(value)) {
    return value.map((entry) => selectField(entry, path));
  }
  if (!isPlainObject(value)) return undefined;

  const [head, ...rest] = path;
  if (!head || !(head in value)) return undefined;
  const selected = selectField(value[head], rest);
  if (selected === undefined) return undefined;
  return { [head]: selected };
}

function filterFields(value: unknown, fields?: string[]): unknown {
  if (!fields || fields.length === 0) return value;
  if (Array.isArray(value)) {
    return value.map((entry) => filterFields(entry, fields));
  }
  if (!isPlainObject(value)) return value;

  const selected: Record<string, unknown> = {};
  for (const field of fields) {
    const nested = selectField(value, field.split("."));
    if (isPlainObject(nested)) {
      mergeSelected(selected, nested);
    }
  }
  return selected;
}

export function formatCliError(error: unknown): string {
  if (error instanceof Error) {
    return redactSensitiveText(error.message);
  }

  return redactSensitiveText(String(error));
}

export function printJson(data: unknown): void {
  const selected = filterFields(data, activeJsonOutputOptions.fields);
  if (activeJsonOutputOptions.ndjson) {
    if (Array.isArray(selected)) {
      for (const entry of selected) {
        process.stdout.write(`${JSON.stringify(entry)}\n`);
      }
      return;
    }

    process.stdout.write(`${JSON.stringify(selected)}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify(selected, null, 2)}\n`);
}
