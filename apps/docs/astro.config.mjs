import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import astroMermaid from "astro-mermaid";

export default defineConfig({
  base: "/wrangler-deploy",
  integrations: [
    astroMermaid(),
    starlight({
      title: "wrangler-deploy",
      customCss: ["./src/styles/landing.css"],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/jagreehal/wrangler-deploy",
        },
      ],
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Introduction", slug: "getting-started/introduction" },
            { label: "Quick Start", slug: "getting-started/quick-start" },
            { label: "How It Works", slug: "getting-started/how-it-works" },
            { label: "Migrating an Existing Project", slug: "getting-started/migrating" },
          ],
        },
        {
          label: "Resources",
          items: [
            { label: "D1 Database", slug: "resources/d1" },
            { label: "KV Namespace", slug: "resources/kv" },
            { label: "Queue", slug: "resources/queue" },
            { label: "Hyperdrive", slug: "resources/hyperdrive" },
            { label: "R2 Bucket", slug: "resources/r2" },
            { label: "Service Bindings", slug: "resources/service-bindings" },
          ],
        },
        {
          label: "Features",
          items: [
            { label: "Typed Bindings", slug: "features/typed-bindings" },
            { label: "Secrets", slug: "features/secrets" },
            { label: "Remote State", slug: "features/remote-state" },
            { label: "Drift Detection", slug: "features/drift-detection" },
            { label: "Route Templating", slug: "features/route-templating" },
            { label: "Stage Protection", slug: "features/stage-protection" },
          ],
        },
        {
          label: "Workflows",
          items: [
            { label: "PR Preview Environments", slug: "workflows/pr-previews" },
            { label: "CI/CD", slug: "workflows/ci-cd" },
            { label: "Monorepo Setup", slug: "workflows/monorepo" },
            { label: "Single Worker", slug: "workflows/single-worker" },
          ],
        },
        {
          label: "CLI Reference",
          items: [
            { label: "Commands", slug: "reference/commands" },
            { label: "Config File", slug: "reference/config" },
          ],
        },
      ],
    }),
  ],
});
