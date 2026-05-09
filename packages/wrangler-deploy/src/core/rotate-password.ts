import type { StageState } from "../types.js";
import type { StateProvider } from "./state.js";
import { decryptState, encryptState } from "./crypto.js";

/**
 * Rotate the encryption password for every stage handled by `provider`.
 *
 * For each stage:
 *   1. Read raw state.
 *   2. Decrypt with the *old* password.
 *   3. Re-encrypt with the *new* password.
 *   4. Write back.
 *
 * The provider's read/write paths are agnostic to password — they pass
 * raw JSON blobs around — so we run decrypt/encrypt explicitly here.
 *
 * If a stage fails to decrypt (likely the wrong "old" password), we
 * skip it and report it; partial rotation is safer than corrupting state.
 */

export interface RotatePasswordArgs {
  provider: StateProvider;
  oldPassword: string;
  newPassword: string;
  /** Override for tests. Defaults to provider.list(). */
  stages?: string[];
}

export interface RotatePasswordResult {
  rotated: string[];
  skipped: Array<{ stage: string; reason: string }>;
}

export async function rotatePassword(args: RotatePasswordArgs): Promise<RotatePasswordResult> {
  const stages = args.stages ?? (await args.provider.list());
  const rotated: string[] = [];
  const skipped: Array<{ stage: string; reason: string }> = [];

  for (const stage of stages) {
    let raw: StageState | null;
    try {
      raw = await args.provider.read(stage);
    } catch (error) {
      skipped.push({ stage, reason: `read failed: ${(error as Error).message}` });
      continue;
    }
    if (!raw) {
      skipped.push({ stage, reason: "no state" });
      continue;
    }

    let plaintext: StageState;
    try {
      plaintext = await decryptState(raw, args.oldPassword);
    } catch (error) {
      skipped.push({ stage, reason: `decrypt with old password failed: ${(error as Error).message}` });
      continue;
    }

    try {
      const reencrypted = await encryptState(plaintext, args.newPassword);
      await args.provider.write(stage, reencrypted);
      rotated.push(stage);
    } catch (error) {
      skipped.push({ stage, reason: `re-encrypt failed: ${(error as Error).message}` });
    }
  }

  return { rotated, skipped };
}

/**
 * "Erase" encrypted secrets from a single stage's state — used when the
 * old password is lost and the user wants to redeploy by re-setting
 * secrets via `wd secrets set`.
 *
 * For Hyperdrive `origin` fields encrypted with a lost password we
 * replace the value with an empty string (the resource is then re-applied
 * with --force to push fresh credentials). For `storedSecrets` we drop
 * the entire map so subsequent applies prompt for fresh values.
 */
export function eraseSecrets(state: StageState): StageState {
  const clone = structuredClone(state);
  for (const resource of Object.values(clone.resources)) {
    if (resource.type === "hyperdrive" && resource.output) {
      const out = resource.output as { origin?: string };
      if (out.origin?.startsWith("v1:")) out.origin = "";
    }
  }
  if (clone.storedSecrets) {
    for (const workerKey of Object.keys(clone.storedSecrets)) {
      delete clone.storedSecrets[workerKey];
    }
  }
  return clone;
}
