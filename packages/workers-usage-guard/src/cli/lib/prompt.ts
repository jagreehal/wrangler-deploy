import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export async function ask(question: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    const answer = (await rl.question(`${question}${suffix}: `)).trim();
    return answer || defaultValue || "";
  } finally {
    rl.close();
  }
}

export async function confirm(question: string, defaultYes = false): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const suffix = defaultYes ? " [Y/n]" : " [y/N]";
    const answer = (await rl.question(`${question}${suffix} `)).trim();
    if (!answer) return defaultYes;
    return /^y(es)?$/i.test(answer);
  } finally {
    rl.close();
  }
}
