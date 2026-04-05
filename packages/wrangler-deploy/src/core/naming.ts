/**
 * Generate a stage-specific resource name.
 * Convention: <logical-name>-<stage>
 */
export function resourceName(logicalName: string, stage: string): string {
  return `${logicalName}-${stage}`;
}

/**
 * Generate a stage-specific worker name.
 * Convention: <base-worker-name>-<stage>
 */
export function workerName(baseName: string, stage: string): string {
  return `${baseName}-${stage}`;
}

/**
 * Check if a stage name matches a glob pattern.
 * Supports simple patterns like "pr-*" matching "pr-123".
 */
export function stageMatchesPattern(stage: string, pattern: string): boolean {
  if (pattern === stage) return true;
  if (!pattern.includes("*")) return false;

  const regex = new RegExp(
    "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
  );
  return regex.test(stage);
}

/**
 * Check if a stage is protected based on stage rules.
 * Stages not matching any pattern default to protected: true (safe default).
 */
export function isStageProtected(
  stage: string,
  rules: Record<string, { protected: boolean }> | undefined
): boolean {
  if (!rules) return true;

  for (const [pattern, rule] of Object.entries(rules)) {
    if (stageMatchesPattern(stage, pattern)) {
      return rule.protected;
    }
  }

  return true; // safe default
}
