import { execFileSync } from "node:child_process";

type ExecRunner = (command: string, args: string[]) => void;

function defaultExecRunner(command: string, args: string[]): void {
  execFileSync(command, args, { stdio: "ignore" });
}

export function getOpenCommand(platform: NodeJS.Platform): { command: string; argsPrefix: string[] } {
  if (platform === "darwin") return { command: "open", argsPrefix: [] };
  if (platform === "win32") return { command: "cmd", argsPrefix: ["/c", "start", ""] };
  return { command: "xdg-open", argsPrefix: [] };
}

export function openUrl(
  url: string,
  options: {
    platform?: NodeJS.Platform;
    runner?: ExecRunner;
  } = {},
): void {
  const platform = options.platform ?? process.platform;
  const runner = options.runner ?? defaultExecRunner;
  const { command, argsPrefix } = getOpenCommand(platform);
  runner(command, [...argsPrefix, url]);
}
