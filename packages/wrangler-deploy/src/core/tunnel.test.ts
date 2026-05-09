import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { extractTunnelUrl, startTunnel } from "./tunnel.js";

class FakeStream extends EventEmitter {}

class FakeChild extends EventEmitter {
  stdout = new FakeStream();
  stderr = new FakeStream();
  exitCode: number | null = null;
  killed = false;
  pid = 1234;
  kill(signal?: string): boolean {
    this.killed = true;
    setTimeout(() => {
      this.exitCode = signal === "SIGKILL" ? 137 : 0;
      this.emit("exit", this.exitCode);
    }, 0);
    return true;
  }
}

describe("extractTunnelUrl", () => {
  it("finds trycloudflare.com URLs in mixed log lines", () => {
    expect(
      extractTunnelUrl("INF |  https://round-fox-42.trycloudflare.com  |"),
    ).toBe("https://round-fox-42.trycloudflare.com");
  });

  it("returns undefined when no URL is present", () => {
    expect(extractTunnelUrl("INF Starting tunnel")).toBeUndefined();
  });

  it("only matches trycloudflare.com hosts", () => {
    expect(extractTunnelUrl("https://example.com")).toBeUndefined();
  });
});

describe("startTunnel", () => {
  it("resolves with the public URL when cloudflared announces it on stdout", async () => {
    const fake = new FakeChild();
    const handle = startTunnel({
      localUrl: "http://localhost:8787",
      spawnFn: (() => fake) as never,
    });

    setTimeout(() => {
      fake.stdout.emit("data", "starting...\n");
      fake.stdout.emit("data", "INF |  https://blue-cat-7.trycloudflare.com\n");
    }, 0);

    await expect(handle.url).resolves.toBe("https://blue-cat-7.trycloudflare.com");
    await handle.close();
  });

  it("also picks up the URL from stderr (cloudflared logs there)", async () => {
    const fake = new FakeChild();
    const handle = startTunnel({
      localUrl: "http://localhost:8787",
      spawnFn: (() => fake) as never,
    });
    setTimeout(() => fake.stderr.emit("data", "https://stderr-host.trycloudflare.com"), 0);
    await expect(handle.url).resolves.toBe("https://stderr-host.trycloudflare.com");
    await handle.close();
  });

  it("rejects with a friendly error when cloudflared is not on PATH", async () => {
    const fake = new FakeChild();
    const handle = startTunnel({
      localUrl: "http://localhost:8787",
      spawnFn: (() => fake) as never,
    });
    const err = Object.assign(new Error("spawn cloudflared ENOENT"), { code: "ENOENT" });
    setTimeout(() => fake.emit("error", err), 0);
    await expect(handle.url).rejects.toThrow(/cloudflared not found/);
  });

  it("rejects when cloudflared exits before announcing a URL", async () => {
    const fake = new FakeChild();
    const handle = startTunnel({
      localUrl: "http://localhost:8787",
      spawnFn: (() => fake) as never,
    });
    setTimeout(() => fake.emit("exit", 1), 0);
    await expect(handle.url).rejects.toThrow(/cloudflared exited/);
  });

  it("rejects on timeout", async () => {
    vi.useFakeTimers();
    const fake = new FakeChild();
    const handle = startTunnel({
      localUrl: "http://localhost:8787",
      timeoutMs: 100,
      spawnFn: (() => fake) as never,
    });
    vi.advanceTimersByTime(101);
    await expect(handle.url).rejects.toThrow(/timed out/);
    vi.useRealTimers();
  });
});
