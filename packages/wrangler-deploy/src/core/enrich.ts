import type { StageState, ResourceOutput } from "../types.js";
import type { ResourceMarker, KvMarker, QueueMarker, HyperdriveMarker, D1Marker, R2Marker, VectorizeMarker } from "../typed.js";

type EnrichableMarker =
  | KvMarker
  | QueueMarker
  | HyperdriveMarker
  | D1Marker
  | R2Marker
  | VectorizeMarker;

function isEnrichable(marker: ResourceMarker): marker is EnrichableMarker {
  return (
    marker.__wsType === "kv" ||
    marker.__wsType === "queue" ||
    marker.__wsType === "hyperdrive" ||
    marker.__wsType === "d1" ||
    marker.__wsType === "r2" ||
    marker.__wsType === "vectorize"
  );
}

/**
 * Mutates each marker in the array, attaching `output` from the given state.
 * Markers whose name has no matching resource in state are left unchanged.
 * Safe to call multiple times — idempotent.
 */
export function enrichMarkers(markers: ResourceMarker[], state: StageState): void {
  for (const marker of markers) {
    if (!isEnrichable(marker)) continue;
    const resource = state.resources[marker.name];
    if (!resource?.output) continue;
    // Marker objects are plain objects — safe to mutate
    (marker as { output?: ResourceOutput }).output = resource.output;
  }
}

/**
 * Returns a flat map of logical resource name → ResourceOutput from the given state.
 * Useful in scripts that don't have access to the original marker objects.
 */
export function loadStateOutputs(state: StageState): Record<string, ResourceOutput> {
  const result: Record<string, ResourceOutput> = {};
  for (const [name, resource] of Object.entries(state.resources)) {
    if (resource.output) {
      result[name] = resource.output;
    }
  }
  return result;
}
