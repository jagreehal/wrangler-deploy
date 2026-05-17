import { StoryReporter } from "executable-stories-vitest/reporter";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests mock execFileSync/spawn at the unit level — they should not
    // gate on whether a real wrangler binary is installed in the test
    // environment. The wrangler-version-check has its own dedicated
    // suite that injects a fake readVersion.
    env: {
      WD_SKIP_WRANGLER_VERSION_CHECK: "1",
    },
    reporters: [
      "default",
      new StoryReporter({
        formats: ["markdown", "html"],
        outputDir: "docs/stories",
        outputName: "test-stories",
        markdown: {
          title: "wrangler-deploy Test Stories",
          includeStatusIcons: true,
          includeErrors: true,
        },
      }),
    ],
  },
});
