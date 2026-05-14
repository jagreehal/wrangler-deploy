export const outputSchemas = {
  error: {
    type: "object",
    properties: {
      ok: { type: "boolean", const: false },
      command: { type: "string" },
      error: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["auth", "validation", "network", "config", "state", "not_found", "permission", "sandbox", "unknown"] },
          code: { type: "string", pattern: "^WD_E_" },
          message: { type: "string" },
          retryable: { type: "boolean" },
          fix: { type: "string" },
          expected: {},
          suggestions: { type: "array", items: { type: "string" } },
        },
        required: ["type", "code", "message", "retryable"],
      },
    },
    required: ["ok", "error"],
  },
  version: {
    type: "object",
    properties: {
      package: { type: "string" },
      version: { type: "string" },
      manifestVersion: { type: "number" },
      binaryPath: { type: ["string", "null"] },
      node: { type: "string" },
      platform: { type: "string" },
      arch: { type: "string" },
      sandbox: { type: "boolean" },
      timestamp: { type: "string" },
    },
    required: ["package", "version", "manifestVersion", "node", "platform", "arch", "sandbox", "timestamp"],
  },
  examples: {
    type: "object",
    properties: {
      command: { type: "string" },
      summary: { type: "string" },
      examples: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            command: { type: "string" },
            output: { type: "string" },
            notes: { type: "string" },
          },
          required: ["description", "command"],
        },
      },
    },
    required: ["command", "summary", "examples"],
  },
  open: {
    type: "object",
    properties: {
      stage: { type: "string" },
      workerPath: { type: "string" },
      workerName: { type: "string" },
      url: { type: "string" },
      opened: { type: "boolean" },
    },
    required: ["stage", "workerPath", "workerName", "url", "opened"],
  },
  dashboard: {
    type: "object",
    properties: {
      stage: { type: "string" },
      workerPath: { type: "string" },
      workerName: { type: "string" },
      url: { type: "string" },
      opened: { type: "boolean" },
    },
    required: ["stage", "workerPath", "workerName", "url", "opened"],
  },
  statusWatch: {
    type: "object",
    properties: {
      stage: { type: "string" },
      tick: { type: "number" },
      state: { type: ["object", "null"] },
    },
    required: ["stage", "tick", "state"],
  },
  explain: {
    type: "object",
    properties: {
      query: { type: "string" },
      summary: { type: "string" },
      actions: { type: "array", items: { type: "string" } },
    },
    required: ["query", "summary", "actions"],
  },
  history: {
    type: "object",
    properties: {
      stage: { type: "string" },
      count: { type: "number" },
      history: {
        type: "array",
        items: {
          type: "object",
          properties: {
            at: { type: "string" },
            action: { type: "string" },
            workerPath: { type: "string" },
            workerName: { type: "string" },
            versionId: { type: ["string", "null"] },
            urls: { type: "array", items: { type: "string" } },
            routes: { type: "array", items: { type: "string" } },
          },
          required: ["at", "action", "workerPath", "workerName", "urls", "routes"],
        },
      },
    },
    required: ["stage", "count", "history"],
  },
  plan: {
    type: "object",
    properties: {
      stage: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            resource: { type: "string" },
            type: { type: "string", enum: ["kv", "queue", "hyperdrive", "d1", "r2", "vectorize", "dns"] },
            action: { type: "string", enum: ["create", "in-sync", "drifted", "orphaned", "destroy"] },
            name: { type: "string" },
            details: { type: "string" },
          },
          required: ["resource", "type", "action", "name"],
        },
      },
    },
    required: ["stage", "items"],
  },
  apply: {
    type: "object",
    description: "Result of `wd apply`. Extends StageState with provisioned resource IDs.",
    properties: {
      stage: { type: "string" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      resources: { type: "object", additionalProperties: { type: "object" } },
      workers: { type: "object", additionalProperties: { type: "object" } },
      secrets: { type: "object" },
    },
    required: ["stage", "createdAt", "updatedAt", "resources", "workers"],
  },
  deploy: {
    type: "object",
    properties: {
      stage: { type: "string" },
      deployedWorkers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            workerPath: { type: "string" },
            name: { type: "string" },
            renderedConfigPath: { type: "string" },
            urls: { type: "array", items: { type: "string", format: "uri" } },
            routes: { type: "array", items: { type: "string" } },
            versionId: { type: "string" },
          },
          required: ["workerPath", "name", "renderedConfigPath", "urls", "routes"],
        },
      },
      missingSecrets: { type: "array", items: { type: "string" } },
      verified: { type: "boolean" },
      canary: { type: ["number", "null"] },
      canaryApplied: { type: "boolean" },
      lock: { type: "boolean" },
    },
    required: ["stage", "deployedWorkers", "missingSecrets", "verified"],
  },
  destroy: {
    type: "object",
    properties: {
      stage: { type: "string" },
      detachedConsumers: {
        type: "array",
        items: {
          type: "object",
          properties: { queue: { type: "string" }, worker: { type: "string" } },
          required: ["queue", "worker"],
        },
      },
      destroyedWorkers: { type: "array", items: { type: "string" } },
      destroyedResources: { type: "array", items: { type: "string" } },
      stateDeleted: { type: "boolean" },
      partialFailures: { type: "boolean" },
    },
    required: ["stage", "destroyedWorkers", "destroyedResources", "stateDeleted", "partialFailures"],
  },
  status: {
    type: "object",
    properties: {
      stage: { type: "string" },
      tick: { type: "number" },
      state: { type: ["object", "null"] },
      diff: {
        type: "object",
        properties: {
          workersChanged: { type: "number" },
          resourcesChanged: { type: "number" },
        },
      },
    },
    required: ["stage", "tick", "state"],
  },
  verify: {
    type: "object",
    properties: {
      passed: { type: "boolean" },
      checks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            passed: { type: "boolean" },
            details: { type: "string" },
          },
          required: ["name", "passed"],
        },
      },
    },
    required: ["passed", "checks"],
  },
  check: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      pack: { type: "string", enum: ["full", "doctor-only", "plan-only"] },
      checks: { type: "array" },
      plan: { type: ["object", "null"] },
      doctorOk: { type: "boolean" },
      planOk: { type: "boolean" },
    },
    required: ["ok", "pack", "checks", "doctorOk", "planOk"],
  },
  gc: {
    type: "object",
    properties: {
      destroyed: { type: "array", items: { type: "string" } },
      kept: { type: "array", items: { type: "string" } },
      protected: { type: "array", items: { type: "string" } },
    },
    required: ["destroyed", "kept", "protected"],
  },
  secrets: {
    type: "object",
    properties: {
      stage: { type: "string" },
      worker: { type: "string" },
      missing: {
        type: "array",
        items: {
          type: "object",
          properties: {
            worker: { type: "string" },
            name: { type: "string" },
            status: { type: "string", enum: ["set", "missing", "ref"] },
          },
          required: ["worker", "name", "status"],
        },
      },
    },
  },
  devEvent: {
    type: "object",
    description: "One NDJSON line emitted by `wd dev --json` on stdout. Human-formatted log output is redirected to stderr so the stream stays parseable.",
    properties: {
      ts: { type: "string", format: "date-time" },
      type: {
        type: "string",
        enum: ["dev.starting", "dev.ready", "dev.stopping", "dev.stopped", "worker.ready", "worker.error", "worker.log"],
        description: "worker.log and worker.error fire per-line as workers emit output. Errors are detected heuristically (case-insensitive 'error', '✗', or '✘')."
      },
      mode: { type: "string", enum: ["session", "workers"] },
      workerPath: { type: "string", description: "Set on worker.* events." },
      port: { type: ["number", "null"] },
      url: { type: ["string", "null"], format: "uri" },
      ports: { type: "object" },
      workerCount: { type: "number" },
      logDir: { type: "string" },
      workers: { type: "array" },
      companions: { type: "array" },
      error: { type: "string" },
      message: { type: "string", description: "Set on worker.log and worker.error. ANSI codes stripped, leading/trailing whitespace trimmed." },
    },
    required: ["ts", "type"],
  },
  doctor: {
    type: "object",
    properties: {
      checks: { type: "array" },
      strict: { type: "boolean" },
      codes: { type: "array", items: { type: "string" } },
    },
    required: ["checks", "strict"],
  },
  rollbackList: {
    type: "object",
    properties: {
      stage: { type: "string" },
      worker: { type: "string" },
      workerPath: { type: "string" },
      versions: { type: "array", items: { type: "string" } },
    },
    required: ["stage", "worker", "workerPath", "versions"],
  },
} as const;

export function schemaForCommand(command: string) {
  const key = command as keyof typeof outputSchemas;
  return outputSchemas[key];
}
