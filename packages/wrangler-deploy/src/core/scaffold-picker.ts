import { cancel, intro, isCancel, outro, select, text } from "@clack/prompts";
import type { TemplateManifest } from "./scaffold.js";

export interface PickerInputs {
  /** Project directory (positional arg). May be undefined → prompt for it. */
  initialDir?: string;
  /** Template name (positional arg or --template). May be undefined → prompt. */
  initialTemplate?: string;
  /** Available templates from the manifest (excluding the inline `hello`). */
  manifest: TemplateManifest;
  /** When true, skip prompts and accept defaults silently. Set by `--yes`, non-TTY, or CI. */
  nonInteractive: boolean;
}

export interface PickerOutputs {
  /** Final project directory chosen. Always relative to cwd. */
  dir: string;
  /** Either "hello" (inline) or one of the manifest template names. */
  template: string;
}

const DEFAULT_DIR = "my-worker";
const DEFAULT_TEMPLATE = "hello";

/**
 * Run the create-wrangler-deploy interactive picker. Two phases:
 *   1. Resolve project directory (prompt if missing).
 *   2. Resolve template (prompt if missing — with `hello` as the default).
 *
 * In non-interactive mode (`--yes`, CI, no TTY) we silently fill defaults
 * from the inputs and skip every prompt. This is the contract that lets
 * `npx create-wrangler-deploy --yes my-app` work in scripts and CI.
 */
export async function runPicker(inputs: PickerInputs): Promise<PickerOutputs> {
  if (inputs.nonInteractive) {
    return {
      dir: inputs.initialDir ?? DEFAULT_DIR,
      template: inputs.initialTemplate ?? DEFAULT_TEMPLATE,
    };
  }

  intro("✨ wrangler-deploy — scaffold a new Cloudflare Workers project");

  let dir = inputs.initialDir;
  if (!dir) {
    const answer = await text({
      message: "Project name (used as the directory)",
      placeholder: DEFAULT_DIR,
      defaultValue: DEFAULT_DIR,
      validate: (value) => {
        if (!value) return undefined; // empty falls back to default
        if (value.includes("/") || value.includes(" ")) return "No slashes or spaces, please.";
        return undefined;
      },
    });
    if (isCancel(answer)) {
      cancel("Cancelled. No files were written.");
      process.exit(0);
    }
    dir = (answer as string) || DEFAULT_DIR;
  }

  let template = inputs.initialTemplate;
  if (!template) {
    const options = [
      {
        value: "hello",
        label: "hello — Bare hello-world Worker",
        hint: "fastest, recommended for beginners",
      },
      ...inputs.manifest.templates.map((entry) => ({
        value: entry.name,
        label: `${entry.name} — ${entry.title}`,
        hint: entry.description,
      })),
    ];
    const answer = await select({
      message: "Pick a template",
      options,
      initialValue: DEFAULT_TEMPLATE,
    });
    if (isCancel(answer)) {
      cancel("Cancelled. No files were written.");
      process.exit(0);
    }
    template = answer as string;
  }

  outro(`Scaffolding ${template} into ./${dir}…`);

  return { dir, template };
}

/**
 * Detect whether the current environment can host an interactive picker.
 *
 * Non-interactive when ANY of these holds:
 *   - stdout/stdin isn't a TTY (piped, redirected, scripted)
 *   - CI=true or CI=1
 *   - `--yes` was passed (caller's responsibility to pass that in)
 *   - WD_NO_INTERACTIVE=1
 *   - AGENT_SANDBOX=1 (agent runtime)
 *
 * Tests can force a value via `WD_FORCE_INTERACTIVE=1` or `WD_NO_INTERACTIVE=1`.
 */
export function detectNonInteractive(): boolean {
  if (process.env.WD_FORCE_INTERACTIVE === "1") return false;
  if (process.env.WD_NO_INTERACTIVE === "1") return true;
  if (process.env.AGENT_SANDBOX === "1") return true;
  if (process.env.CI === "true" || process.env.CI === "1") return true;
  if (!process.stdout.isTTY || !process.stdin.isTTY) return true;
  return false;
}
