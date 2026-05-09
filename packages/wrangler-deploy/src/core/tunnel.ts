import { spawn, type ChildProcess } from "node:child_process";

/**
 * Lightweight wrapper around `cloudflared tunnel --url <local>` for use
 * during `wd dev`. Each TunnelHandle owns one cloudflared subprocess and
 * exposes the public trycloudflare.com URL once cloudflared has reported it.
 *
 * We deliberately only support Quick Tunnels (no named tunnels, no token
 * auth) — that's the path that "just works" with no setup, `dev.tunnel: true` behaviour. Users who need named tunnels
 * should run `cloudflared` themselves and point it at the dev port.
 */

export interface TunnelHandle {
  url: Promise<string>;
  process: ChildProcess;
  close(): Promise<void>;
}

const PUBLIC_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

export interface StartTunnelOptions {
  localUrl: string;
  /** Override binary path. Defaults to "cloudflared" on PATH. */
  binary?: string;
  /** How long to wait for cloudflared to surface the public URL. */
  timeoutMs?: number;
  /** Hook for tests. */
  spawnFn?: typeof spawn;
}

export function startTunnel(options: StartTunnelOptions): TunnelHandle {
  const binary = options.binary ?? "cloudflared";
  const timeoutMs = options.timeoutMs ?? 30_000;
  const spawnImpl = options.spawnFn ?? spawn;

  const child = spawnImpl(
    binary,
    ["tunnel", "--no-autoupdate", "--url", options.localUrl, "--logfile", "/dev/stderr"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  const url = new Promise<string>((res, rej) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      rej(new Error(`cloudflared timed out after ${timeoutMs}ms without announcing a public URL`));
    }, timeoutMs);
    timer.unref?.();

    const onChunk = (chunk: Buffer | string) => {
      if (resolved) return;
      const match = PUBLIC_URL_PATTERN.exec(chunk.toString());
      if (match) {
        resolved = true;
        clearTimeout(timer);
        res(match[0]);
      }
    };

    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
    child.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      const message =
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? `cloudflared not found on PATH. Install from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/`
          : `cloudflared failed to start: ${err.message}`;
      rej(new Error(message));
    });
    child.on("exit", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      rej(new Error(`cloudflared exited (code ${code ?? "null"}) before announcing a URL`));
    });
  });

  const close = (): Promise<void> =>
    new Promise((res) => {
      if (child.exitCode !== null || child.killed) {
        res();
        return;
      }
      child.once("exit", () => res());
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null && !child.killed) child.kill("SIGKILL");
      }, 2_000).unref?.();
    });

  return { url, process: child, close };
}

/**
 * Best-effort capture of the public URL from a cloudflared chunk. Exported
 * for tests and for callers that already own a cloudflared process.
 */
export function extractTunnelUrl(chunk: string): string | undefined {
  const match = PUBLIC_URL_PATTERN.exec(chunk);
  return match?.[0];
}
