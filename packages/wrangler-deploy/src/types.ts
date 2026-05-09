// ============================================================================
// Manifest types — what the user writes in wrangler-deploy.config.ts
// ============================================================================

export interface ProjectContext {
  /** Default stage when commands omit --stage. */
  stage?: string;
  /** Default fallback stage for `wd dev --filter ...` read mode. */
  fallbackStage?: string;
  /** Default base port for `wd dev`. */
  basePort?: number;
  /** Default filter for `wd dev`. */
  filter?: string;
  /** Default session mode for `wd dev`. */
  session?: boolean;
  /** Default Miniflare persistence path for `wd dev --session`. */
  persistTo?: string;
  /** Default account ID for Cloudflare auth and KV-backed state. */
  accountId?: string;
  /** Default Hyperdrive database URL when not passed on the command line. */
  databaseUrl?: string;
  /** Default state password for encrypted state. */
  statePassword?: string;
}

export type ResourceType = "kv" | "queue" | "hyperdrive" | "d1" | "r2" | "vectorize" | "dns";

export type DnsRecordType =
  | "A"
  | "AAAA"
  | "CNAME"
  | "TXT"
  | "MX";

/**
 * Declarative DNS record. Unlike workers/KV/etc, DNS records don't go
 * in wrangler.jsonc — they're managed directly via Cloudflare's DNS API.
 *
 * The `name` is the record's hostname (e.g. "api.example.com"). It's
 * stage-templated like routes: use `{stage}` to vary across stages.
 *
 * Records have no bindings — they're terminal resources. The empty
 * `bindings: {}` keeps the shape uniform with other ResourceConfigs.
 */
export interface DnsRecordConfig {
  type: DnsRecordType;
  name: string;
  content: string;
  ttl?: number;
  proxied?: boolean;
  comment?: string;
}

export interface DnsResourceConfig extends ResourceLifecycleFlags {
  type: "dns";
  zone: string;
  records: DnsRecordConfig[];
  bindings: Record<string, never>;
}

/**
 * Per-resource lifecycle hints. These are orthogonal to type-specific
 * config — every resource type accepts them.
 *
 * `adopt: true`   — on first apply for wrangler-cli managed resource types
 *                   (currently KV, Queues, Hyperdrive), if a CF resource
 *                   with the same staged name already exists, take it under
 *                   management instead of erroring. Setting adopt on an
 *                   unsupported type fails config validation and apply.
 *
 * `delete: false` — on destroy (or when removed from config), leave the
 *                   actual CF resource alone. State is still cleared so
 *                   the resource is detached from this project. Useful
 *                   for shared infrastructure or hand-offs to other tools.
 */
export interface ResourceLifecycleFlags {
  adopt?: boolean;
  delete?: false;
  /**
   * Local-dev hints. When `dev.remote: true`, `wd dev` writes
   * `experimental_remote: true` into a wrangler.dev.jsonc override so this
   * binding is fulfilled by the deployed Cloudflare resource instead of
   * miniflare's local emulation. Necessary for Vectorize, AI, and
   * Browser Rendering, which miniflare can't emulate fully.
   */
  dev?: {
    remote?: boolean;
  };
}

export interface KvResourceConfig extends ResourceLifecycleFlags {
  type: "kv";
  bindings: Record<string, string>;
}

export interface QueueProducerBinding {
  producer: string;
}

export interface QueueConsumerBinding {
  producer?: string;
  consumer: true;
}

export interface QueueDlqBinding {
  deadLetterFor: string;
}

export type QueueBinding = string | QueueProducerBinding | QueueConsumerBinding | QueueDlqBinding;

export interface QueueResourceConfig extends ResourceLifecycleFlags {
  type: "queue";
  bindings: Record<string, QueueBinding>;
}

export interface HyperdriveResourceConfig extends ResourceLifecycleFlags {
  type: "hyperdrive";
  bindings: Record<string, string>;
  database?: {
    provider: "neon";
    branchFrom: string;
  };
}

export interface D1ResourceConfig extends ResourceLifecycleFlags {
  type: "d1";
  bindings: Record<string, string>;
  /**
   * Directory holding `.sql` migration files. wrangler-deploy sorts them
   * lexicographically and applies new migrations on every `wd apply`. A
   * tracker table (`migrationsTable`, default `d1_migrations`) records
   * which have run, so re-applies are no-ops once everything is up to
   * date. Mirrors `wrangler d1 migrations apply`.
   */
  migrationsDir?: string;
  /**
   * Override the migration tracker table name. Set to `drizzle_migrations`
   * if you also use Drizzle ORM so wrangler-deploy and Drizzle share one
   * tracker.
   */
  migrationsTable?: string;
  /**
   * SQL files to import on first apply (after creation). Each file is
   * applied via `wrangler d1 execute --file`. Subsequent applies skip
   * imports — these are bootstrap data, not migrations.
   */
  importFiles?: string[];
}

