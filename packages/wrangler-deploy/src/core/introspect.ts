import type { WranglerRunner } from "./wrangler-runner.js";
import { resolveAccountId } from "./auth.js";

// ============================================================================
// Types
// ============================================================================

interface DiscoveredResource {
  name: string;
  id?: string;
  type: "kv" | "d1" | "queue" | "r2" | "hyperdrive" | "vectorize";
  /** For queues: consumer metadata from the queue list API */
  consumers?: Array<{ scriptName: string; deadLetterQueue?: string }>;
}

interface DiscoveredWorker {
  name: string;
  bindings: WorkerBinding[];
}

interface WorkerBinding {
  type: string;
  name: string; // binding name in the worker's Env
  // Resource identifiers (varies by type)
  namespace_id?: string;
  namespace_title?: string;
  id?: string;
  database_id?: string;
  database_name?: string;
  queue_name?: string;
  bucket_name?: string;
  service?: string;
  index_name?: string;
  config_id?: string;
}

export interface IntrospectResult {
  workers: DiscoveredWorker[];
  resources: DiscoveredResource[];
  configSource: string;
}

export interface IntrospectArgs {
  filter?: string;
  dryRun?: boolean;
}

export type FetchFn = typeof fetch;

export interface IntrospectDeps {
  rootDir: string;
  wrangler: WranglerRunner;
  fetchFn?: FetchFn;
}

// ============================================================================
// List functions using wrangler CLI (works with wrangler login, no token needed)
// ============================================================================

function parseJsonOutput(output: string): unknown {
  // wrangler sometimes prints warnings/info before JSON — find the JSON part
  const jsonStart = output.indexOf("[");
  const jsonObjStart = output.indexOf("{");
  const start = jsonStart === -1 ? jsonObjStart :
    jsonObjStart === -1 ? jsonStart :
      Math.min(jsonStart, jsonObjStart);

  if (start === -1) return null;
  try {
    return JSON.parse(output.slice(start));
  } catch {
    return null;
  }
}

function listKvNamespaces(wrangler: WranglerRunner, cwd: string): DiscoveredResource[] {
  try {
    const output = wrangler.run(["kv", "namespace", "list"], cwd);
    const parsed = parseJsonOutput(output) as Array<{ id: string; title: string }> | null;
    if (!parsed) return [];
    return parsed.map((ns) => ({
      name: ns.title,
      id: ns.id,
      type: "kv" as const,
    }));
  } catch {
    return [];
  }
}

function listD1Databases(wrangler: WranglerRunner, cwd: string): DiscoveredResource[] {
  try {
    const output = wrangler.run(["d1", "list", "--json"], cwd);
    const parsed = parseJsonOutput(output) as Array<{ uuid: string; name: string }> | null;
    if (!parsed) return [];
    return parsed.map((db) => ({
      name: db.name,
      id: db.uuid,
      type: "d1" as const,
    }));
  } catch {
    return [];
  }
}

function listQueues(wrangler: WranglerRunner, cwd: string): DiscoveredResource[] {
  try {
    const output = wrangler.run(["queues", "list"], cwd);
    const parsed = parseJsonOutput(output) as Array<{
      queue_id: string;
      queue_name: string;
      consumers?: Array<{ script_name: string; dead_letter_queue?: string }>;
    }> | null;
    if (!parsed) return [];
    return parsed.map((q) => ({
      name: q.queue_name,
      id: q.queue_id,
      type: "queue" as const,
      consumers: q.consumers?.map((c) => ({
        scriptName: c.script_name,
        deadLetterQueue: c.dead_letter_queue,
      })),
    }));
  } catch {
    return [];
  }
}

function listR2Buckets(wrangler: WranglerRunner, cwd: string): DiscoveredResource[] {
  try {
    const output = wrangler.run(["r2", "bucket", "list"], cwd);
    const parsed = parseJsonOutput(output) as Array<{ name: string }> | null;
    if (!parsed) return [];
    return parsed.map((b) => ({
      name: b.name,
      type: "r2" as const,
    }));
  } catch {
    return [];
  }
}

function listHyperdriveConfigs(wrangler: WranglerRunner, cwd: string): DiscoveredResource[] {
  try {
    const output = wrangler.run(["hyperdrive", "list"], cwd);
    const parsed = parseJsonOutput(output) as Array<{ id: string; name: string }> | null;
    if (!parsed) return [];
    return parsed.map((h) => ({
      name: h.name,
      id: h.id,
      type: "hyperdrive" as const,
    }));
  } catch {
    return [];
  }
}

