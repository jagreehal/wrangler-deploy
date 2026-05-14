import { AgentErrors } from "./cli-output.js";

export function splitMacroBody(body: string): string[] {
  return body
    .split("&&")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function tokenizeCommandText(commandText: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  let escaping = false;

  for (let i = 0; i < commandText.length; i += 1) {
    const ch = commandText.charAt(i);
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === "\"") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }

  if (escaping) current += "\\";
  if (quote) throw AgentErrors.validation(`Unterminated quoted string in macro command: ${commandText}`, "Close the quoted string in the macro definition.");
  if (current) tokens.push(current);
  return tokens;
}

export function macroCommandName(commandText: string): string | undefined {
  const tokens = tokenizeCommandText(commandText);
  const first = tokens[0];
  if (!first) return undefined;
  if (first === "wd") return tokens[1];
  return first;
}