export interface R2ResourceConfig extends ResourceLifecycleFlags {
  type: "r2";
  bindings: Record<string, string>;
}

export interface VectorizeResourceConfig extends ResourceLifecycleFlags {
  type: "vectorize";
  bindings: Record<string, string>;
  dimensions?: number;
  metric?: "euclidean" | "cosine" | "dot-product";
  preset?: string;
  description?: string;
}

export type ResourceConfig =
  | KvResourceConfig
  | QueueResourceConfig
  | HyperdriveResourceConfig
  | D1ResourceConfig
  | R2ResourceConfig
  | VectorizeResourceConfig
  | DnsResourceConfig;

/**
 * Declarative reference to a Cloudflare secret already present in the
 * account (e.g. set out-of-band via `wrangler secret put`). Skipped on
 * deploy and reported as `ref` in `wd secrets`.
 */
export interface SecretRef {
  name: string;
  ref: true;
}

export function isSecretRef(value: unknown): value is SecretRef {
  return typeof value === "object" && value !== null && (value as { ref?: unknown }).ref === true;
}

export function secretName(spec: string | SecretRef): string {
  return typeof spec === "string" ? spec : spec.name;
}

export interface StageRule {
  protected: boolean;
  ttl?: string;
}

export interface VerifyConfig {
  url?: string;
  expectStatus?: number;
  skipHttp?: boolean;
}

export interface LocalVerifyWorkerCheck {
  type: "worker";
  name?: string;
  worker: string;
  fixture?: string;
  endpoint?: string;
  path?: string;
  method?: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: string;
  expectStatus?: number;
  expectBodyIncludes?: string[];
  expectHeaders?: Record<string, string>;
  expectJsonIncludes?: unknown;
}

export interface LocalVerifyCronCheck {
  type: "cron";
  name?: string;
  worker: string;
  cron?: string;
  time?: string;
  expectStatus?: number;
  expectBodyIncludes?: string[];
  expectJsonIncludes?: unknown;
}

export interface LocalVerifyQueueCheck {
  type: "queue";
  name?: string;
  queue: string;
  payload?: string;
  fixture?: string;
  worker?: string;
  expectStatus?: number;
  expectBodyIncludes?: string[];
  expectJsonIncludes?: unknown;
}

export interface LocalVerifyD1Check {
  type: "d1";
  name?: string;
  database: string;
  sql?: string;
  file?: string;
  fixture?: string;
  worker?: string;
  expectTextIncludes?: string[];
  expectJsonIncludes?: unknown;
}

export interface LocalVerifyD1FileCheck {
  type: "d1Seed" | "d1Reset";
  name?: string;
  database: string;
  fixture?: string;
  worker?: string;
  file?: string;
  expectTextIncludes?: string[];
}

export type LocalVerifyCheckConfig =
  | LocalVerifyWorkerCheck
  | LocalVerifyCronCheck
  | LocalVerifyQueueCheck
  | LocalVerifyD1Check
  | LocalVerifyD1FileCheck;

export interface LocalVerifyConfig {
  checks: LocalVerifyCheckConfig[];
  packs?: Record<string, LocalVerifyPackConfig>;
}

export interface LocalVerifyPackConfig {
  description?: string;
  checks: LocalVerifyCheckConfig[];
}

export interface WorkerFixtureConfig {
  type: "worker";
  worker: string;
  endpoint?: string;
  path?: string;
  method?: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: string;
  description?: string;
}

export interface QueueFixtureConfig {
  type: "queue";
  queue: string;
  payload: string;
  worker?: string;
  description?: string;
}

export interface D1FixtureConfig {
  type: "d1";
  database: string;
  sql?: string;
  file?: string;
  worker?: string;
  description?: string;
}

export type FixtureConfig = WorkerFixtureConfig | QueueFixtureConfig | D1FixtureConfig;

export interface RouteConfig {
  pattern: string; // e.g. "api-{stage}.example.com/*"
  zone?: string; // e.g. "example.com"
  customDomain?: string; // e.g. "api-{stage}.example.com"
}

export interface StateConfig {
  backend: "local" | "kv" | "d1" | "r2";
  /** KV namespace ID for backend: "kv". */
  namespaceId?: string;
  /** Key prefix for KV / R2 (default: "wrangler-deploy/"). */
  keyPrefix?: string;
  /**
   * D1 database id for backend: "d1". The schema is bootstrapped on first
   * write — `wd apply` creates a `stage_state` table if missing.
   */
  databaseId?: string;
  /** Table name for backend: "d1" (default: "stage_state"). */
  tableName?: string;
  /** Bucket name for backend: "r2". */
  bucketName?: string;
}

