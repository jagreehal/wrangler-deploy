import type { CfStageConfig, StageState } from "../../types.js";
import { buildRichGraph } from "../graph-model.js";
import { renderMermaid } from "../renderers/mermaid.js";

export function buildPrComment(
  config: CfStageConfig,
  state: StageState,
  verifyResults?: Array<{ name: string; passed: boolean }>,
): string {
  const lines: string[] = [];

  // Header
  lines.push(`## 🚀 wrangler-deploy: \`${state.stage}\``);
  lines.push("");

  // Live URLs
  const workersWithUrls = Object.entries(state.workers).filter(([, w]) => w.url);
  if (workersWithUrls.length > 0) {
    lines.push("### Live URLs");
    lines.push("");
    for (const [path, worker] of workersWithUrls) {
      lines.push(`- **${path}**: [${worker.url}](${worker.url})`);
    }
    lines.push("");
  }

  // Mermaid topology
  const graph = buildRichGraph(config, state);
  const mermaid = renderMermaid(graph);
  lines.push("### Topology");
  lines.push("");
  lines.push("```mermaid");
  lines.push(mermaid);
  lines.push("```");
  lines.push("");

  // Resource table
  const resourceEntries = Object.entries(state.resources);
  if (resourceEntries.length > 0) {
    lines.push("### Resources");
    lines.push("");
    lines.push("| Name | Type | ID | Status |");
    lines.push("| ---- | ---- | -- | ------ |");
    for (const [name, resource] of resourceEntries) {
      const id = resource.observed.id ?? "—";
      const status = resource.observed.status;
      lines.push(`| ${name} | ${resource.type} | ${id} | ${status} |`);
    }
    lines.push("");
  }

  // Worker table
  const workerEntries = Object.entries(state.workers);
  if (workerEntries.length > 0) {
    lines.push("### Workers");
    lines.push("");
    lines.push("| Path | Name | URL |");
    lines.push("| ---- | ---- | --- |");
    for (const [path, worker] of workerEntries) {
      const url = worker.url ? `[${worker.url}](${worker.url})` : "—";
      lines.push(`| ${path} | ${worker.name} | ${url} |`);
    }
    lines.push("");
  }

  // Verification results
  if (verifyResults && verifyResults.length > 0) {
    lines.push("### Verification");
    lines.push("");
    lines.push("| Check | Result |");
    lines.push("| ----- | ------ |");
    for (const check of verifyResults) {
      const icon = check.passed ? "✅" : "❌";
      lines.push(`| ${check.name} | ${icon} |`);
    }
    lines.push("");
  }

  // Secrets status
  const secretEntries = Object.entries(state.secrets);
  if (secretEntries.length > 0) {
    lines.push("### Secrets");
    lines.push("");
    lines.push("| Worker | Secret | Status |");
    lines.push("| ------ | ------ | ------ |");
    for (const [workerPath, secretMap] of secretEntries) {
      for (const [secretName, status] of Object.entries(secretMap)) {
        lines.push(`| ${workerPath} | ${secretName} | ${status} |`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
