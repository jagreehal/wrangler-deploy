import { execFileSync } from "node:child_process";

export function getClipboardCommand(platform: NodeJS.Platform): { command: string; args: string[] } {
  if (platform === "darwin") return { command: "pbcopy", args: [] };
  if (platform === "win32") return { command: "cmd", args: ["/c", "clip"] };
  return { command: "xclip", args: ["-selection", "clipboard"] };
}

export function copyToClipboard(value: string, platform: NodeJS.Platform = process.platform): void {
  const resolved = getClipboardCommand(platform);
  execFileSync(resolved.command, resolved.args, { input: value, stdio: ["pipe", "ignore", "ignore"] });
}