export interface DevCompanionConfig {
  /** Label shown in dev logs. */
  name: string;
  /** Shell command to run for this local-only companion process. */
  command: string;
  /** Optional working directory, relative to the repo root unless absolute. */
  cwd?: string;
  /** Extra env vars for the companion process. */
  env?: Record<string, string>;
  /** Only run this companion when one of these workers is included in the dev plan. */
  workers?: string[];
}

export interface DevSessionConfig {
  /** Use a single `wrangler dev` process with repeated `-c` configs. */
  enabled?: boolean;
  /** Worker to expose as the primary local HTTP entrypoint for the session. */
  entryWorker?: string;
  /** Shared Miniflare state directory, equivalent to Wrangler's `--persist-to`. */
  persistTo?: string;
  /** Extra args appended only in session mode. */
  args?: string[];
}

export interface DevQueueRouteConfig {
  /** Worker that exposes the local debug route and owns the queue binding. */
  worker: string;
  /** Local path to POST queue payloads to. Defaults to `/__wd/queues/<logical-name>`. */
  path?: string;
}

export interface DevEndpointConfig {
  /** Worker that exposes this local endpoint. */
  worker: string;
  /** Local path to call, for example `/health` or `/__wd/echo`. */
  path: string;
  /** Optional default method when calling by endpoint name. */
  method?: string;
  /** Optional description shown in route listings and the dev UI. */
  description?: string;
}

export interface DevD1Config {
  /** Worker to run local wrangler d1 commands from when multiple workers bind the same DB. */
  worker?: string;
  /** Optional SQL file used by `wd d1 seed <db>` when --file is omitted. */
  seedFile?: string;
  /** Optional SQL file used by `wd d1 reset <db>` when --file is omitted. */
  resetFile?: string;
}

export interface DevConfig {
  /** Per-worker port overrides for `wd dev`. */
  ports?: Record<string, number>;
  /** Extra args appended to each spawned `wrangler dev` process. */
  args?: string[];
  /** Local-only helper commands to run alongside `wd dev`. */
  companions?: DevCompanionConfig[];
  /** Local queue injection routes keyed by logical queue name. */
  queues?: Record<string, DevQueueRouteConfig>;
  /** Named local HTTP endpoints keyed by logical endpoint name. */
  endpoints?: Record<string, DevEndpointConfig>;
  /** Local D1 workflow hints keyed by logical database name. */
  d1?: Record<string, DevD1Config>;
  /** Wrangler local development session options. */
  session?: DevSessionConfig;
  /** Snapshot defaults for local reproducible environments. */
  snapshots?: DevSnapshotConfig;
  /** Stage to read deployed worker names from when --filter is used with --fallback-stage. */
  fallbackStage?: string;
}

export interface DevSnapshotConfig {
  /** Local state directories to snapshot, relative to repo root unless absolute. */
  paths?: string[];
}

export interface CfStageConfig {
  version: 1;
  workers: string[];
  /** Explicit deploy order. If omitted, inferred from serviceBindings (dependencies first). */
  deployOrder?: string[];
  resources: Record<string, ResourceConfig>;
  serviceBindings?: Record<string, Record<string, string>>;
  stages?: Record<string, StageRule>;
  /**
   * Declared secrets per worker. Each entry is either a plain name
   * (`wrangler-deploy` manages the value), or `{ name, ref: true }`
   * (the secret already exists in Cloudflare via `wrangler secret put`
   * or another tool — wrangler-deploy will not push it, but it will
   * still appear in `wd secrets` reports as `ref`).
   */
  secrets?: Record<string, Array<string | SecretRef>>;
  verify?: Record<string, VerifyConfig>;
  routes?: Record<string, RouteConfig>;
  /** Shared local fixtures for worker calls, queue sends, and D1 commands. */
  fixtures?: Record<string, FixtureConfig>;
  /** Remote state configuration */
  state?: StateConfig;
  /** Config-driven local integration checks for `wd verify local`. */
  verifyLocal?: LocalVerifyConfig;
  /** Local dev configuration */
  dev?: DevConfig;
  /** Optional password for encrypting sensitive resource outputs and storedSecrets in state. Falls back to WD_STATE_PASSWORD env var. */
  statePassword?: string;
  /** Secret values to store encrypted in state (keyed by worker path → secret name → value). */
  storedSecrets?: Record<string, Record<string, string>>;
  /** Optional usage-guard integration config. */
  guard?: GuardConfig;
}

// ============================================================================
// State types — what wrangler-deploy writes to .wrangler-deploy/<stage>/state.json
// ============================================================================

// ============================================================================
// Resource lifecycle types
// ============================================================================

export type LifecycleStatus =
  | "creating" | "created"
  | "updating" | "updated"
  | "deleting" | "deleted"
  | "replacing" | "replaced"
  | "missing" | "drifted" | "orphaned";

