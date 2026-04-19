import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.int.ts"],
    setupFiles: ["./tests/vitest.int.setup.ts"],
    globals: true,
    environment: "node",
    testTimeout: 30_000,
    passWithNoTests: true,
  },
});