function listVectorizeIndexes(wrangler: WranglerRunner, cwd: string): DiscoveredResource[] {
  try {
    const output = wrangler.run(["vectorize", "list"], cwd);
    const parsed = parseJsonOutput(output) as Array<{ name: string }> | null;
    if (!parsed) return [];
    return parsed.map((v) => ({
      name: v.name,
      type: "vectorize" as const,
    }));
  } catch {
    return [];
  }
}

// ============================================================================
// API-based worker discovery (when CLOUDFLARE_API_TOKEN is available)
// ============================================================================

async function listWorkersViaApi(
  accountId: string,
  apiToken: string,
  fetchFn: FetchFn = fetch,
): Promise<DiscoveredWorker[]> {
  const res = await fetchFn(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts`,
    { headers: { Authorization: `Bearer ${apiToken}` } },
  );
  if (!res.ok) return [];

  const data = (await res.json()) as {
    result: Array<{ id: string }>;
  };
  if (!data.result) return [];

  const workers: DiscoveredWorker[] = [];

  for (const script of data.result) {
    const settingsRes = await fetchFn(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${script.id}/settings`,
      { headers: { Authorization: `Bearer ${apiToken}` } },
    );

    let bindings: WorkerBinding[] = [];
    if (settingsRes.ok) {
      const settings = (await settingsRes.json()) as {
        result?: { bindings?: WorkerBinding[] };
      };
      bindings = settings.result?.bindings ?? [];
    }

    workers.push({ name: script.id, bindings });
  }

  return workers;
}

// ============================================================================
// Config generation
//
// The config uses worker directory paths as keys in `workers[]`, `bindings`,
// and `serviceBindings`. The worker's script name (used on Cloudflare) is read
// from the wrangler.jsonc in that directory — it is NOT the key itself.
//
// Since introspect discovers script names (not local paths), we generate a
// mapping comment and use the script name as a placeholder path. Critically,
// all bindings and serviceBindings keys use the SAME placeholder so the config
// is internally consistent. The user replaces the placeholder everywhere at
// once (find-and-replace) rather than only in the workers array.
// ============================================================================

/**
 * Describes a queue binding with its role for a specific worker.
 */
interface QueueBindingInfo {
  workerKey: string;
  bindingName: string;
  role: "producer" | "consumer" | "dlq";
  dlqForQueue?: string; // only for role === "dlq"
}