export type ResourceProps = {
  type: ResourceType;
  name: string; // staged name, e.g. "cache-kv-staging"
  bindings: Record<string, unknown>;
  [key: string]: unknown; // type-specific extras (dimensions, metric, etc.)
};

// Per-resource output types — what Cloudflare returns after provisioning
export interface D1Output        { id?: string; name: string; version?: "v1" | "v2" }
export interface KvOutput        { id: string;  title: string }
export interface QueueOutput     { id?: string; name: string }
export interface R2Output        { name: string }
export interface HyperdriveOutput{ id: string;  name: string; origin: string }
export interface VectorizeOutput { id?: string; name: string; dimensions?: number; metric?: "euclidean" | "cosine" | "dot-product" }
export interface DnsOutput {
  zoneId: string;
  records: Array<{ id: string; name: string; type: DnsRecordType; content: string }>;
}

export type ResourceOutput =
  | D1Output | KvOutput | QueueOutput
  | R2Output | HyperdriveOutput | VectorizeOutput | DnsOutput;

export interface ResourceState {
  type: ResourceType;
  lifecycleStatus: LifecycleStatus;
  lifecycle?: {
    adoptRequested?: boolean;
    adoptSupported?: boolean;
  };
  props: ResourceProps;
  oldProps?: ResourceProps;  // set when updating, cleared on completion
  output?: ResourceOutput;
  source: "managed";
}

// ============================================================================
// State accessor helpers — use these instead of accessing fields directly
// ============================================================================

/** Returns the Cloudflare resource ID from state output, if present. */
export function resourceId(state: ResourceState): string | undefined {
  return (state.output as { id?: string } | undefined)?.id;
}

/** Returns the staged resource name (e.g. "cache-kv-staging"). */
export function resourceStagedName(state: ResourceState): string {
  return state.props.name;
}

/** True when the resource has been successfully created or updated. */
export function isActive(state: ResourceState): boolean {
  return state.lifecycleStatus === "created" || state.lifecycleStatus === "updated";
}

export interface WorkerState {
  name: string;
  url?: string;
  deployed?: boolean;
}

export interface SecretState {
  [key: string]: "set" | "missing";
}

export interface StageState {
  stage: string;
  createdAt: string;
  updatedAt: string;
  resources: Record<string, ResourceState>;
  workers: Record<string, WorkerState>;
  secrets: Record<string, SecretState>;
  storedSecrets?: Record<string, Record<string, string>>;
}

// ============================================================================
// Plan types — what wrangler-deploy plan outputs
// ============================================================================

export type PlanAction = "create" | "in-sync" | "drifted" | "orphaned" | "destroy";

export interface PlanItem {
  resource: string;
  type: ResourceType;
  action: PlanAction;
  name: string;
  details?: string;
}

export interface Plan {
  stage: string;
  items: PlanItem[];
}

// ============================================================================
// Internal types
// ============================================================================

export type WorkerRef = string; // e.g. "apps/api"

export interface WranglerConfig {
  name: string;
  main?: string;
  compatibility_date?: string;
  compatibility_flags?: string[];
  d1_databases?: Array<{ binding: string; database_id: string; database_name: string }>;
  hyperdrive?: Array<{ binding: string; id: string; localConnectionString?: string }>;
  kv_namespaces?: Array<{ binding: string; id: string }>;
  r2_buckets?: Array<{ binding: string; bucket_name: string }>;
  queues?: {
    producers?: Array<{ queue: string; binding: string }>;
    consumers?: Array<{
      queue: string;
      max_batch_size?: number;
      max_batch_timeout?: number;
      max_retries?: number;
      retry_delay?: number;
      dead_letter_queue?: string;
    }>;
  };
  routes?: Array<{ pattern: string; zone_name?: string; custom_domain?: string }>;
  services?: Array<{ binding: string; service: string }>;
  triggers?: { crons?: string[] };
  vars?: Record<string, string>;
  observability?: { enabled: boolean };
  dev?: { port: number };
  [key: string]: unknown;
}

// ---- Guard (optional usage-monitor integration) ----

import type { AccountConfig as GuardAccountConfig } from "workers-usage-guard-shared";

export type GuardConfig = {
  /**
   * Optional HTTPS endpoint of a deployed `workers-usage-guard` Worker.
   * When set, `wd guard` commands can overlay historical data from its D1.
   */
  endpoint?: string;

  /**
   * D1 database ID for the deployed guard Worker.
   * Used by `wd guard migrate` and `wd guard deploy` to target the correct database.
   */
  databaseId?: string;

  /**
   * Accounts and workers to pull usage for when running `wd guard status`
   * against Cloudflare GraphQL directly (no deployed guard required).
   * Same shape as the guard's own ACCOUNTS_JSON.
   */
  accounts?: GuardAccountConfig[];
};
