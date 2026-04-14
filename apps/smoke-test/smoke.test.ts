import { describe, it, expect, afterEach } from "vitest";
import { resolve, dirname } from "node:path";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildDevPlan, startDev, type DevHandle } from "wrangler-deploy";
import type { CfStageConfig } from "wrangler-deploy";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)));
const helloEntry = resolve(rootDir, "workers/hello/src/index.ts");

const config: CfStageConfig = {
  version: 1,
  workers: ["workers/hello", "workers/echo"],
  resources: {},
};

function writeHelloWorker(body: string) {
  writeFileSync(
    helloEntry,
    `export default {\n  async fetch(): Promise<Response> {\n    return new Response("${body}");\n  },\n};\n`,
  );
}

async function waitForReady(port: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server on port ${port} did not become ready within ${timeoutMs}ms`);
}

async function waitForBody(port: number, expected: string, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}`);
      const text = await res.text();
      if (text === expected) return text;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const res = await fetch(`http://localhost:${port}`);
  return res.text();
}

async function isPortListening(port: number): Promise<boolean> {
  try {
    await fetch(`http://localhost:${port}`);
    return true;
  } catch {
    return false;
  }
}

describe("wd dev smoke test", () => {
  let handle: DevHandle | undefined;

  afterEach(async () => {
    await handle?.stop();
    handle = undefined;
    writeHelloWorker("hello from wrangler-deploy");
  });

  it("starts a worker and responds to HTTP requests", async () => {
    const plan = await buildDevPlan(config, rootDir, { basePort: 8687, filter: "workers/hello" });
    handle = await startDev(plan);

    const port = handle.ports["workers/hello"]!;
    await waitForReady(port);
    const res = await fetch(`http://localhost:${port}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello from wrangler-deploy");
  }, 20_000);

  it("hot-reloads when the worker source changes", async () => {
    const plan = await buildDevPlan(config, rootDir, { basePort: 8689, filter: "workers/hello" });
    handle = await startDev(plan);

    const port = handle.ports["workers/hello"]!;
    await waitForReady(port);
    const before = await fetch(`http://localhost:${port}`);
    expect(await before.text()).toBe("hello from wrangler-deploy");

    writeHelloWorker("hot reloaded!");

    const after = await waitForBody(port, "hot reloaded!");
    expect(after).toBe("hot reloaded!");
  }, 30_000);

  it("starts both workers when no filter is specified", async () => {
    const plan = await buildDevPlan(config, rootDir, { basePort: 8691 });
    expect(plan.workers).toHaveLength(2);

    handle = await startDev(plan);

    const helloPort = handle.ports["workers/hello"]!;
    const echoPort = handle.ports["workers/echo"]!;

    await waitForReady(helloPort);
    await waitForReady(echoPort);

    const hello = await fetch(`http://localhost:${helloPort}`);
    expect(await hello.text()).toBe("hello from wrangler-deploy");

    const echo = await fetch(`http://localhost:${echoPort}/test`);
    expect(await echo.text()).toBe("echo: /test");
  }, 20_000);

  it("--filter starts only the filtered worker", async () => {
    const plan = await buildDevPlan(config, rootDir, { basePort: 8693, filter: "workers/echo" });
    expect(plan.workers).toHaveLength(1);
    expect(plan.workers[0]!.workerPath).toBe("workers/echo");

    handle = await startDev(plan);

    const echoPort = handle.ports["workers/echo"]!;
    await waitForReady(echoPort);

    const echo = await fetch(`http://localhost:${echoPort}/filtered`);
    expect(await echo.text()).toBe("echo: /filtered");

    // hello worker should NOT be running — check a likely port
    const helloUp = await isPortListening(echoPort + 1);
    expect(helloUp).toBe(false);
  }, 20_000);

  it("--filter throws for unknown worker", async () => {
    await expect(
      buildDevPlan(config, rootDir, { basePort: 8695, filter: "workers/nope" }),
    ).rejects.toThrow(/unknown worker/i);
  });
});
