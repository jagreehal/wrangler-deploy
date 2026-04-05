import { StoryReporter } from "executable-stories-vitest/reporter";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
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