function generateConfigFromIntrospection(
  workers: DiscoveredWorker[],
  resources: DiscoveredResource[],
): string {
  const lines: string[] = [];
  const imports = new Set(["defineConfig"]);

  // Build resource maps keyed by ID for binding lookups
  const kvById = new Map<string, string>();
  const d1ById = new Map<string, string>();
  const hdById = new Map<string, string>();

  for (const r of resources) {
    if (r.id) {
      switch (r.type) {
        case "kv": kvById.set(r.id, r.name); break;
        case "d1": d1ById.set(r.id, r.name); break;
        case "hyperdrive": hdById.set(r.id, r.name); break;
      }
    }
  }

  // Use script names as placeholder worker keys. The user will replace these
  // with local directory paths, but they MUST do a find-and-replace across
  // the entire file so bindings and serviceBindings stay consistent.
  const workerKeySet = new Set(workers.map((w) => w.name));

  // Collect which resources are bound to which workers
  // Maps: resourceName -> Map<workerKey, bindingName>
  const kvResources = new Map<string, Map<string, string>>();
  const d1Resources = new Map<string, Map<string, string>>();
  const r2Resources = new Map<string, Map<string, string>>();
  const hdResources = new Map<string, Map<string, string>>();
  const vecResources = new Map<string, Map<string, string>>();

  // Queue bindings need richer info to distinguish producer/consumer/dlq
  const queueBindings = new Map<string, QueueBindingInfo[]>(); // resourceName -> bindings[]

  const serviceBindings = new Map<string, Map<string, string>>(); // workerKey -> {binding: targetWorkerKey}

  for (const w of workers) {
    const workerKey = w.name;

    for (const b of w.bindings) {
      switch (b.type) {
        case "kv_namespace": {
          const resName = (b.namespace_id && kvById.get(b.namespace_id)) || b.namespace_title || b.name;
          if (!kvResources.has(resName)) kvResources.set(resName, new Map());
          kvResources.get(resName)!.set(workerKey, b.name);
          imports.add("kv");
          break;
        }
        case "d1": {
          const resName = (b.database_id && d1ById.get(b.database_id)) || b.database_name || b.name;
          if (!d1Resources.has(resName)) d1Resources.set(resName, new Map());
          d1Resources.get(resName)!.set(workerKey, b.name);
          imports.add("d1");
          break;
        }
        case "queue": {
          const resName = b.queue_name || b.name;
          if (!queueBindings.has(resName)) queueBindings.set(resName, []);
          // From the API, queue bindings are producers by default.
          // Consumer bindings show up as a different type ("queue_consumer")
          // or can be inferred from the queue's consumer list.
          queueBindings.get(resName)!.push({
            workerKey,
            bindingName: b.name,
            role: "producer",
          });
          imports.add("queue");
          break;
        }
        case "queue_consumer": {
          // Consumer bindings from the Workers API
          const resName = b.queue_name || b.name;
          if (!queueBindings.has(resName)) queueBindings.set(resName, []);
          queueBindings.get(resName)!.push({
            workerKey,
            bindingName: b.name,
            role: "consumer",
          });
          imports.add("queue");
          break;
        }
        case "r2_bucket": {
          const resName = b.bucket_name || b.name;
          if (!r2Resources.has(resName)) r2Resources.set(resName, new Map());
          r2Resources.get(resName)!.set(workerKey, b.name);
          imports.add("r2");
          break;
        }
        case "hyperdrive": {
          const resName = (b.config_id && hdById.get(b.config_id)) || b.name;
          if (!hdResources.has(resName)) hdResources.set(resName, new Map());
          hdResources.get(resName)!.set(workerKey, b.name);
          imports.add("hyperdrive");
          break;
        }
        case "vectorize": {
          const resName = b.index_name || b.name;
          if (!vecResources.has(resName)) vecResources.set(resName, new Map());
          vecResources.get(resName)!.set(workerKey, b.name);
          imports.add("vectorize");
          break;
        }
        case "service": {
          if (!serviceBindings.has(workerKey)) serviceBindings.set(workerKey, new Map());
          // Service binding target is another worker's script name, which is also a workerKey
          serviceBindings.get(workerKey)!.set(b.name, b.service || "unknown");
          imports.add("worker");
          break;
        }
      }
    }
  }

  // Extract consumer/DLQ relationships from queue resource metadata.
  // The queue list response includes which workers consume each queue and
  // whether a dead-letter queue is configured.
  for (const r of resources) {
    if (r.type === "queue" && r.consumers) {
      for (const consumer of r.consumers) {
        // Add consumer binding
        if (!queueBindings.has(r.name)) queueBindings.set(r.name, []);
        queueBindings.get(r.name)!.push({
          workerKey: consumer.scriptName,
          bindingName: "QUEUE", // default binding name; user can rename
          role: "consumer",
        });
        imports.add("queue");

        // Add DLQ binding if configured
        if (consumer.deadLetterQueue) {
          if (!queueBindings.has(consumer.deadLetterQueue)) {
            queueBindings.set(consumer.deadLetterQueue, []);
          }
          queueBindings.get(consumer.deadLetterQueue)!.push({
            workerKey: consumer.scriptName,
            bindingName: "DLQ",
            role: "dlq",
            dlqForQueue: r.name,
          });
        }
      }
    }
  }

  // Ensure service binding targets are in the workers list so the config is consistent.
  // If worker "api" has a service binding to "auth", "auth" must be in workers[].
  for (const [, bindings] of serviceBindings) {
    for (const [, target] of bindings) {
      workerKeySet.add(target);
    }
  }

  // Ensure queue consumer/DLQ workers are also in the workers list.
  for (const [, qbs] of queueBindings) {
    for (const qb of qbs) {
      workerKeySet.add(qb.workerKey);
    }
  }

  const workerKeys = Array.from(workerKeySet);

  // Also include resources that aren't bound to any worker.
  // Use type-aware dedup: "kv:cache-kv" vs "d1:cache-kv" are distinct,
  // but "kv:cache-kv" vs "kv:cache_kv" are the same (same-type collision).
  // We track "type:logicalName" to match the output-stage dedup in resolveLogicalName.
  const seenUnboundKeys = new Set<string>();

  // Pre-populate from already-collected bound resources
  for (const name of kvResources.keys()) seenUnboundKeys.add(`kv:${toLogicalName(name)}`);
  for (const name of d1Resources.keys()) seenUnboundKeys.add(`d1:${toLogicalName(name)}`);
  for (const name of queueBindings.keys()) seenUnboundKeys.add(`queue:${toLogicalName(name)}`);
  for (const name of r2Resources.keys()) seenUnboundKeys.add(`r2:${toLogicalName(name)}`);
  for (const name of hdResources.keys()) seenUnboundKeys.add(`hyperdrive:${toLogicalName(name)}`);
  for (const name of vecResources.keys()) seenUnboundKeys.add(`vectorize:${toLogicalName(name)}`);

  for (const r of resources) {
    const typeKey = `${r.type}:${toLogicalName(r.name)}`;
    if (seenUnboundKeys.has(typeKey)) continue;
    seenUnboundKeys.add(typeKey);

    switch (r.type) {
      case "kv": kvResources.set(r.name, new Map()); imports.add("kv"); break;
      case "d1": d1Resources.set(r.name, new Map()); imports.add("d1"); break;
      case "queue": queueBindings.set(r.name, []); imports.add("queue"); break;
      case "r2": r2Resources.set(r.name, new Map()); imports.add("r2"); break;
      case "hyperdrive": hdResources.set(r.name, new Map()); imports.add("hyperdrive"); break;
      case "vectorize": vecResources.set(r.name, new Map()); imports.add("vectorize"); break;
    }
  }

  // Import line
  const importList = Array.from(imports).sort();
  lines.push(`import { ${importList.join(", ")} } from "wrangler-deploy";`);
  lines.push(``);

  // Instructions comment
  if (workerKeys.length > 0) {
    lines.push(`// Worker script names are used as placeholder keys throughout this file.`);
    lines.push(`// Replace each script name with its local directory path using find-and-replace`);
    lines.push(`// so that workers[], bindings, and serviceBindings all stay consistent.`);
    lines.push(`//`);
    for (const key of workerKeys) {
      lines.push(`// "${key}" → e.g. "workers/${key}"`);
    }
    lines.push(``);
  }

  lines.push(`export default defineConfig({`);
  lines.push(`  version: 1,`);
  lines.push(``);

  // Workers
  lines.push(`  workers: [`);
  for (const key of workerKeys) {
    lines.push(`    "${key}",`);
  }
  lines.push(`  ],`);
  lines.push(``);

  // Resources
  lines.push(`  resources: {`);

  // Track emitted logical names to avoid duplicate object keys.
  // Keyed as "type:logicalName" so same-type collisions (cache-kv vs cache_kv)
  // are merged, but cross-type collisions (d1 "cache-kv" vs kv "cache-kv")
  // are disambiguated by appending the type suffix.
  const emittedResourceKeys = new Set<string>();
  // Tracks bare logical names across all types to detect cross-type collisions
  const allEmittedLogicalNames = new Map<string, string>(); // logicalName -> first type that used it

  // All final output keys that have been claimed, used to prevent any collision.
  // Pre-populate with every base logical name from all resource maps so that
  // disambiguation never picks a name that a real resource will claim later.
  const usedOutputKeys = new Set<string>();
  for (const name of kvResources.keys()) usedOutputKeys.add(toLogicalName(name));
  for (const name of d1Resources.keys()) usedOutputKeys.add(toLogicalName(name));
  for (const name of queueBindings.keys()) usedOutputKeys.add(toLogicalName(name));
  for (const name of r2Resources.keys()) usedOutputKeys.add(toLogicalName(name));
  for (const name of hdResources.keys()) usedOutputKeys.add(toLogicalName(name));
  for (const name of vecResources.keys()) usedOutputKeys.add(toLogicalName(name));

  function resolveLogicalName(name: string, type: string): string | null {
    const base = toLogicalName(name);
    const typeKey = `${type}:${base}`;

    // Same-type collision: skip (will be merged by the caller)
    if (emittedResourceKeys.has(typeKey)) return null;
    emittedResourceKeys.add(typeKey);

    // No collision: use the base name directly
    const existingType = allEmittedLogicalNames.get(base);
    if (!existingType) {
      allEmittedLogicalNames.set(base, type);
      usedOutputKeys.add(base);
      return base;
    }

    // Same type claimed the base already — this is a same-type merge handled above
    if (existingType === type) {
      return base;
    }

    // Cross-type collision: disambiguate by appending the type,
    // then ensure the disambiguated name itself doesn't collide with
    // a real resource or another disambiguation.
    let candidate = `${base}-${type}`;
    let counter = 2;
    while (usedOutputKeys.has(candidate)) {
      candidate = `${base}-${type}-${counter}`;
      counter++;
    }
    usedOutputKeys.add(candidate);
    allEmittedLogicalNames.set(candidate, type);
    return candidate;
  }

  // Simple resource types (bindings are just strings).
  // When two raw names collide within the same type, merge their bindings.
  function writeSimpleResourceBlock(
    resMap: Map<string, Map<string, string>>,
    type: string,
  ) {
    for (const [name, bindings] of resMap) {
      const logicalName = resolveLogicalName(name, type);
      if (logicalName === null) continue;

      // Merge bindings from any other raw names that normalize to the same
      // base key. Compare against the base (toLogicalName), not the
      // potentially-disambiguated output, since siblings share the base.
      const baseKey = toLogicalName(name);
      const mergedBindings = new Map(bindings);
      for (const [otherName, otherBindings] of resMap) {
        if (otherName !== name && toLogicalName(otherName) === baseKey) {
          for (const [wk, bn] of otherBindings) {
            if (!mergedBindings.has(wk)) mergedBindings.set(wk, bn);
          }
        }
      }

      lines.push(`    "${logicalName}": {`);
      lines.push(`      type: "${type}",`);
      if (mergedBindings.size > 0) {
        lines.push(`      bindings: {`);
        for (const [workerKey, bindingName] of mergedBindings) {
          lines.push(`        "${workerKey}": "${bindingName}",`);
        }
        lines.push(`      },`);
      } else {
        lines.push(`      bindings: {},`);
      }
      lines.push(`    },`);
    }
  }

  writeSimpleResourceBlock(d1Resources, "d1");
  writeSimpleResourceBlock(kvResources, "kv");

  // Queue resources need object-shaped bindings for consumer/DLQ.
  // Same dedup logic as simple resources.
  for (const [name, bindings] of queueBindings) {
    const logicalName = resolveLogicalName(name, "queue");
    if (logicalName === null) continue;

    // Merge bindings from colliding raw names
    const baseKey = toLogicalName(name);
    const mergedBindings = [...bindings];
    for (const [otherName, otherBindings] of queueBindings) {
      if (otherName !== name && toLogicalName(otherName) === baseKey) {
        mergedBindings.push(...otherBindings);
      }
    }

    // Group bindings by workerKey so a worker that both produces and consumes
    // the same queue gets a single merged entry instead of duplicate keys.
    const byWorker = new Map<string, QueueBindingInfo[]>();
    for (const qb of mergedBindings) {
      if (!byWorker.has(qb.workerKey)) byWorker.set(qb.workerKey, []);
      byWorker.get(qb.workerKey)!.push(qb);
    }

    lines.push(`    "${logicalName}": {`);
    lines.push(`      type: "queue",`);
    if (byWorker.size > 0) {
      lines.push(`      bindings: {`);
      for (const [workerKey, roles] of byWorker) {
        const isProducer = roles.some((r) => r.role === "producer");
        const isConsumer = roles.some((r) => r.role === "consumer");
        const dlqRole = roles.find((r) => r.role === "dlq");
        const bindingName = roles.find((r) => r.bindingName)?.bindingName ?? "QUEUE";

        if (dlqRole) {
          lines.push(`        "${workerKey}": { deadLetterFor: "${dlqRole.dlqForQueue || name}" },`);
        } else if (isProducer && isConsumer) {
          lines.push(`        "${workerKey}": { producer: "${bindingName}", consumer: true },`);
        } else if (isConsumer) {
          lines.push(`        "${workerKey}": { producer: "${bindingName}", consumer: true },`);
        } else {
          lines.push(`        "${workerKey}": { producer: "${bindingName}" },`);
        }
      }
      lines.push(`      },`);
    } else {
      lines.push(`      bindings: {},`);
    }
    lines.push(`    },`);
  }

  writeSimpleResourceBlock(r2Resources, "r2");
  writeSimpleResourceBlock(hdResources, "hyperdrive");
  writeSimpleResourceBlock(vecResources, "vectorize");

  lines.push(`  },`);

  // Service bindings — keys are workerKeys, targets are workerKeys
  if (serviceBindings.size > 0) {
    lines.push(``);
    lines.push(`  serviceBindings: {`);
    for (const [workerKey, bindings] of serviceBindings) {
      lines.push(`    "${workerKey}": {`);
      for (const [binding, target] of bindings) {
        lines.push(`      ${binding}: "${target}",`);
      }
      lines.push(`    },`);
    }
    lines.push(`  },`);
  }

  lines.push(``);
  lines.push(`  stages: {`);
  lines.push(`    production: { protected: true },`);
  lines.push(`    staging: { protected: true },`);
  lines.push(`    "pr-*": { protected: false, ttl: "7d" },`);
  lines.push(`  },`);
  lines.push(`});`);
  lines.push(``);

  return lines.join("\n");
}

