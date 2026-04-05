/**
 * JSONC round-trip writer.
 * Strips comments, parses, deep-merges updates, re-stringifies, and reinserts comments.
 */

interface CommentEntry {
  lineIndex: number;
  content: string;
}

function stripComments(jsonc: string): { clean: string; comments: CommentEntry[] } {
  const lines = jsonc.split("\n");
  const comments: CommentEntry[] = [];
  const cleanLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // Detect standalone comment lines (lines that are only // comments after whitespace)
    const trimmed = line.trimStart();
    if (trimmed.startsWith("//")) {
      comments.push({ lineIndex: i, content: line });
      cleanLines.push(""); // placeholder to preserve line numbering
    } else {
      // Strip inline comments (// after a value), being careful of URLs in strings
      const stripped = stripInlineComment(line);
      cleanLines.push(stripped);
    }
  }

  return { clean: cleanLines.join("\n"), comments };
}

function stripInlineComment(line: string): string {
  // Remove trailing // comments that are not inside strings
  let inString = false;
  let escape = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (!inString && ch === "/" && line[i + 1] === "/") {
      return line.slice(0, i).trimEnd();
    }
  }
  return line;
}

function stripTrailingCommas(json: string): string {
  // Remove trailing commas before } or ]
  return json.replace(/,(\s*[}\]])/g, "$1");
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof result[key] === "object" &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function updateJsonc(jsonc: string, updates: Record<string, unknown>): string {
  const { clean, comments } = stripComments(jsonc);
  const noTrailing = stripTrailingCommas(clean);

  // Filter out blank placeholder lines before parsing
  const parseableLines = noTrailing.split("\n").filter((l) => l.trim() !== "");
  const parseable = parseableLines.join("\n");

  const parsed = JSON.parse(parseable) as Record<string, unknown>;
  const merged = deepMerge(parsed, updates);
  const output = JSON.stringify(merged, null, 2);

  // Reinsert comments at their original line positions
  if (comments.length === 0) return output;

  const outputLines = output.split("\n");
  // Insert comments in reverse order so indices stay stable
  for (const comment of [...comments].reverse()) {
    const insertAt = Math.min(comment.lineIndex, outputLines.length);
    outputLines.splice(insertAt, 0, comment.content);
  }

  return outputLines.join("\n");
}
