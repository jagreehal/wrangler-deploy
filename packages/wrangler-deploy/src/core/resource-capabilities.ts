import type { ResourceType } from "../types.js";

const ADOPT_SUPPORTED_RESOURCE_TYPES: ResourceType[] = ["kv", "queue", "hyperdrive"];

export function supportsAdopt(type: ResourceType): boolean {
  return ADOPT_SUPPORTED_RESOURCE_TYPES.includes(type);
}

export function adoptSupportedResourceTypes(): ResourceType[] {
  return [...ADOPT_SUPPORTED_RESOURCE_TYPES];
}

export function adoptUnsupportedMessage(type: ResourceType): string {
  return `Resource type "${type}" does not support adopt yet. Supported types: ${ADOPT_SUPPORTED_RESOURCE_TYPES.join(", ")}`;
}
