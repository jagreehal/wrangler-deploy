import type { NotificationEvent } from "usage-guard-shared";
import type { NotificationChannel, NotifyDeps } from "../types.js";
import { err, ok, postWithTimeout } from "../types.js";

type DiscordConfig = {
  name: string;
  webhookUrlSecret: string;
  minSeverity?: "warning" | "critical";
};

const COLOR = { info: 0x3498db, warning: 0xf1c40f, critical: 0xe74c3c } as const;
const SEVERITY_RANK = { info: 0, warning: 1, critical: 2 } as const;

function title(e: NotificationEvent): string {
  switch (e.kind) {
    case "breach": return `Workers Usage Alert [${e.severity.toUpperCase()}]`;
    case "breach-suppressed": return `Breach suppressed (${e.reason})`;
    case "daily-report": return "Workers Usage — Daily Report";
    case "deploy-guard-check": return `Guard health: ${e.result}`;
    case "approval-requested": return `Approval required: ${e.scriptName}`;
  }
}

function fieldsFor(e: NotificationEvent): Array<{ name: string; value: string; inline?: boolean }> {
  if (e.kind === "breach") {
    return [
      { name: "Script", value: e.breach.breachKey, inline: true },
      { name: "Triggered", value: e.breach.triggeredAt, inline: true },
      { name: "Rule", value: e.breach.ruleId, inline: true },
      {
        name: "Actions",
        value:
          `routes removed: ${e.actions.removedRoutes.length}\n` +
          `domains detached: ${e.actions.removedDomains.length}\n` +
          `**Note:** workers.dev subdomain may still be reachable.`,
      },
    ];
  }
  if (e.kind === "daily-report") {
    const p = e.report.payload;
    const top = [...p.perWorker].sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd).slice(0, 5);
    return [
      { name: "Total est. cost (USD)", value: p.totals.estimatedCostUsd.toFixed(2), inline: true },
      { name: "Savings this month", value: `$${p.savingsThisMonthUsd.toFixed(2)}`, inline: true },
      { name: "Top 5 workers by cost", value: top.map((w) => `• ${w.scriptName}: $${w.estimatedCostUsd.toFixed(2)}`).join("\n") || "_none_" },
    ];
  }
  if (e.kind === "breach-suppressed") {
    return [
      { name: "Script", value: e.breach.breachKey },
      { name: "Reason", value: e.reason },
    ];
  }
  if (e.kind === "approval-requested") {
    return [
      { name: "Approval ID", value: e.approvalId, inline: true },
      { name: "Script", value: e.scriptName, inline: true },
      { name: "Rule", value: e.ruleId, inline: true },
      { name: "Breach type", value: e.breachType, inline: true },
      { name: "Actual", value: String(e.actualValue), inline: true },
      { name: "Limit", value: String(e.limitValue), inline: true },
      { name: "Action", value: "Run `wd guard approve " + e.approvalId + " --account " + e.accountId + "` to allow, or `wd guard reject " + e.approvalId + " --account " + e.accountId + "` to block." },
    ];
  }
  return [{ name: "Details", value: e.details }];
}

export function discordAdapter(config: DiscordConfig): NotificationChannel {
  return {
    name: config.name,
    kind: "discord",
    async send({ event, dedupKey }, deps: NotifyDeps) {
      if (
        config.minSeverity &&
        SEVERITY_RANK[event.severity] < SEVERITY_RANK[config.minSeverity]
      ) {
        return ok(config.name, dedupKey, deps.clock().toISOString());
      }
      const url = deps.secrets(config.webhookUrlSecret);
      if (!url) return err(config.name, "BAD_CONFIG", `missing secret ${config.webhookUrlSecret}`);
      const v = deps.ssrf.validate(url);
      if (!v.ok) return err(config.name, "SSRF", v.reason);
      const body = JSON.stringify({
        embeds: [
          {
            title: title(event),
            color: COLOR[event.severity],
            timestamp: deps.clock().toISOString(),
            fields: fieldsFor(event),
          },
        ],
      });
      try {
        const res = await postWithTimeout({ url, body }, { fetch: deps.fetch });
        if (res.status < 200 || res.status >= 300) {
          return err(config.name, "NON_2XX", `HTTP ${res.status}: ${res.bodyText.slice(0, 200)}`);
        }
        return ok(config.name, dedupKey, deps.clock().toISOString());
      } catch (e) {
        const msg = (e as Error).message;
        if (/abort/i.test(msg)) return err(config.name, "TIMEOUT", msg);
        return err(config.name, "NON_2XX", msg);
      }
    },
  };
}