function toLogicalName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ============================================================================
// Main introspect function
// ============================================================================

export async function introspect(
  args: IntrospectArgs,
  deps: IntrospectDeps,
): Promise<IntrospectResult> {
  const { filter } = args;
  const { rootDir, wrangler, fetchFn = fetch } = deps;

  console.log(`\n  Scanning Cloudflare account...\n`);

  // Discover resources via wrangler CLI (works with wrangler login)
  const allResources: DiscoveredResource[] = [];

  process.stdout.write("  KV namespaces... ");
  const kvs = listKvNamespaces(wrangler, rootDir);
  console.log(`${kvs.length} found`);
  allResources.push(...kvs);

  process.stdout.write("  D1 databases... ");
  const d1s = listD1Databases(wrangler, rootDir);
  console.log(`${d1s.length} found`);
  allResources.push(...d1s);

  process.stdout.write("  Queues... ");
  const queues = listQueues(wrangler, rootDir);
  console.log(`${queues.length} found`);
  allResources.push(...queues);

  process.stdout.write("  R2 buckets... ");
  const r2s = listR2Buckets(wrangler, rootDir);
  console.log(`${r2s.length} found`);
  allResources.push(...r2s);

  process.stdout.write("  Hyperdrive configs... ");
  const hds = listHyperdriveConfigs(wrangler, rootDir);
  console.log(`${hds.length} found`);
  allResources.push(...hds);

  process.stdout.write("  Vectorize indexes... ");
  const vecs = listVectorizeIndexes(wrangler, rootDir);
  console.log(`${vecs.length} found`);
  allResources.push(...vecs);

  // Discover workers + bindings via API (needs CLOUDFLARE_API_TOKEN)
  // This is optional — if auth fails or token is missing, we skip gracefully
  let workers: DiscoveredWorker[] = [];
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (apiToken) {
    let accountId: string | undefined;
    try {
      accountId = resolveAccountId(rootDir);
    } catch {
      // Account ID resolution failed — that's fine, skip worker discovery
    }

    if (accountId) {
      process.stdout.write("  Workers (via API)... ");
      workers = await listWorkersViaApi(accountId, apiToken, fetchFn);
      console.log(`${workers.length} found`);
    } else {
      console.log(`  Workers: skipped (could not resolve account ID)`);
    }
  } else {
    console.log(`  Workers: skipped (set CLOUDFLARE_API_TOKEN to discover worker bindings)`);
  }

  // Apply filter
  let filteredResources = allResources;
  let filteredWorkers = workers;
  if (filter) {
    filteredResources = allResources.filter((r) => r.name.startsWith(filter));
    filteredWorkers = workers.filter((w) => w.name.startsWith(filter));
    console.log(
      `\n  Filtered to ${filteredResources.length} resources and ${filteredWorkers.length} workers matching "${filter}"`,
    );
  }

  // Print summary
  console.log(`\n  Summary:`);
  const byType = new Map<string, number>();
  for (const r of filteredResources) {
    byType.set(r.type, (byType.get(r.type) || 0) + 1);
  }
  for (const [type, count] of byType) {
    console.log(`    ${count} ${type}`);
  }
  if (filteredWorkers.length > 0) {
    console.log(`    ${filteredWorkers.length} workers`);
  }

  // Generate config
  const configSource = generateConfigFromIntrospection(filteredWorkers, filteredResources);

  return { workers: filteredWorkers, resources: filteredResources, configSource };
}
