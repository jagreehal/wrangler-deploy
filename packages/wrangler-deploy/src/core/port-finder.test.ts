import { describe, it, expect } from "vitest";
import { createServer } from "node:net";
import { story } from "executable-stories-vitest";
import { findAvailablePorts } from "./port-finder.js";

function occupyPort(port: number): Promise<ReturnType<typeof createServer>> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.once("listening", () => resolve(server));
    server.listen(port, "127.0.0.1");
  });
}

describe("findAvailablePorts", () => {
  it("returns the requested number of unique ports", async ({ task }) => {
    story.init(task);
    story.given("a request for 3 available ports starting at 19200");

    const ports = await findAvailablePorts(19200, 3);

    story.then("3 unique ports are returned, all >= 19200");
    expect(ports).toHaveLength(3);
    expect(new Set(ports).size).toBe(3);
    for (const port of ports) {
      expect(port).toBeGreaterThanOrEqual(19200);
    }
  });

  it("skips ports that are already in use", async ({ task }) => {
    story.init(task);
    story.given("port 19300 is occupied by another process");

    const blocker = await occupyPort(19300);
    try {
      const ports = await findAvailablePorts(19300, 2);

      story.then("the occupied port is skipped");
      expect(ports).not.toContain(19300);
      expect(ports).toHaveLength(2);
      expect(ports[0]).toBeGreaterThanOrEqual(19301);
    } finally {
      blocker.close();
    }
  });

  it("skips ports in the exclude set", async ({ task }) => {
    story.init(task);
    story.given("ports 19400 and 19401 are in the exclude set");

    const exclude = new Set([19400, 19401]);
    const ports = await findAvailablePorts(19400, 2, exclude);

    story.then("excluded ports are skipped even if they are free");
    expect(ports).not.toContain(19400);
    expect(ports).not.toContain(19401);
    expect(ports).toHaveLength(2);
    expect(ports[0]).toBeGreaterThanOrEqual(19402);
  });
});
