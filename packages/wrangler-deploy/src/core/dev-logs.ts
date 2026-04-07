import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const LABEL_WIDTH = 20;

// ANSI 256-color palette for worker labels
const COLOR_PALETTE = [
  "\x1b[36m", // cyan
  "\x1b[33m", // yellow
  "\x1b[35m", // magenta
  "\x1b[32m", // green
  "\x1b[34m", // blue
  "\x1b[91m", // bright red
  "\x1b[96m", // bright cyan
  "\x1b[93m", // bright yellow
  "\x1b[95m", // bright magenta
  "\x1b[92m", // bright green
];

const RESET = "\x1b[0m";

export interface LogMultiplexer {
  createWriter(workerPath: string): (data: string) => void;
}

export interface LogMultiplexerOptions {
  logDir?: string;
}

export function logFilePathForTarget(logDir: string, target: string): string {
  const safeName = target.replaceAll("/", "__").replaceAll(":", "--");
  return resolve(logDir, `${safeName}.log`);
}

/**
 * Creates a log multiplexer that prefixes each line of output with a
 * color-coded label derived from the worker path's last segment.
 */
export function createLogMultiplexer(
  output: (line: string) => void,
  options?: LogMultiplexerOptions,
): LogMultiplexer {
  let colorIndex = 0;

  return {
    createWriter(workerPath: string): (data: string) => void {
      const segments = workerPath.split("/");
      const lastSegment = segments[segments.length - 1] ?? workerPath;
      const label = lastSegment.slice(0, LABEL_WIDTH).padEnd(LABEL_WIDTH);
      const color = COLOR_PALETTE[colorIndex % COLOR_PALETTE.length] ?? COLOR_PALETTE[0]!;
      colorIndex++;

      const prefix = `${color}[${label}]${RESET} `;
      const logFile = options?.logDir ? logFilePathForTarget(options.logDir, workerPath) : undefined;
      if (logFile) {
        mkdirSync(dirname(logFile), { recursive: true });
      }

      return (data: string) => {
        const lines = data.split("\n");
        for (const line of lines) {
          output(`${prefix}${line}`);
          if (logFile) {
            appendFileSync(logFile, `${line}\n`);
          }
        }
      };
    },
  };
}
