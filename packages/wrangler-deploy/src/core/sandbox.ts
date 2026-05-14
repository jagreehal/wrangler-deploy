import { execSync, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultAllowedHosts, startSandboxProxy, type ProxyDecision } from "./sandbox-proxy.js";

export type SandboxKind = "sandbox-exec" | "bwrap" | "refusal-only" | "unsupported";

export interface SandboxCapabilities {
  platform: NodeJS.Platform;
  kind: SandboxKind;
  available: boolean;
  binary?: string;
  notes: string[];
  /** Outbound hosts the sandbox profile keeps open. */
  allowedHosts: string[];
  /** Filesystem locations writable inside the sandbox. */
  writableRoots: string[];
}

const ALLOWED_HOSTS = [
  "api.cloudflare.com",
  "dash.cloudflare.com",
  "registry.npmjs.org",
  "github.com",
  "objects.githubusercontent.com",
  "127.0.0.1",
  "localhost",
];

function which(binary: string): string | undefined {
  try {
    const result = execSync(`command -v ${binary}`, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return result || undefined;
  } catch {
    return undefined;
  }
}

export function detectSandboxCapabilities(): SandboxCapabilities {
  const platform = process.platform;
  const writableRoots = [
    process.cwd(),
    join(process.cwd(), ".wrangler-deploy"),
    join(process.cwd(), "node_modules"),
    "/tmp",
  ];

  if (platform === "darwin") {
    const sandboxExec = which("sandbox-exec");
    return {
      platform,
      kind: sandboxExec ? "sandbox-exec" : "refusal-only",
      available: Boolean(sandboxExec),
      ...(sandboxExec ? { binary: sandboxExec } : {}),
      notes: sandboxExec
        ? [
            "Using macOS sandbox-exec. Filesystem writes are restricted to PWD/tmp at the kernel level.",
            "Outbound TCP is restricted to the local proxy port at the kernel level — raw TCP that bypasses HTTP_PROXY is denied with 'Operation not permitted'.",
          ]
        : ["sandbox-exec not found on PATH. Falling back to declarative refusal mode."],
      allowedHosts: ALLOWED_HOSTS,
      writableRoots,
    };
  }

  if (platform === "linux") {
    const bwrap = which("bwrap");
    return {
      platform,
      kind: bwrap ? "bwrap" : "refusal-only",
      available: Boolean(bwrap),
      ...(bwrap ? { binary: bwrap } : {}),
      notes: bwrap
        ? [
            "Using bubblewrap (bwrap). Filesystem writes restricted to PWD/tmp via new mount namespace.",
            "Default: shared host network with HTTP_PROXY filtering — raw TCP can bypass the proxy. Pass --strict-network to drop network entirely (`--unshare-net`).",
          ]
        : ["bwrap not found. Install bubblewrap for true isolation, or fall back to declarative refusal mode."],
      allowedHosts: ALLOWED_HOSTS,
      writableRoots,
    };
  }

  return {
    platform,
    kind: "unsupported",
    available: false,
    notes: ["Real sandbox not supported on this platform. Use AGENT_SANDBOX=1 for declarative refusal mode only."],
    allowedHosts: [],
    writableRoots,
  };
}

function macSandboxProfile(writableRoots: string[], proxyPort?: number): string {
  const writeRules = writableRoots
    .map((root) => `  (allow file-write* (subpath "${resolve(root)}"))`)
    .join("\n");

  // Network section. Two modes:
  //   - With proxy: deny all outbound EXCEPT TCP to 127.0.0.1:proxyPort. Raw TCP, raw UDP,
  //     and any HTTP_PROXY-bypassing tool gets denied at the kernel. DNS resolution on macOS
  //     goes via mDNSResponder (mach IPC), not network sockets, so it still works.
  //   - Without proxy: allow broad outbound (--no-network-filter mode).
  const networkRules = proxyPort
    ? `;; Network: deny all outbound by default; only the local sandbox proxy is reachable.
;; sandbox-exec only accepts "localhost" or "*" as the host literal, so we filter by port.
(allow network-bind)
(allow network-inbound (local ip))
(allow network-outbound (remote ip "localhost:${proxyPort}"))
;; UNIX domain sockets (mDNS, system services).
(allow network-outbound (remote unix-socket))
`
    : `;; Network: outbound unrestricted (--no-network-filter).
(allow network-bind)
(allow network-inbound (local ip))
(allow network-outbound)
`;

  return `(version 1)
(deny default)

;; Reads: allow broad read access. The sandbox is about preventing writes/network egress, not blinding the CLI.
(allow file-read*)
(allow file-read-metadata)

;; Process: allow forking + executing local binaries (we still need node, wrangler, git, etc.)
(allow process*)
(allow sysctl*)
(allow signal (target self))
(allow mach-lookup)
(allow ipc-posix-shm)

;; Writes: only into the project tree + tmp.
${writeRules}
  (allow file-write* (subpath "/tmp"))
  (allow file-write* (subpath "/private/tmp"))
  (allow file-write* (subpath "/var/folders"))

${networkRules}`;
}

export interface RunInSandboxOptions {
  /** Hostnames the proxy will tunnel/forward. Falls back to defaults. Pass [] to disable filtering. */
  allowedHosts?: string[];
  /** Disable the network proxy entirely (allow direct outbound). */
  noNetworkFilter?: boolean;
  /**
   * On Linux, drop network entirely (`--unshare-net`). The inner command will have no network at
   * all — useful for fully-offline operations. Has no effect on macOS where the proxy is the only
   * egress already.
   */
  strictNetwork?: boolean;
  /** Optional callback for every proxy decision. */
  onProxyDecision?: (decision: ProxyDecision) => void;
}

export interface RunInSandboxResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  used: SandboxKind;
  command: string[];
  notes: string[];
  proxy?: { url: string; port: number; allowedHosts: string[] };
}

