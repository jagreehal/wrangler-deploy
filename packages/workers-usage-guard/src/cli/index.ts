#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, type ParsedArgs, boolFlag } from "./parse.js";

import * as setup from "./commands/setup.js";
import * as init from "./commands/init.js";
import * as keygen from "./commands/keygen.js";
import * as doctor from "./commands/doctor.js";
import * as preflight from "./commands/preflight.js";
import * as migrate from "./commands/migrate.js";
import * as deploy from "./commands/deploy.js";
import * as destroyCmd from "./commands/destroy.js";
import * as health from "./commands/health.js";
import * as sign from "./commands/sign.js";
import * as logs from "./commands/logs.js";
import * as breaches from "./commands/breaches.js";
import * as report from "./commands/report.js";
import * as snapshots from "./commands/snapshots.js";
import * as disarm from "./commands/disarm.js";
import * as arm from "./commands/arm.js";
import * as approvals from "./commands/approvals.js";
import * as approve from "./commands/approve.js";
import * as reject from "./commands/reject.js";
import * as runtimeProtected from "./commands/runtime-protected.js";
import * as secretAudit from "./commands/secret-audit.js";
import * as diffConfig from "./commands/diff-config.js";
import * as blastRadius from "./commands/blast-radius.js";
import * as safeMode from "./commands/safe-mode.js";

type Command = {
  summary: string;
  help: string;
  run: (args: ParsedArgs) => Promise<number>;
};

const COMMANDS: Record<string, Command> = {
  setup,
  init,
  keygen,
  doctor,
  preflight,
  migrate,
  deploy,
  destroy: destroyCmd,
  health,
  sign,
  logs,
  breaches,
  report,
  snapshots,
  disarm,
  arm,
  approvals,
  approve,
  reject,
  "runtime-protected": runtimeProtected,
  "secret-audit": secretAudit,
  "diff-config": diffConfig,
  "blast-radius": blastRadius,
  "safe-mode": safeMode,
};

const GROUPS: Array<{ title: string; names: string[] }> = [
  { title: "Setup", names: ["setup", "init", "keygen", "doctor", "preflight"] },
  { title: "Deploy", names: ["migrate", "deploy", "destroy", "health", "logs"] },
  { title: "Operations", names: ["breaches", "report", "snapshots", "disarm", "arm", "approvals", "approve", "reject", "runtime-protected"] },
  { title: "Inspection", names: ["secret-audit", "diff-config", "blast-radius", "safe-mode", "sign"] },
];

function topLevelHelp(): string {
  const lines = [
    "wug — workers-usage-guard CLI",
    "",
    "Usage: wug <command> [flags]",
    "       wug <command> --help",
    "",
  ];
  for (const group of GROUPS) {
    lines.push(group.title + ":");
    const widest = Math.max(...group.names.map((n) => n.length));
    for (const name of group.names) {
      const cmd = COMMANDS[name];
      if (!cmd) continue;
      lines.push(`  ${name.padEnd(widest)}   ${cmd.summary}`);
    }
    lines.push("");
  }
  lines.push("Common flags:");
  lines.push("  --json        machine-readable output");
  lines.push("  --account     override accountId");
  lines.push("  --endpoint    override deployed guard URL");
  lines.push("  --signing-key override $GUARD_API_SIGNING_KEY");
  lines.push("");
  lines.push("Run `wug <command> --help` for command-specific help.");
  return lines.join("\n");
}

function readPackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "..", "package.json"), "utf-8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export async function runCli(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.command === "help" || parsed.command === "") {
    console.log(topLevelHelp());
    return 0;
  }
  if (parsed.command === "version") {
    console.log(readPackageVersion());
    return 0;
  }
  const cmd = COMMANDS[parsed.command];
  if (!cmd) {
    console.error(`unknown command: ${parsed.command}`);
    console.error("");
    console.error(topLevelHelp());
    return 1;
  }
  if (boolFlag(parsed.flags, "help")) {
    console.log(cmd.help.trim());
    return 0;
  }
  try {
    return await cmd.run(parsed);
  } catch (error) {
    const err = error as Error;
    console.error(`error: ${err.message}`);
    if (process.env.WUG_DEBUG === "1" && err.stack) {
      console.error(err.stack);
    }
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv).then((code) => process.exit(code));
}
