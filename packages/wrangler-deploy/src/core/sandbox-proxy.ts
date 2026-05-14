/**
 * Tiny HTTP CONNECT + HTTP forward proxy used by `wd sandbox run` to filter outbound network
 * by hostname. The proxy listens on 127.0.0.1, accepts standard HTTP_PROXY / HTTPS_PROXY traffic,
 * and tunnels (or forwards) only requests whose Host / SNI matches the allowlist.
 *
 * Anything not matching the allowlist is rejected with a structured response so the inner command
 * sees a clear failure rather than a silent hang.
 */
import { connect as netConnect, createServer, type Server, type Socket } from "node:net";

export interface ProxyOptions {
  /** Hostname patterns allowed through. Supports leading-dot wildcards: `.cloudflare.com` matches any subdomain. */
  allowedHosts: string[];
  /** Optional callback for every connection decision. Useful for logs/audits. */
  onDecision?: (decision: ProxyDecision) => void;
}

export interface ProxyDecision {
  ts: string;
  outcome: "allow" | "deny";
  host: string;
  port: number;
  reason?: string;
  protocol: "http-connect" | "http-forward";
}

export interface ProxyHandle {
  /** The port the proxy is listening on (always 127.0.0.1). */
  port: number;
  /** The proxy URL suitable for HTTPS_PROXY / HTTP_PROXY env vars. */
  url: string;
  /** Stop the proxy. Idempotent. */
  stop: () => Promise<void>;
}

const DEFAULT_ALLOWED_HOSTS = [
  ".cloudflare.com",
  ".workers.dev",
  ".pages.dev",
  ".github.com",
  ".githubusercontent.com",
  ".npmjs.org",
  ".npmjs.com",
  "127.0.0.1",
  "localhost",
];

export function defaultAllowedHosts(): string[] {
  return [...DEFAULT_ALLOWED_HOSTS];
}

function hostMatches(host: string, patterns: string[]): boolean {
  const lower = host.toLowerCase();
  for (const pattern of patterns) {
    const p = pattern.toLowerCase();
    if (p.startsWith(".")) {
      // wildcard subdomain match
      if (lower === p.slice(1) || lower.endsWith(p)) return true;
    } else if (lower === p) {
      return true;
    }
  }
  return false;
}

function parseHostPort(input: string, defaultPort: number): { host: string; port: number } | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  // IPv6 literal in [..]:port form
  if (trimmed.startsWith("[")) {
    const close = trimmed.indexOf("]");
    if (close === -1) return undefined;
    const host = trimmed.slice(1, close);
    const rest = trimmed.slice(close + 1);
    const port = rest.startsWith(":") ? Number.parseInt(rest.slice(1), 10) : defaultPort;
    return { host, port: Number.isFinite(port) ? port : defaultPort };
  }
  const colonIndex = trimmed.lastIndexOf(":");
  if (colonIndex === -1) return { host: trimmed, port: defaultPort };
  const host = trimmed.slice(0, colonIndex);
  const port = Number.parseInt(trimmed.slice(colonIndex + 1), 10);
  return { host, port: Number.isFinite(port) ? port : defaultPort };
}

function denyResponse(reason: string): string {
  const body = JSON.stringify({
    ok: false,
    error: { type: "sandbox", code: "WD_E_SANDBOX_BLOCKED", message: reason, retryable: false },
  });
  return [
    "HTTP/1.1 403 Forbidden",
    "Content-Type: application/json",
    `Content-Length: ${Buffer.byteLength(body)}`,
    "Connection: close",
    "",
    body,
  ].join("\r\n");
}

/**
 * Start the proxy. Returns once the socket is listening.
 */
export async function startSandboxProxy(options: ProxyOptions): Promise<ProxyHandle> {
  const allowed = options.allowedHosts;
  const onDecision = options.onDecision;

  const debug = process.env.WD_SANDBOX_PROXY_DEBUG === "1";
  const log = (...args: unknown[]) => {
    if (debug) console.error("[sandbox-proxy]", ...args);
  };

  const server: Server = createServer();
  server.on("error", (err) => log("server error", err.message));
  server.on("listening", () => log("server listening"));
  server.on("connection", (client: Socket) => {
    log("client connected", client.remoteAddress, client.remotePort);
    let initial = Buffer.alloc(0);

    const handleHead = (head: Buffer) => {
      const text = head.toString("utf-8");
      const firstLineEnd = text.indexOf("\r\n");
      const firstLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd);

      if (firstLine.startsWith("CONNECT ")) {
        // CONNECT host:port HTTP/1.1
        const target = firstLine.split(/\s+/)[1] ?? "";
        const parsed = parseHostPort(target, 443);
        const decision: ProxyDecision = {
          ts: new Date().toISOString(),
          outcome: parsed && hostMatches(parsed.host, allowed) ? "allow" : "deny",
          host: parsed?.host ?? "?",
          port: parsed?.port ?? 0,
          protocol: "http-connect",
        };
        onDecision?.(decision);
        if (decision.outcome === "deny") {
          client.write(denyResponse(`Outbound to ${decision.host}:${decision.port} not in sandbox allowlist.`));
          client.end();
          return;
        }
        const upstream = netConnect(decision.port, decision.host, () => {
          client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          client.pipe(upstream);
          upstream.pipe(client);
        });
        upstream.on("error", () => client.end());
        client.on("error", () => upstream.end());
        return;
      }

      // Plain HTTP forward proxy: GET http://host/path HTTP/1.1
      const match = firstLine.match(/^([A-Z]+)\s+(\S+)\s+HTTP\/1\.[01]$/);
      if (!match) {
        client.end(denyResponse("Malformed proxy request."));
        return;
      }
      const [, , urlOrPath] = match;
      let host = "";
      let port = 80;
      try {
        const url = new URL(urlOrPath!);
        host = url.hostname;
        port = url.port ? Number.parseInt(url.port, 10) : url.protocol === "https:" ? 443 : 80;
      } catch {
        // Try Host header
        const hostHeader = text.match(/\r\nHost:\s*(.+)\r\n/i)?.[1]?.trim();
        const parsed = hostHeader ? parseHostPort(hostHeader, 80) : undefined;
        if (!parsed) {
          client.end(denyResponse("Could not determine target host from proxy request."));
          return;
        }
        host = parsed.host;
        port = parsed.port;
      }
      const decision: ProxyDecision = {
        ts: new Date().toISOString(),
        outcome: hostMatches(host, allowed) ? "allow" : "deny",
        host,
        port,
        protocol: "http-forward",
      };
      onDecision?.(decision);
      if (decision.outcome === "deny") {
        client.end(denyResponse(`Outbound to ${host}:${port} not in sandbox allowlist.`));
        return;
      }
      const upstream = netConnect(port, host, () => {
        upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on("error", () => client.end());
      client.on("error", () => upstream.end());
    };

    client.on("data", (chunk: Buffer) => {
      initial = Buffer.concat([initial, chunk]);
      // Wait until we have at least the request line + headers terminator.
      const headerEnd = initial.indexOf("\r\n\r\n");
      if (headerEnd === -1 && initial.length < 8192) return;
      client.removeAllListeners("data");
      handleHead(headerEnd === -1 ? initial : initial.slice(0, headerEnd + 4));
      const remainder = headerEnd === -1 ? Buffer.alloc(0) : initial.slice(headerEnd + 4);
      if (remainder.length > 0) client.emit("data", remainder);
    });
    client.on("error", () => { /* ignore */ });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Sandbox proxy failed to bind a port.");
  }
  const port = address.port;
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    stop: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
