import { existsSync, watch, type FSWatcher } from "node:fs";
import { resolve } from "node:path";

/**
 * Tiny file-watcher loop for `wd apply --watch` and `wd deploy --watch`.
 *
 * We deliberately use built-in `fs.watch` rather than chokidar to avoid
 * adding a dependency. The trade-off: `fs.watch` fires multiple events for
 * a single save on most editors (atomic write -> rename), so we debounce.
 */

export interface WatchHandle {
  close(): void;
}

export interface WatchOptions {
  /** Files to watch. Missing files are skipped silently. */
  paths: string[];
  /** Debounce window in ms. Default 200. */
  debounceMs?: number;
  /** Called once for each settled change burst. */
  onChange: () => void | Promise<void>;
  /** Hook for tests. Defaults to fs.watch. */
  watchFn?: typeof watch;
}

export function startWatch(options: WatchOptions): WatchHandle {
  const debounceMs = options.debounceMs ?? 200;
  const watchImpl = options.watchFn ?? watch;
  const watchers: FSWatcher[] = [];
  let pending: NodeJS.Timeout | undefined;
  let running = false;
  let dirty = false;

  const trigger = () => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = undefined;
      void run();
    }, debounceMs);
    pending.unref?.();
  };

  const run = async () => {
    if (running) {
      dirty = true;
      return;
    }
    running = true;
    try {
      await options.onChange();
    } finally {
      running = false;
      if (dirty) {
        dirty = false;
        trigger();
      }
    }
  };

  for (const path of options.paths) {
    if (!existsSync(path)) continue;
    try {
      const watcher = watchImpl(path, { persistent: true }, () => trigger());
      watchers.push(watcher);
    } catch {
      // Some filesystems/editors race during atomic save. Best-effort.
    }
  }

  return {
    close(): void {
      if (pending) clearTimeout(pending);
      for (const watcher of watchers) {
        try {
          watcher.close();
        } catch {
          // ignore
        }
      }
    },
  };
}

/**
 * Resolve the set of files worth watching for a wrangler-deploy project.
 * Today: the wrangler-deploy.config file and every worker's wrangler.jsonc.
 */
export function resolveWatchTargets(rootDir: string, workerPaths: string[]): string[] {
  const targets = new Set<string>();
  for (const candidate of ["wrangler-deploy.config.ts", "wrangler-deploy.config.js"]) {
    targets.add(resolve(rootDir, candidate));
  }
  for (const workerPath of workerPaths) {
    for (const candidate of ["wrangler.jsonc", "wrangler.json", "wrangler.toml"]) {
      targets.add(resolve(rootDir, workerPath, candidate));
    }
  }
  return [...targets];
}
