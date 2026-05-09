import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveWatchTargets, startWatch, type WatchHandle } from "./watch.js";

/**
 * fs.watch is unreliable on macOS for atomic editor writes, so we inject
 * a fake via watchFn rather than racing a real filesystem.
 */

interface FakeWatcher {
  fire(): void;
  close(): void;
  closed: boolean;
}

function makeWatchFn() {
  const watchers: FakeWatcher[] = [];
  const fn = (_path: unknown, _options: unknown, listener: (...args: unknown[]) => void) => {
    const emitter = new EventEmitter();
    emitter.on("change", listener);
    const watcher: FakeWatcher = {
      closed: false,
      fire: () => emitter.emit("change", "change", "x"),
      close: () => { watcher.closed = true; },
    };
    watchers.push(watcher);
    return { close: () => watcher.close() } as never;
  };
  return { fn: fn as never, watchers };
}

let tmpDir: string;
const handles: WatchHandle[] = [];

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "wd-watch-"));
});
afterEach(() => {
  for (const handle of handles) handle.close();
  handles.length = 0;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("resolveWatchTargets", () => {
  it("includes the wrangler-deploy.config files", () => {
    const targets = resolveWatchTargets("/repo", []);
    expect(targets).toContain("/repo/wrangler-deploy.config.ts");
    expect(targets).toContain("/repo/wrangler-deploy.config.js");
  });

  it("includes wrangler config files for each worker path", () => {
    const targets = resolveWatchTargets("/repo", ["apps/api"]);
    expect(targets).toContain("/repo/apps/api/wrangler.jsonc");
    expect(targets).toContain("/repo/apps/api/wrangler.json");
    expect(targets).toContain("/repo/apps/api/wrangler.toml");
  });
});

describe("startWatch", () => {
  it("debounces rapid events into a single onChange call", async () => {
    const path = resolve(tmpDir, "config.ts");
    writeFileSync(path, "v1");
    const { fn, watchers } = makeWatchFn();
    const onChange = vi.fn();

    const handle = startWatch({
      paths: [path],
      debounceMs: 20,
      onChange,
      watchFn: fn,
    });
    handles.push(handle);

    watchers[0]!.fire();
    watchers[0]!.fire();
    watchers[0]!.fire();

    await new Promise((res) => setTimeout(res, 60));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("queues a follow-up run when changes arrive while onChange is in flight", async () => {
    const path = resolve(tmpDir, "config.ts");
    writeFileSync(path, "v1");
    const { fn, watchers } = makeWatchFn();

    let resolveCurrent: (() => void) | undefined;
    const onChange = vi.fn().mockImplementation(
      () =>
        new Promise<void>((res) => {
          resolveCurrent = res;
        }),
    );

    const handle = startWatch({
      paths: [path],
      debounceMs: 5,
      onChange,
      watchFn: fn,
    });
    handles.push(handle);

    watchers[0]!.fire();
    await new Promise((res) => setTimeout(res, 20));
    expect(onChange).toHaveBeenCalledTimes(1);

    watchers[0]!.fire();
    await new Promise((res) => setTimeout(res, 20));
    expect(onChange).toHaveBeenCalledTimes(1);

    resolveCurrent?.();
    await new Promise((res) => setTimeout(res, 30));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("skips missing paths without throwing", () => {
    const handle = startWatch({
      paths: [resolve(tmpDir, "does-not-exist")],
      onChange: () => {},
    });
    handles.push(handle);
    expect(() => handle.close()).not.toThrow();
  });

  it("close() releases every underlying watcher", () => {
    const path = resolve(tmpDir, "config.ts");
    writeFileSync(path, "v1");
    const { fn, watchers } = makeWatchFn();
    const handle = startWatch({ paths: [path], debounceMs: 10, onChange: () => {}, watchFn: fn });
    handle.close();
    expect(watchers[0]!.closed).toBe(true);
  });
});
