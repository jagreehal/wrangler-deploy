/**
 * Command registry — the single sitemap of every `wd` command.
 *
 * Built on top of the manifest in `core/cli-manifest.ts` (which already
 * captures flags / traits) and augments it with the data that `wd actions`
 * needs: a human category, sample invocations, and a list of follow-up
 * commands ("next"). The same registry powers `wd actions`, `wd help`, and
 * the JSON sitemap consumed by agents.
 *
 * If a command exists in the manifest but is missing from `commandsExtras`,
 * `actions` will still list it — just with empty examples/next. The registry
 * test (`registry.test.ts`) enforces that every manifest command appears.
 */

import { cliManifest, type CliCommandManifest } from "../core/cli-manifest.js";
import { getExamples } from "../core/examples.js";

export type ActionCategory =
  | "lifecycle"
  | "infra"
  | "observability"
  | "debug"
  | "auth"
  | "project"
  | "meta";

export interface RegistryFlag {
  name: string;
  required?: boolean;
  description?: string;
}

export interface RegistryAction {
  name: string;
  summary: string;
  category: ActionCategory;
  requires: {
    state: boolean;
    login: boolean;
    stage: boolean;
  };
  flags: RegistryFlag[];
  examples: string[];
  /** Suggested follow-up command names (resolvable to other registry entries). */
  next: string[];
  mutating: boolean;
  subcommands: string[];
}

/**
 * Per-command augmentation: category + suggested follow-ups + flag docs.
 * Keep entries terse; long-form docs live in `wd explain <concept>`.
 */
const commandsExtras: Record<
  string,
  {
    category: ActionCategory;
    next?: string[];
    flagDocs?: Record<string, { required?: boolean; description?: string }>;
  }
> = {
  init: { category: "project", next: ["plan", "apply"] },
  create: { category: "project", next: ["init", "apply"] },
  introspect: { category: "project", next: ["init", "plan"] },

  plan: { category: "lifecycle", next: ["apply"], flagDocs: { "--stage": { required: true, description: "Target stage" } } },
  apply: { category: "lifecycle", next: ["deploy", "status"], flagDocs: { "--stage": { required: true, description: "Target stage" } } },
  deploy: { category: "lifecycle", next: ["status", "tail", "verify"], flagDocs: { "--stage": { required: true, description: "Target stage" } } },
  up: { category: "lifecycle", next: ["status", "tail"], flagDocs: { "--stage": { required: true, description: "Target stage" } } },
  destroy: { category: "lifecycle", next: ["status"], flagDocs: { "--stage": { required: true, description: "Target stage" } } },
  rollback: { category: "lifecycle", next: ["status", "history"] },
  gc: { category: "lifecycle", next: ["status"] },

  status: { category: "observability", next: ["plan", "tail", "history"] },
  verify: { category: "observability", next: ["status"] },
  graph: { category: "observability", next: ["status", "plan"] },
  impact: { category: "observability", next: ["plan"] },
  diff: { category: "observability", next: ["plan"] },
  history: { category: "observability", next: ["rollback"] },
  env: { category: "observability", next: ["apply"] },
  output: { category: "observability", next: ["status"] },
  state: { category: "observability", next: ["status"] },
  "release-note": { category: "observability" },

  dev: { category: "debug", next: ["tail", "logs"] },
  tail: { category: "debug", next: ["logs", "status"] },
  logs: { category: "debug", next: ["tail"] },
  cron: { category: "debug" },
  fixture: { category: "debug" },
  worker: { category: "debug" },
  replay: { category: "debug" },
  route: { category: "infra" },
  d1: { category: "infra", next: ["apply", "deploy"] },
  queue: { category: "infra" },
  guard: { category: "infra" },
  secrets: { category: "infra", next: ["deploy"] },
  snapshot: { category: "debug" },
  sandbox: { category: "debug" },

  doctor: { category: "debug", next: ["plan", "apply"] },
  check: { category: "debug", next: ["apply"] },
  preflight: { category: "debug", next: ["deploy"] },
  explain: { category: "meta", next: ["doctor"] },
  examples: { category: "meta" },
  schema: { category: "meta" },
  tools: { category: "meta" },
  context: { category: "project", next: ["status"] },
  macro: { category: "meta" },
  open: { category: "observability" },
  dashboard: { category: "observability" },
  ci: { category: "project" },
  completions: { category: "meta" },

  configure: { category: "auth", next: ["login", "auth", "doctor"] },
  login: { category: "auth", next: ["auth", "doctor"] },
  logout: { category: "auth" },
  auth: { category: "auth", next: ["doctor"] },
  profile: { category: "auth" },
  bootstrap: { category: "auth", next: ["plan", "apply"] },
  quickstart: { category: "meta", next: ["init", "apply"] },
  telemetry: { category: "meta" },
  version: { category: "meta" },
  "upgrade-check": { category: "meta" },
  "rotate-password": { category: "auth" },
  util: { category: "meta" },
  lock: { category: "infra" },
  run: { category: "lifecycle" },
  onboard: { category: "meta", next: ["init", "apply"] },
  help: { category: "meta" },
  actions: { category: "meta", next: ["help"] },
};

function buildAction(manifest: CliCommandManifest): RegistryAction {
  const extras = commandsExtras[manifest.name] ?? { category: "meta" as ActionCategory };
  const exampleSet = getExamples(manifest.name);
  const examples = exampleSet?.examples.map((entry) => entry.command) ?? [];
  const flagDocs = extras.flagDocs ?? {};
  const flags: RegistryFlag[] = (manifest.flags ?? []).map((name) => ({
    name,
    ...(flagDocs[name] ?? {}),
  }));
  return {
    name: manifest.name,
    summary: manifest.description,
    category: extras.category,
    requires: {
      state: Boolean(manifest.requiresStage),
      login: Boolean(manifest.requiresAuth),
      stage: Boolean(manifest.requiresStage),
    },
    flags,
    examples,
    next: extras.next ?? [],
    mutating: Boolean(manifest.mutating),
    subcommands: manifest.subcommands ?? [],
  };
}

/**
 * The `actions` command is not in the manifest (it's the new sitemap itself);
 * we synthesize an entry for it here so it shows up in its own listing.
 */
const SYNTHETIC_ACTIONS: CliCommandManifest[] = [
  {
    name: "actions",
    description: "List every wd command (the sitemap). Output is the same data wd consumes internally.",
    flags: ["--json", "--category"],
    output: "json",
  },
];

const ALL_MANIFEST: CliCommandManifest[] = [
  ...cliManifest.commands,
  ...SYNTHETIC_ACTIONS,
];

export function getRegistry(): RegistryAction[] {
  return ALL_MANIFEST.map(buildAction);
}

export function getRegistryByCategory(): Record<ActionCategory, RegistryAction[]> {
  const grouped = {
    lifecycle: [],
    infra: [],
    observability: [],
    debug: [],
    auth: [],
    project: [],
    meta: [],
  } as Record<ActionCategory, RegistryAction[]>;
  for (const action of getRegistry()) {
    grouped[action.category].push(action);
  }
  return grouped;
}

export function findAction(name: string): RegistryAction | undefined {
  return getRegistry().find((entry) => entry.name === name);
}

export const CATEGORY_ORDER: ActionCategory[] = [
  "lifecycle",
  "infra",
  "observability",
  "debug",
  "auth",
  "project",
  "meta",
];
