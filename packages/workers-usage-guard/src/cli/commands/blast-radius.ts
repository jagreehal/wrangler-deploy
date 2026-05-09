import type { ParsedArgs } from "../parse.js";
import { loadConfig } from "../config.js";
import { boolFlag } from "../parse.js";

export const summary = "Preview which scripts a kill-switch could affect, by account";

export const help = `
wug blast-radius [--json]

Shows, for each account in wug.config.json, the scripts the guard could
detach (i.e. workers without protected:true) and the ones it cannot
(protected via globalProtected or worker-level protected:true).
`;

type Row = {
  accountId: string;
  killable: string[];
  protected: string[];
};

export async function run(args: ParsedArgs): Promise<number> {
  const config = loadConfig({ cwd: process.cwd() });
  const rows: Row[] = (config.accounts ?? []).map((a) => {
    const globalProtected = new Set(a.globalProtected ?? []);
    const killable: string[] = [];
    const guarded: string[] = [];
    for (const w of a.workers) {
      const isProtected = w.protected === true || globalProtected.has(w.scriptName);
      (isProtected ? guarded : killable).push(w.scriptName);
    }
    return { accountId: a.accountId, killable, protected: guarded };
  });

  if (boolFlag(args.flags, "json")) {
    console.log(JSON.stringify(rows, null, 2));
    return 0;
  }
  for (const r of rows) {
    console.log(`account ${r.accountId}:`);
    console.log(`  killable (${r.killable.length}): ${r.killable.join(", ") || "(none)"}`);
    console.log(`  protected (${r.protected.length}): ${r.protected.join(", ") || "(none)"}`);
  }
  return 0;
}
