// ============================================================================
// Manifest types — what the user writes in wrangler-deploy.config.ts
// ============================================================================

export type ResourceType = "kv" | "queue" | "hyperdrive" | "d1" | "r2" | "vectorize";

export interface KvResourceConfig {
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

export interface QueueResourceConfig {
  type: "queue";
  bindings: Record<string, QueueBinding>;
}

export interface HyperdriveResourceConfig {
  type: "hyperdrive";
  bindings: Record<string, string>;
  database?: {
    provider: "neon";
    branchFrom: string;
  };
}

export interface D1ResourceConfig {
  type: "d1";
  bindings: Record<string, string>;
}

export interface R2ResourceConfig {
  type: "r2";
  bindings: Record<string, string>;
}

export interface VectorizeResourceConfig {
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
  | VectorizeResourceConfig;

export interface StageRule {
  protected: boolean;
  ttl?: string;
}

export interface VerifyConfig {
  url?: string;
  expectStatus?: number;
  skipHttp?: boolean;
}

export interface RouteConfig {
  pattern: string; // e.g. "api-{stage}.example.com/*"
  zone?: string; // e.g. "example.com"
  customDomain?: string; // e.g. "api-{stage}.example.com"
}

export interface StateConfig {
  backend: "local" | "kv";
  namespaceId?: string; // KV namespace ID for remote state
  keyPrefix?: string; // prefix for keys in KV (default: "wrangler-deploy/")
}

export interface CfStageConfig {
  version: 1;
  workers: string[];
  /** Explicit deploy order. If omitted, inferred from serviceBindings (dependencies first). */
  deployOrder?: string[];
  resources: Record<string, ResourceConfig>;
  serviceBindings?: Record<string, Record<string, string>>;
  stages?: Record<string, StageRule>;
  secrets?: Record<string, string[]>;
  verify?: Record<string, VerifyConfig>;
  routes?: Record<string, RouteConfig>;
  /** Remote state configuration */
  state?: StateConfig;
}

// ============================================================================
// State types — what cf-stage writes to .wrangler-deploy/<stage>/state.json
// ============================================================================

export interface ResourceState {
  type: ResourceType;
  desired: {
    name: string;
  };
  observed: {
    id?: string;
    status: "active" | "missing" | "drifted" | "orphaned";
    lastSeenAt?: string;
  };
  source: "managed";
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
  hyperdrive?: Array<{ binding: string; id: string; localConnectionString?: string }>;
  kv_namespaces?: Array<{ binding: string; id: string }>;
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
