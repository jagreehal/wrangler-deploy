import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { readWranglerConfig } from "./wrangler.js";
import type { WranglerConfig } from "../types.js";

interface DiscoveredWorker {
  path: string;
  config: WranglerConfig;
}

/**
 * Recursively find directories containing wrangler.jsonc or wrangler.json.
 * Skips node_modules, .git, dist, lib, .wrangler-deploy.
 */
function findWranglerConfigs(dir: string, rootDir: string): DiscoveredWorker[] {
  const results: DiscoveredWorker[] = [];
  const skipDirs = new Set([
    "node_modules",
    ".git",
    "dist",
    "lib",
    ".wrangler-deploy",
    ".turbo",
    ".wrangler",
    ".alchemy",
    "test",
    "tests",
  ]);

  function walk(current: string) {
    const entries = readdirSync(current, { withFileTypes: true });

    const hasWrangler = entries.some(
      (e) => e.isFile() && (e.name === "wrangler.jsonc" || e.name === "wrangler.json"),
    );

    if (hasWrangler) {
      try {
        const config = readWranglerConfig(current);
        const relPath = relative(rootDir, current);
        results.push({
          path: relPath || ".",
          config,
        });
      } catch {
        // Skip unparseable configs
      }
    }

    for (const entry of entries) {
      if (entry.isDirectory() && !skipDirs.has(entry.name)) {
        walk(join(current, entry.name));
      }
    }
  }

  walk(dir);
  return results;
}

/**
 * Generate a wrangler-deploy.config.ts from discovered wrangler configs.
 */
