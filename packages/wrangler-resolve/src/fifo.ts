/**
 * FIFO (named pipe) serving for non-disk secret delivery.
 *
 * On Unix: creates a named pipe via `mkfifo`. Secrets only exist in
 * a kernel buffer — they never touch disk. A child process writes to
 * the pipe so the blocked write doesn't stall the main event loop.
 *
 * On Windows: falls back to a regular temp file.
 *
 * @example
 * ```ts
 * import { createServingTempFile } from 'node-env-resolver-cloudflare/fifo';
 *
 * const tmp = createServingTempFile('myapp-secrets');
 * const handle = tmp.startServing(() => JSON.stringify({ KEY: 'value' }));
 *
 * // tmp.filePath can be passed to wrangler --secrets-file
 * console.log(tmp.filePath);
 *
 * // Update content (kills old writer, spawns new one)
 * handle.update(JSON.stringify({ KEY: 'new-value' }));
 *
 * // Clean up on exit
 * handle.stop();
 * tmp.cleanup();
 * ```
 */

import {
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawn, execSync } from 'node:child_process';

const isWindows = process.platform === 'win32';

function tmpPath(prefix: string): string {
  return join(tmpdir(), `${prefix}-${randomBytes(8).toString('hex')}`);
}

export interface ServingHandle {
  /** Kill the FIFO server and clean up. */
  stop(): void;
  /** Update content — kills old writer, spawns new one. */
  update(content: string): void;
}

export interface TempFileResult {
  /** Path to the FIFO or temp file. */
  filePath: string;
  /** Remove the FIFO/file from disk. */
  cleanup(): void;
  /** Start serving content. Returns a handle for updates. */
  startServing(getContent: () => string): ServingHandle;
}

/**
 * Create a named pipe (FIFO) for long-running commands.
 *
 * - Unix: data lives only in kernel buffer, never on disk
 * - Windows: falls back to a regular temp file
 */
export function createServingTempFile(prefix: string): TempFileResult {
  const filePath = tmpPath(prefix);

  if (!isWindows) {
    execSync(`mkfifo -m 0600 "${filePath}"`);
  }

  function cleanup() {
    try {
      unlinkSync(filePath);
    } catch {
      // may already be deleted
    }
  }

  function startServing(getContent: () => string): ServingHandle {
    if (isWindows) {
      writeFileSync(filePath, getContent());
      return {
        update(content: string) {
          writeFileSync(filePath, content);
        },
        stop() {
          // noop on windows
        },
      };
    }

    // spawn child process to write to FIFO
    // the child reads content from stdin then writes to the pipe in a loop
    // this prevents the blocking write from stalling the main process
    const fifoServer = spawn(process.execPath, [
      '-e',
      `
      const fs = require('fs');
      const path = ${JSON.stringify(filePath)};
      let content = '';
      process.stdin.on('data', d => content += d);
      process.stdin.on('end', () => {
        (function serve() {
          try { fs.writeFileSync(path, content); setImmediate(serve); }
          catch { process.exit(); }
        })();
      });
    `,
    ], {
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    fifoServer.stdin!.write(getContent());
    fifoServer.stdin!.end();

    let currentStop = () => { fifoServer.kill(); };
    let currentUpdate = (content: string) => {
      fifoServer.kill();
      const replacement = startServing(() => content);
      currentStop = replacement.stop;
      currentUpdate = replacement.update;
    };

    return {
      stop: currentStop,
      update: currentUpdate,
    };
  }

  return { filePath, cleanup, startServing };
}
