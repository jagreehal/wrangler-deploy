import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "cloudflare:workers": path.resolve(
        __dirname,
        "src/test-utils/cloudflare-workers-stub.ts"
      ),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.test.int.ts", "tests/**"],
    setupFiles: ["./tests/vitest.setup.ts"],
    globals: true,
    environment: "node",
    passWithNoTests: true,
  },
});