export function generateConfig(rootDir: string): string {
  const allWorkers = findWranglerConfigs(rootDir, rootDir);

  if (allWorkers.length === 0) {
    throw new Error("No wrangler.jsonc or wrangler.json files found.");
  }

  // Deduplicate by worker name — keep first occurrence
  const seenNames = new Set<string>();
  const workers = allWorkers.filter((w) => {
    if (seenNames.has(w.config.name)) return false;
    seenNames.add(w.config.name);
    return true;
  });

  // Collect resources
  const kvResources = new Map<string, Map<string, string>>(); // id -> {workerPath: binding}
  const queueResources = new Map<string, Map<string, string>>(); // name -> {workerPath: role}
  const hyperdriveResources = new Map<string, Map<string, string>>();
  const serviceBindings = new Map<string, Map<string, string>>(); // workerPath -> {binding: service}

  for (const w of workers) {
    // KV
    if (w.config.kv_namespaces) {
      for (const kv of w.config.kv_namespaces) {
        const logicalName = kv.binding.toLowerCase().replace(/_/g, "-");
        if (!kvResources.has(logicalName)) kvResources.set(logicalName, new Map());
        kvResources.get(logicalName)!.set(w.path, kv.binding);
      }
    }

    // Queues
    if (w.config.queues?.producers) {
      for (const p of w.config.queues.producers) {
        if (!queueResources.has(p.queue)) queueResources.set(p.queue, new Map());
        queueResources.get(p.queue)!.set(w.path, `producer:${p.binding}`);
      }
    }
    if (w.config.queues?.consumers) {
      for (const c of w.config.queues.consumers) {
        if (!queueResources.has(c.queue)) queueResources.set(c.queue, new Map());
        // Find the producer binding name for this worker on the same queue
        const producerBinding =
          w.config.queues?.producers?.find((p) => p.queue === c.queue)?.binding ?? "QUEUE";
        queueResources.get(c.queue)!.set(w.path, `consumer:${producerBinding}`);
        if (c.dead_letter_queue) {
          if (!queueResources.has(c.dead_letter_queue))
            queueResources.set(c.dead_letter_queue, new Map());
          queueResources.get(c.dead_letter_queue)!.set(w.path, `dlq:${c.queue}`);
        }
      }
    }

    // Hyperdrive
    if (w.config.hyperdrive) {
      for (const h of w.config.hyperdrive) {
        const logicalName = h.binding.toLowerCase().replace(/_/g, "-");
        if (!hyperdriveResources.has(logicalName)) hyperdriveResources.set(logicalName, new Map());
        hyperdriveResources.get(logicalName)!.set(w.path, h.binding);
      }
    }

    // Service bindings
    if (w.config.services) {
      if (!serviceBindings.has(w.path)) serviceBindings.set(w.path, new Map());
      for (const s of w.config.services) {
        serviceBindings.get(w.path)!.set(s.binding, s.service);
      }
    }
  }

  // Build the config output
  const workerPaths = workers.map((w) => w.path);
  const lines: string[] = [];

  lines.push(
    `import { defineConfig, kv, queue, hyperdrive, worker, workerEnv } from "wrangler-deploy";`,
  );
  lines.push(``);
  lines.push(`// Resources`);

  // Collect all variable names to avoid collisions
  const usedVarNames = new Set([
    "kv",
    "queue",
    "hyperdrive",
    "worker",
    "workerEnv",
    "defineConfig",
  ]);

  function safeVarName(base: string, suffix: string): string {
    let name = camelCase(base) + suffix;
    while (usedVarNames.has(name)) {
      name = name + "_";
    }
    usedVarNames.add(name);
    return name;
  }

  // KV
  const kvVarNames = new Map<string, string>();
  for (const [name] of kvResources) {
    const varName = safeVarName(name, "");
    kvVarNames.set(name, varName);
    lines.push(`const ${varName} = kv("${name}");`);
  }

  // Hyperdrive
  const hdVarNames = new Map<string, string>();
  for (const [name] of hyperdriveResources) {
    const varName = safeVarName(name, "Db");
    hdVarNames.set(name, varName);
    lines.push(`const ${varName} = hyperdrive("${name}");`);
  }

  // Queues
  const queueVarNames = new Map<string, string>();
  for (const [name] of queueResources) {
    const varName = safeVarName(name, "");
    queueVarNames.set(name, varName);
    lines.push(`const ${varName} = queue("${name}");`);
  }

  // Service binding worker refs
  const serviceTargets = new Set<string>();
  const serviceVarNames = new Map<string, string>();
  for (const [, bindings] of serviceBindings) {
    for (const [, target] of bindings) {
      serviceTargets.add(target);
    }
  }
  for (const target of serviceTargets) {
    const varName = safeVarName(target, "Worker");
    serviceVarNames.set(target, varName);
    lines.push(`const ${varName} = worker("${target}");`);
  }

  lines.push(``);
  lines.push(`// Worker environments`);

  // Worker env exports
  for (const w of workers) {
    const envBindings: string[] = [];

    if (w.config.kv_namespaces) {
      for (const kvNs of w.config.kv_namespaces) {
        const logicalName = kvNs.binding.toLowerCase().replace(/_/g, "-");
        envBindings.push(
          `  ${kvNs.binding}: ${kvVarNames.get(logicalName) ?? camelCase(logicalName)},`,
        );
      }
    }
    if (w.config.hyperdrive) {
      for (const h of w.config.hyperdrive) {
        const logicalName = h.binding.toLowerCase().replace(/_/g, "-");
        envBindings.push(
          `  ${h.binding}: ${hdVarNames.get(logicalName) ?? camelCase(logicalName)},`,
        );
      }
    }
    if (w.config.queues?.producers) {
      for (const p of w.config.queues.producers) {
        envBindings.push(`  ${p.binding}: ${queueVarNames.get(p.queue) ?? camelCase(p.queue)},`);
      }
    }
    if (w.config.services) {
      for (const s of w.config.services) {
        envBindings.push(
          `  ${s.binding}: ${serviceVarNames.get(s.service) ?? camelCase(s.service)},`,
        );
      }
    }

    const varName = safeVarName(w.config.name, "Env");
    lines.push(``);
    lines.push(`export const ${varName} = workerEnv({`);
    for (const b of envBindings) {
      lines.push(b);
    }
    lines.push(`});`);
  }

  // defineConfig
  lines.push(``);
  lines.push(`export default defineConfig({`);
  lines.push(`  version: 1,`);
  lines.push(``);
  lines.push(`  workers: [`);
  for (const p of workerPaths) {
    lines.push(`    "${p}",`);
  }
  lines.push(`  ],`);
  lines.push(``);
  // deployOrder is optional — inferred from serviceBindings automatically

  // Resources block
  lines.push(`  resources: {`);

  for (const [name, bindings] of kvResources) {
    lines.push(`    "${name}": {`);
    lines.push(`      type: "kv",`);
    lines.push(`      bindings: {`);
    for (const [workerPath, bindingName] of bindings) {
      lines.push(`        "${workerPath}": "${bindingName}",`);
    }
    lines.push(`      },`);
    lines.push(`    },`);
  }

  for (const [name, bindings] of hyperdriveResources) {
    lines.push(`    "${name}": {`);
    lines.push(`      type: "hyperdrive",`);
    lines.push(`      bindings: {`);
    for (const [workerPath, bindingName] of bindings) {
      lines.push(`        "${workerPath}": "${bindingName}",`);
    }
    lines.push(`      },`);
    lines.push(`    },`);
  }

  for (const [name, bindings] of queueResources) {
    lines.push(`    "${name}": {`);
    lines.push(`      type: "queue",`);
    lines.push(`      bindings: {`);
    for (const [workerPath, role] of bindings) {
      if (role.startsWith("producer:")) {
        const bindingName = role.split(":")[1];
        lines.push(`        "${workerPath}": { producer: "${bindingName}" },`);
      } else if (role.startsWith("consumer:")) {
        // consumer role is stored as "consumer:<producerBinding>"
        const producerBinding = role.split(":")[1];
        lines.push(`        "${workerPath}": { producer: "${producerBinding}", consumer: true },`);
      } else if (role.startsWith("dlq:")) {
        const forQueue = role.split(":")[1];
        lines.push(`        "${workerPath}": { deadLetterFor: "${forQueue}" },`);
      }
    }
    lines.push(`      },`);
    lines.push(`    },`);
  }

  lines.push(`  },`);

  // Service bindings
  if (serviceBindings.size > 0) {
    lines.push(``);
    lines.push(`  serviceBindings: {`);
    for (const [workerPath, bindings] of serviceBindings) {
      lines.push(`    "${workerPath}": {`);
      for (const [binding, target] of bindings) {
        // Try to find which worker path matches this service name
        const matchingWorker = workers.find((w) => w.config.name === target);
        const targetPath = matchingWorker?.path ?? target;
        lines.push(`      ${binding}: "${targetPath}",`);
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

function camelCase(str: string): string {
  return str
    .replace(/^[^a-zA-Z]+/, "")
    .replace(/[-_]([a-zA-Z])/g, (_, c) => c.toUpperCase())
    .replace(/[-_]/g, "");
}
