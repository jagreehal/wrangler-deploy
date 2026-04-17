// src/cloudflare/protected.ts
import type { AccountConfig } from "usage-guard-shared";

export function isProtected(args: {
  scriptName: string;
  guardScriptName: string;
  account: AccountConfig;
  runtimeProtected?: Set<string>;
}): boolean {
  if (args.scriptName === args.guardScriptName) return true;
  if (args.runtimeProtected?.has(`${args.account.accountId}:${args.scriptName}`)) return true;
  if (args.account.globalProtected.includes(args.scriptName)) return true;
  const w = args.account.workers.find((x) => x.scriptName === args.scriptName);
  return w?.protected === true;
}
