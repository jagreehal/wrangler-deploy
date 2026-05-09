import type { ResourceProps, ResourceType } from "../types.js";

/**
 * Classifier for "can wrangler-deploy update this prop in place, or does it
 * need to recreate the resource?"
 *
 * This is a scaffold. Today the value is in having a single source of
 * truth for which prop changes are unupdatable per resource type — apply
 * and plan can use this to give clearer diff output ("this change forces
 * a replacement"). Wiring the actual create-new + delete-old flow into
 * apply.ts is a follow-up because it touches every provider and needs
 * downstream-binding-update sequencing.
 *
 * Changing a Vectorize index's `dimensions`
 * is rejected by Cloudflare in-place. wrangler-deploy currently surfaces
 * that as a generic CLI error; with this classifier we can flag it as a
 * replace-required diff before the API call ever runs.
 */

export interface ReplacementVerdict {
  required: boolean;
  reasons: string[];
}

/**
 * Per-resource-type unupdatable prop names. Each entry is checked with
 * shallow equality; nested objects are compared with JSON.stringify so
 * `{ provider: "neon" }` matches `{ provider: "neon" }` regardless of
 * key order from Object.assign.
 */
const UNUPDATABLE_PROPS: Record<ResourceType, string[]> = {
  kv: ["name"],
  d1: ["name"],
  r2: ["name"],
  queue: ["name"],
  hyperdrive: ["name", "database"],
  vectorize: ["name", "dimensions", "metric", "preset"],
  dns: [],
};

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a === "object") return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

/**
 * Compare old vs new props for a resource and report whether any change
 * forces a full replacement. Bindings are mutable (they're how workers
 * reference resources, not immutable physical attributes).
 */
export function classifyReplacement(
  type: ResourceType,
  oldProps: ResourceProps,
  newProps: ResourceProps,
): ReplacementVerdict {
  const reasons: string[] = [];
  const unupdatable = UNUPDATABLE_PROPS[type] ?? [];

  for (const prop of unupdatable) {
    const before = oldProps[prop];
    const after = newProps[prop];
    if (!deepEqual(before, after)) {
      reasons.push(`${prop}: ${describe(before)} → ${describe(after)}`);
    }
  }

  return { required: reasons.length > 0, reasons };
}

function describe(value: unknown): string {
  if (value === undefined) return "(unset)";
  if (typeof value === "string") return JSON.stringify(value);
  return JSON.stringify(value);
}

/**
 * Helper for surfacing replacement requirements in plan output. Returns
 * a one-line description suitable for the CLI's diff column.
 */
export function describeReplacement(verdict: ReplacementVerdict): string | undefined {
  if (!verdict.required) return undefined;
  return `requires replacement: ${verdict.reasons.join("; ")}`;
}
