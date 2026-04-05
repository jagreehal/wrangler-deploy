/**
 * Typed resource markers and phantom Env derivation.
 *
 * Declare resources with typed markers, derive the Worker Env type automatically.
 *
 * @example
 * ```ts
 * // wrangler-deploy.config.ts
 * import { kv, queue, hyperdrive, worker, workerEnv } from "wrangler-deploy";
 *
 * const paymentsDb = hyperdrive("payments-db");
 * const tokenKv = kv("token-kv");
 * const outboxQueue = queue("payment-outbox");
 * const batchWorker = worker("batch-workflow");
 *
 * export const api = workerEnv({
 *   HYPERDRIVE: paymentsDb,
 *   TOKEN_KV: tokenKv,
 *   OUTBOX_QUEUE: outboxQueue,
 *   WORKFLOWS: batchWorker,
 * });
 *
 * // In your worker:
 * // import type { api } from "../../wrangler-deploy.config.ts";
 * // type Env = typeof api.Env;
 * // env.HYPERDRIVE → Hyperdrive
 * // env.TOKEN_KV   → KVNamespace
 * // env.OUTBOX_QUEUE → Queue
 * // env.WORKFLOWS  → Fetcher
 * ```
 */

// ============================================================================
// Resource marker types — carry type information, no runtime value
// ============================================================================

export interface KvMarker {
  readonly __wsType: "kv";
  readonly name: string;
}

export interface QueueMarker<Body = unknown> {
  readonly __wsType: "queue";
  readonly __body: Body;
  readonly name: string;
}

export interface HyperdriveMarker {
  readonly __wsType: "hyperdrive";
  readonly name: string;
}

export interface D1Marker {
  readonly __wsType: "d1";
  readonly name: string;
}

export interface R2Marker {
  readonly __wsType: "r2";
  readonly name: string;
}

export interface WorkerMarker {
  readonly __wsType: "worker";
  readonly name: string;
}

export interface WorkflowMarker<Params = unknown> {
  readonly __wsType: "workflow";
  readonly __params: Params;
  readonly name: string;
}

export interface VectorizeMarker {
  readonly __wsType: "vectorize";
  readonly name: string;
}

export interface SecretMarker {
  readonly __wsType: "secret";
  readonly name: string;
}

export type ResourceMarker =
  | KvMarker
  | QueueMarker
  | HyperdriveMarker
  | D1Marker
  | R2Marker
  | VectorizeMarker
  | WorkerMarker
  | WorkflowMarker
  | SecretMarker;

// ============================================================================
// Bound<T> — maps resource markers to Cloudflare Workers runtime types
// ============================================================================

// ============================================================================
// Cloudflare runtime type references
//
// These are declared as interfaces so they merge with the global types from
// @cloudflare/workers-types when present in the consumer's project.
// In cf-stage's own compilation (no workers-types), they compile as empty
// interfaces — the phantom type still works, it just can't resolve members.
// ============================================================================

// Fallback types — minimal compatible interfaces for cf-stage's own build.
// In consumer projects with @cloudflare/workers-types, the consumer's
// wrangler-deploy.config.ts sees the REAL Cloudflare types via the Bound<T> mapping
// because the consumer's tsconfig includes @cloudflare/workers-types globals.
type CfKVNamespace = { get(key: string): Promise<string | null> };
type CfQueue<Body = unknown> = { send(body: Body): Promise<void> };
type CfHyperdrive = { connectionString: string };
type CfD1Database = { prepare(query: string): unknown };
type CfR2Bucket = { get(key: string): Promise<unknown> };
type CfVectorizeIndex = {
  query(vector: number[], options?: unknown): Promise<unknown>;
  insert(vectors: unknown[]): Promise<unknown>;
};
type CfFetcher = { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> };
type CfWorkflow<Params = unknown> = {
  create(options?: { id?: string; params?: Params }): Promise<{ id: string }>;
};

