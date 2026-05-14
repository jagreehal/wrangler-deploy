/**
 * JSON Schema for wrangler-deploy.config.ts. Agents that generate or edit configs can
 * validate them against this schema before writing the file. The schema is hand-maintained
 * to mirror src/types.ts -> CfStageConfig and is exposed via `wd schema config --json`.
 */
export const configSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "wrangler-deploy.config",
  title: "wrangler-deploy.config.ts",
  type: "object",
  required: ["version", "workers", "resources", "stages"],
  properties: {
    version: { type: "number", const: 1, description: "Config schema version. Always 1 for now." },
    workers: {
      type: "array",
      description: "Filesystem paths (relative to project root) of worker directories. Empty array for infra-only mode.",
      items: { type: "string" },
    },
    deployOrder: {
      type: "array",
      description: "Optional explicit deploy order. Inferred from serviceBindings if omitted.",
      items: { type: "string" },
    },
    resources: {
      type: "object",
      description: "Map of logical resource name -> resource config.",
      additionalProperties: {
        type: "object",
        required: ["type"],
        properties: {
          type: { type: "string", enum: ["kv", "queue", "hyperdrive", "d1", "r2", "vectorize"] },
          bindings: {
            type: "object",
            description: "Map of worker path -> binding name (string) or shape-specific binding object.",
            additionalProperties: true,
          },
          deadLetterFor: { type: "string", description: "Queue resources only: name of the queue this DLQ serves." },
        },
        additionalProperties: true,
      },
    },
    serviceBindings: {
      type: "object",
      description: "Map of worker path -> { ENV_NAME: target worker path }.",
      additionalProperties: {
        type: "object",
        additionalProperties: { type: "string" },
      },
    },
    stages: {
      type: "object",
      description: "Map of stage name (or glob like 'pr-*') -> stage rule.",
      additionalProperties: {
        type: "object",
        properties: {
          protected: { type: "boolean", description: "If true, destroy requires --force." },
          ttl: { type: "string", description: "ISO 8601 duration or shorthand like '7d'. Used by gc." },
        },
        additionalProperties: true,
      },
    },
    secrets: {
      type: "object",
      description: "Map of worker path -> array of secret names (or refs).",
      additionalProperties: {
        type: "array",
        items: { oneOf: [{ type: "string" }, { type: "object" }] },
      },
    },
    routes: {
      type: "object",
      description: "Map of worker path -> { pattern, zone } route binding.",
      additionalProperties: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          zone: { type: "string" },
        },
        required: ["pattern", "zone"],
      },
    },
    state: {
      type: "object",
      description: "State backend config. Omit for local file state.",
      properties: {
        backend: { type: "string", enum: ["local", "kv"] },
        namespaceId: { type: "string", description: "Required when backend = kv." },
        encryption: { type: "string", enum: ["none", "password"] },
      },
      additionalProperties: true,
    },
    dev: {
      type: "object",
      description: "Local dev configuration (basePort, sessions, queue routes).",
      additionalProperties: true,
    },
    verify: {
      type: "object",
      description: "Post-deploy verification config (HTTP probes, etc.).",
      additionalProperties: true,
    },
    statePassword: {
      type: "string",
      description: "Password for encrypted state. Prefer WD_STATE_PASSWORD env var.",
    },
  },
  additionalProperties: false,
} as const;
