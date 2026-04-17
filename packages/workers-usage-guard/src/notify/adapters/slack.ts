import type { NotificationEvent } from "usage-guard-shared";
import type { NotificationChannel, NotifyDeps } from "../types.js";
import { err, ok, postWithTimeout } from "../types.js";

type SlackConfig = {
  name: string;
  webhookUrlSecret: string;
  minSeverity?: "warning" | "critical";
};

const SEVERITY_RANK = { info: 0, warning: 1, critical: 2 } as const;

function blocksFor(e: NotificationEvent) {
  const header = {
    type: "header",
    text: { type: "plain_text", text: headerText(e) },
  };
  const body = { type: "section", text: { type: "mrkdwn", text: bodyText(e) } };
  return [header, body];
}

function headerText(e: NotificationEvent): string {
  if (e.kind === "breach") return `:rotating_light: Workers Usage Alert [${e.severity.toUpperCase()}]`;
  if (e.kind === "daily-report") return ":chart_with_upwards_trend: Workers Usage — Daily Report";
  if (e.kind === "breach-suppressed") return ":mute: Breach suppressed";
  if (e.kind === "approval-requested") return `:warning: Approval required: ${e.scriptName}`;
  return ":information_source: Guard health";
}

function bodyText(e: NotificationEvent): string {
  if (e.kind === "breach") {
    return [
      `*Script:* \`${e.breach.breachKey}\``,
      `*Rule:* ${e.breach.ruleId}`,
      `*Routes removed:* ${e.actions.removedRoutes.length}`,
      `*Domains detached:* ${e.actions.removedDomains.length}`,
      `*Note:* workers.dev subdomain may still be reachable.`,
    ].join("\n");
  }
  if (e.kind === "daily-report") {
    const p = e.report.payload;
    const top = [...p.perWorker].sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd).slice(0, 5);
    return [
      `*Total est. cost:* $${p.totals.estimatedCostUsd.toFixed(2)}`,
      `*Savings this month:* $${p.savingsThisMonthUsd.toFixed(2)}`,
      "*Top 5:*",
      ...top.map((w) => `• ${w.scriptName}: $${w.estimatedCostUsd.toFixed(2)}`),
    ].join("\n");
  }
  if (e.kind === "breach-suppressed") return `${e.breach.breachKey} — reason: ${e.reason}`;
  if (e.kind === "approval-requested") {
    return [
      `*Approval ID:* \`${e.approvalId}\``,
      `*Script:* ${e.scriptName}`,
      `*Rule:* ${e.ruleId} (${e.breachType})`,
      `*Actual:* ${e.actualValue} / *Limit:* ${e.limitValue}`,
      `Run \`wd guard approve ${e.approvalId} --account ${e.accountId}\` to allow, or \`wd guard reject ${e.approvalId} --account ${e.accountId}\` to block.`,
    ].join("\n");
  }
  return e.details;
}

export function slackAdapter(config: SlackConfig): NotificationChannel {
  return {
    name: config.name,
    kind: "slack",
    async send({ event, dedupKey }, deps: NotifyDeps) {
      if (config.minSeverity && SEVERITY_RANK[event.severity] < SEVERITY_RANK[config.minSeverity]) {
        return ok(config.name, dedupKey, deps.clock().toISOString());
      }
      const url = deps.secrets(config.webhookUrlSecret);
      if (!url) return err(config.name, "BAD_CONFIG", `missing secret ${config.webhookUrlSecret}`);
      const v = deps.ssrf.validate(url);
      if (!v.ok) return err(config.name, "SSRF", v.reason);
      const body = JSON.stringify({ blocks: blocksFor(event) });
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
