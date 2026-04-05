import { defineConfig } from "wrangler-deploy";

export default defineConfig({
  version: 1,
  workers: ["workers/hello", "workers/echo"],
  resources: {},
});
