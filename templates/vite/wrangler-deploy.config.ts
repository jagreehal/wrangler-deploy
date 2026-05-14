import { defineConfig, kv, workerEnv } from "wrangler-deploy";

const appState = kv("app-state");

export const apiEnv = workerEnv({
  APP_STATE: appState,
});

export default defineConfig({
  version: 1,
  workers: ["workers/api"],
  resources: {
    "app-state": {
      type: "kv",
      bindings: {
        "workers/api": "APP_STATE",
      },
    },
  },
  dev: {
    endpoints: {
      api: {
        worker: "workers/api",
        path: "/api",
        method: "GET",
        description: "Starter worker API endpoint",
      },
    },
  },
  stages: {
    production: { protected: true },
    staging: { protected: true },
    "pr-*": { protected: false, ttl: "7d" },
  },
});
