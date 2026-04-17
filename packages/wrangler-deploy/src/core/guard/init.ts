import type { NotificationChannelConfig } from "usage-guard-shared";
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

export type GuardInitArgs = {
  accountId: string;
  billingCycleDay: number;
  workers: Array<{
    scriptName: string;
    thresholds?: { requests?: number; cpuMs?: number; costUsd?: number };
    presets?: Array<"cost-runaway" | "request-flood" | "cpu-spike">;
  }>;
  notifications: NotificationChannelConfig[];
};

export type GuardInitResult = {
  wranglerJsonc: string;
  secretsChecklist: string[];
  nextSteps: string[];
};

export function generateSigningKey(): string {
  return randomBytes(32).toString("hex");
}

export function generateGuardConfig(args: GuardInitArgs): GuardInitResult {
  const accountsJson = JSON.stringify([{
    accountId: args.accountId,
    billingCycleDay: args.billingCycleDay,
    workers: args.workers,
    globalProtected: [],
  }]);

  const notificationsJson = JSON.stringify({ channels: args.notifications });

  const notificationSecrets = args.notifications.map((n) =>
    n.type === "webhook" ? n.urlSecret : n.webhookUrlSecret
  );

  const secretsChecklist = [
    "CLOUDFLARE_API_TOKEN",
    "GUARD_API_SIGNING_KEY",
    ...notificationSecrets,
  ];

  const wranglerJsonc = `{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "workers-usage-guard",
  "main": "src/index.ts",
  "compatibility_date": "${new Date().toISOString().slice(0, 10)}",
  "compatibility_flags": ["nodejs_compat"],

  "triggers": { "crons": ["*/5 * * * *", "0 8 * * *"] },

  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "workers-usage-guard",
      "database_id": "REPLACE_WITH_D1_ID",
      "migrations_dir": "migrations"
    }
  ],

  "workflows": [
    {
      "name": "overage-workflow",
      "binding": "OVERAGE_WORKFLOW",
      "class_name": "OverageWorkflow"
    }
  ],

  "vars": {
    "REQUEST_THRESHOLD": "500000",
    "CPU_TIME_THRESHOLD_MS": "5000000",
    "OVERAGE_COOLDOWN_SECONDS": "3600",
    "OVERAGE_GRACE_SECONDS": "14400",
    "GUARD_SCRIPT_NAME": "workers-usage-guard",
    "ACCOUNTS_JSON": ${JSON.stringify(accountsJson)},
    "NOTIFICATIONS_JSON": ${JSON.stringify(notificationsJson)}
  }
}
`;

  const nextSteps = [
    `Run \`wrangler d1 create workers-usage-guard\` and replace "REPLACE_WITH_D1_ID" in wrangler.jsonc with the returned database ID.`,
    `Run \`wrangler d1 migrations apply workers-usage-guard --local\` to apply D1 migrations locally.`,
    `Set required secrets: ${secretsChecklist.map((s) => `\`wrangler secret put ${s}\``).join(", ")}.`,
    `Run \`wrangler deploy\` to deploy the guard Worker.`,
    `Add the deployed endpoint URL to \`guard.endpoint\` in your wrangler-deploy.config.ts.`,
  ];

  return { wranglerJsonc, secretsChecklist, nextSteps };
}

export type CreateD1Deps = {
  execFileSync: typeof import("node:child_process").execFileSync;
};

export function createD1Database(
  args: { name: string; targetDir: string },
  deps: CreateD1Deps
): { databaseId: string } {
  const output = deps.execFileSync("wrangler", [
    "d1", "create", args.name,
  ], { cwd: args.targetDir, encoding: "utf-8" });
  // wrangler 4.x outputs text + embedded JSON block; extract database_id
  const match = output.match(/"database_id":\s*"([^"]+)"/);
  if (!match?.[1]) {
    throw new Error("Could not parse D1 database id from wrangler output");
  }
  return { databaseId: match[1] };
}

export function updateJsoncD1Id(jsoncPath: string, databaseId: string): void {
  const content = readFileSync(jsoncPath, "utf-8");
  const updated = content.replace(
    /"database_id":\s*"REPLACE_WITH_D1_ID"/,
    `"database_id": "${databaseId}"`
  );
  writeFileSync(jsoncPath, updated);
}