/**
 * Maps a cf-stage resource marker to the corresponding Cloudflare Workers
 * runtime binding type. This is the phantom type magic — the mapping exists
 * only at the type level.
 *
 * When @cloudflare/workers-types is loaded (in the consumer's project),
 * these resolve to the full Cloudflare types (KVNamespace, Queue, etc.).
 * When it's not loaded (in cf-stage's own build), they resolve to minimal
 * compatible interfaces.
 */
export type Bound<T> = T extends KvMarker
  ? CfKVNamespace
  : T extends QueueMarker<infer Body>
    ? CfQueue<Body>
    : T extends HyperdriveMarker
      ? CfHyperdrive
      : T extends D1Marker
        ? CfD1Database
        : T extends R2Marker
          ? CfR2Bucket
          : T extends VectorizeMarker
            ? CfVectorizeIndex
            : T extends WorkerMarker
              ? CfFetcher
              : T extends WorkflowMarker<infer Params>
                ? CfWorkflow<Params>
                : T extends SecretMarker
                  ? string
                  : T extends string
                    ? T
                    : never;

/**
 * Derive a full Worker Env type from a bindings record.
 * Each binding name maps to its Bound<T> runtime type.
 */
export type DeriveEnv<B extends Record<string, unknown>> = {
  readonly [K in keyof B]: Bound<B[K]>;
};

// ============================================================================
// Factory functions — create typed resource markers
// ============================================================================

/** Declare a KV namespace resource. */
export function kv(name: string): KvMarker {
  return { __wsType: "kv", name } as KvMarker;
}

/** Declare a Queue resource. */
export function queue<Body = unknown>(name: string): QueueMarker<Body> {
  return { __wsType: "queue", name } as QueueMarker<Body>;
}

/** Declare a Hyperdrive resource. */
export function hyperdrive(name: string): HyperdriveMarker {
  return { __wsType: "hyperdrive", name } as HyperdriveMarker;
}

/** Declare a D1 database resource. */
export function d1(name: string): D1Marker {
  return { __wsType: "d1", name } as D1Marker;
}

/** Declare an R2 bucket resource. */
export function r2(name: string): R2Marker {
  return { __wsType: "r2", name } as R2Marker;
}

/** Declare a Vectorize index resource. */
export function vectorize(name: string): VectorizeMarker {
  return { __wsType: "vectorize", name } as VectorizeMarker;
}

/** Declare a Worker resource (for service bindings). */
export function worker(name: string): WorkerMarker {
  return { __wsType: "worker", name } as WorkerMarker;
}

/** Declare a Workflow resource. */
export function workflow<Params = unknown>(name: string): WorkflowMarker<Params> {
  return { __wsType: "workflow", name } as WorkflowMarker<Params>;
}

/** Declare a secret (resolved to string at runtime). */
export function secret(name: string): SecretMarker {
  return { __wsType: "secret", name } as SecretMarker;
}

// ============================================================================
// workerEnv — the key DX function
// ============================================================================

/**
 * Create a typed worker environment from a bindings record.
 * The returned object carries a phantom `Env` property that resolves
 * each binding to its Cloudflare Workers runtime type.
 *
 * No runtime value exists for `Env` — it is type-level only.
 *
 * @example
 * ```ts
 * export const api = workerEnv({
 *   DB: hyperdrive("payments-db"),
 *   CACHE: kv("cache-kv"),
 *   QUEUE: queue<{ type: string }>("outbox"),
 *   WORKFLOWS: worker("batch-workflow"),
 * });
 *
 * // typeof api.Env = {
 * //   readonly DB: Hyperdrive;
 * //   readonly CACHE: KVNamespace;
 * //   readonly QUEUE: Queue<{ type: string }>;
 * //   readonly WORKFLOWS: Fetcher;
 * // }
 * ```
 */
export function workerEnv<B extends Record<string, ResourceMarker | string>>(
  bindings: B,
): { readonly Env: DeriveEnv<B>; readonly bindings: B } {
  // Env is a phantom property — no value at runtime, only the type matters.
  // The bindings are kept for runtime introspection by the CLI (extracting names).
  return { bindings } as unknown as { readonly Env: DeriveEnv<B>; readonly bindings: B };
}