export async function runInSandbox(
  commandArgs: string[],
  capabilities: SandboxCapabilities,
  options: RunInSandboxOptions = {},
): Promise<RunInSandboxResult> {
  if (!capabilities.available) {
    return {
      status: null,
      signal: null,
      used: capabilities.kind,
      command: commandArgs,
      notes: ["Sandbox unavailable on this platform; refusing to run."],
    };
  }

  // Optionally start the network-filtering proxy. Inner command's HTTPS_PROXY/HTTP_PROXY env vars
  // are pointed at it. Hostnames not on the allowlist are rejected with a 403 envelope.
  // If strictNetwork is set on Linux, the proxy is unreachable from the namespace anyway —
  // skip it entirely so we don't burn a port for nothing.
  const allowedHosts = options.allowedHosts ?? defaultAllowedHosts();
  const skipProxy = options.noNetworkFilter
    || allowedHosts.length === 0
    || (options.strictNetwork && capabilities.kind === "bwrap");
  const proxy = skipProxy
    ? undefined
    : await startSandboxProxy({
        allowedHosts,
        ...(options.onProxyDecision ? { onDecision: options.onProxyDecision } : {}),
      });

  const proxyEnv: Record<string, string> = proxy
    ? {
        HTTPS_PROXY: proxy.url,
        HTTP_PROXY: proxy.url,
        https_proxy: proxy.url,
        http_proxy: proxy.url,
        WD_SANDBOX_PROXY: proxy.url,
      }
    : {};

  const stopProxy = async () => {
    if (proxy) {
      try { await proxy.stop(); } catch { /* best-effort */ }
    }
  };

  // Use async spawn (not spawnSync) so the proxy event loop stays responsive.
  const runChild = (binary: string, childArgs: string[], env: NodeJS.ProcessEnv): Promise<{ status: number | null; signal: NodeJS.Signals | null }> => {
    return new Promise((resolve) => {
      const child = spawn(binary, childArgs, { stdio: "inherit", env });
      child.on("close", (status, signal) => resolve({ status, signal }));
      child.on("error", () => resolve({ status: 1, signal: null }));
    });
  };

  try {
    if (capabilities.kind === "sandbox-exec") {
      const profile = macSandboxProfile(capabilities.writableRoots, proxy?.port);
      const tmp = mkdtempSync(join(tmpdir(), "wd-sandbox-"));
      const profilePath = join(tmp, "profile.sb");
      writeFileSync(profilePath, profile);
      const result = await runChild(
        capabilities.binary!,
        ["-f", profilePath, ...commandArgs],
        { ...process.env, AGENT_SANDBOX: "1", WD_SANDBOX_KIND: "sandbox-exec", ...proxyEnv },
      );
      return {
        status: result.status,
        signal: result.signal,
        used: "sandbox-exec",
        command: [capabilities.binary!, "-f", profilePath, ...commandArgs],
        notes: [
          ...capabilities.notes,
          ...(proxy ? [`Outbound HTTP(S) restricted via local proxy at ${proxy.url}.`] : ["Outbound network filtering disabled."]),
        ],
        ...(proxy ? { proxy: { url: proxy.url, port: proxy.port, allowedHosts } } : {}),
      };
    }

    if (capabilities.kind === "bwrap") {
      const cwd = process.cwd();
      const home = process.env.HOME ?? "/tmp";
      // strictNetwork drops outbound network entirely. Otherwise share the host network namespace
      // and rely on the HTTP_PROXY env var (which can be bypassed by raw-TCP tools — documented).
      const networkArgs = options.strictNetwork ? ["--unshare-net"] : ["--share-net"];
      const bwrapArgs = [
        "--ro-bind", "/", "/",
        "--bind", cwd, cwd,
        "--bind", "/tmp", "/tmp",
        "--proc", "/proc",
        "--dev", "/dev",
        ...networkArgs,
        "--die-with-parent",
        "--unshare-pid",
        "--unshare-uts",
        "--unshare-ipc",
        "--setenv", "AGENT_SANDBOX", "1",
        "--setenv", "WD_SANDBOX_KIND", "bwrap",
        "--setenv", "HOME", home,
        ...(proxy ? [
          "--setenv", "HTTPS_PROXY", proxy.url,
          "--setenv", "HTTP_PROXY", proxy.url,
          "--setenv", "https_proxy", proxy.url,
          "--setenv", "http_proxy", proxy.url,
        ] : []),
        "--",
        ...commandArgs,
      ];
      const result = await runChild(capabilities.binary!, bwrapArgs, process.env);
      return {
        status: result.status,
        signal: result.signal,
        used: "bwrap",
        command: [capabilities.binary!, ...bwrapArgs],
        notes: [
          ...capabilities.notes,
          ...(proxy ? [`Outbound HTTP(S) restricted via local proxy at ${proxy.url}.`] : ["Outbound network filtering disabled."]),
        ],
        ...(proxy ? { proxy: { url: proxy.url, port: proxy.port, allowedHosts } } : {}),
      };
    }

    return {
      status: null,
      signal: null,
      used: capabilities.kind,
      command: commandArgs,
      notes: ["Sandbox unavailable on this platform; refusing to run."],
    };
  } finally {
    await stopProxy();
  }
}
