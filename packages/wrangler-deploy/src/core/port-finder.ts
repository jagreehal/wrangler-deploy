import { createServer } from "node:net";

/**
 * Check if a TCP port is available by attempting to bind to it.
 * Returns true if the port is free, false if it's in use.
 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

/**
 * Find `count` available ports starting from `start`, skipping any in `exclude`.
 * Actually probes the OS to avoid conflicts with other running processes.
 */
export async function findAvailablePorts(
  start: number,
  count: number,
  exclude: Set<number> = new Set(),
): Promise<number[]> {
  const found: number[] = [];
  let candidate = start;

  while (found.length < count) {
    if (!exclude.has(candidate) && await isPortAvailable(candidate)) {
      found.push(candidate);
      exclude.add(candidate);
    }
    candidate++;
  }

  return found;
}
