import { describe, expect, it, vi } from "vitest";
import { story } from "executable-stories-vitest";
import { createKvNamespace } from "./kv.js";
import { createQueue } from "./queue.js";
import { createHyperdrive } from "./hyperdrive.js";
import { deleteWorker } from "./worker.js";

describe("providers", () => {
  it("adopts an existing KV namespace when create reports conflict", async ({ task }) => {
    story.init(task);

    story.given("the Cloudflare API rejects KV creation with a conflict error");
    story.and("a subsequent list call returns the existing namespace");
    const cfApiFn = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ errors: [{ code: 10014 }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: [{ id: "kv-1", title: "cache-kv" }],
          errors: [],
        }),
      });

    story.when("createKvNamespace is called");
    const result = await createKvNamespace("cache-kv", {
      apiToken: "token",
      accountId: "acc",
    }, cfApiFn);

    story.then("the existing namespace is adopted");
    expect(result).toEqual({ id: "kv-1", title: "cache-kv" });
    expect(cfApiFn).toHaveBeenNthCalledWith(
      1,
      "/storage/kv/namespaces",
      expect.any(Object),
      expect.objectContaining({ method: "POST" }),
    );
    expect(cfApiFn).toHaveBeenNthCalledWith(
      2,
      "/storage/kv/namespaces?per_page=100",
      expect.any(Object),
    );
  });

  it("adopts an existing queue when create returns conflict", async ({ task }) => {
    story.init(task);

    story.given("the Cloudflare API rejects queue creation with a 409 conflict");
    story.and("a subsequent list call returns the existing queue");
    const cfApiFn = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        text: async () => "queue already exists",
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: [{ queue_id: "q-1", queue_name: "jobs" }],
          errors: [],
        }),
      });

    story.when("createQueue is called");
    const result = await createQueue("jobs", {
      apiToken: "token",
      accountId: "acc",
    }, cfApiFn);

    story.then("the existing queue is adopted");
    expect(result).toEqual({ queue_id: "q-1", queue_name: "jobs" });
  });

  it("adopts an existing Hyperdrive config when create returns conflict", async ({ task }) => {
    story.init(task);

    story.given("the Cloudflare API rejects Hyperdrive creation with a 409 conflict");
    story.and("a subsequent list call returns the existing config");
    const cfApiFn = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        text: async () => "already exists",
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: [
            {
              id: "hd-1",
              name: "payments-db",
              origin: {
                host: "db.example.com",
                port: 5432,
                database: "payments",
                user: "app",
                scheme: "postgres",
              },
            },
          ],
          errors: [],
        }),
      });

    story.when("createHyperdrive is called");
    const result = await createHyperdrive(
      "payments-db",
      {
        host: "db.example.com",
        port: 5432,
        database: "payments",
        user: "app",
        password: "secret",
      },
      {
        apiToken: "token",
        accountId: "acc",
      },
      cfApiFn,
    );

    story.then("the existing Hyperdrive config is adopted");
    expect(result.id).toBe("hd-1");
    expect(result.name).toBe("payments-db");
  });

  it("treats worker deletion as idempotent on 404", async ({ task }) => {
    story.init(task);

    story.given("the Cloudflare API returns 404 for a worker deletion");
    const cfApiFn = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    story.when("deleteWorker is called");
    story.then("it resolves without error");
    await expect(
      deleteWorker("api-staging", { apiToken: "token", accountId: "acc" }, cfApiFn),
    ).resolves.toBeUndefined();
  });
});
