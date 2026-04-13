import { scrypt, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { StageState, HyperdriveOutput } from "../types.js";

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 32;

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LEN, SCRYPT_PARAMS, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/**
 * Encrypts a string with AES-256-GCM using scrypt key derivation.
 * Output format: "v1:<iv_b64>:<salt_b64>:<tag_b64>:<ciphertext_b64>"
 */
export async function encrypt(plaintext: string, password: string): Promise<string> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64"),
    salt.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

/**
 * Decrypts a string produced by `encrypt()`.
 * Throws if the password is wrong or the ciphertext is tampered.
 */
export async function decrypt(ciphertext: string, password: string): Promise<string> {
  const parts = ciphertext.split(":");
  if (parts[0] !== "v1" || parts.length !== 5) {
    throw new Error(`Unknown encryption format: expected "v1:<iv>:<salt>:<tag>:<data>"`);
  }
  // Non-null assertions are safe: length check above guarantees all 5 parts exist
  const iv   = Buffer.from(parts[1]!, "base64");
  const salt = Buffer.from(parts[2]!, "base64");
  const tag  = Buffer.from(parts[3]!, "base64");
  const data = Buffer.from(parts[4]!, "base64");
  const key = await deriveKey(password, salt);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/**
 * Returns a deep copy of state with sensitive fields encrypted:
 * - HyperdriveOutput.origin
 * - storedSecrets values
 */
export async function encryptState(state: StageState, password: string): Promise<StageState> {
  const clone = structuredClone(state);

  for (const resource of Object.values(clone.resources)) {
    if (resource.type === "hyperdrive" && resource.output) {
      const out = resource.output as HyperdriveOutput;
      if (out.origin && !out.origin.startsWith("v1:")) {
        out.origin = await encrypt(out.origin, password);
      }
    }
  }

  if (clone.storedSecrets) {
    for (const workerSecrets of Object.values(clone.storedSecrets)) {
      for (const [key, value] of Object.entries(workerSecrets)) {
        if (!value.startsWith("v1:")) {
          workerSecrets[key] = await encrypt(value, password);
        }
      }
    }
  }

  return clone;
}

/**
 * Returns a deep copy of state with all encrypted fields decrypted.
 */
export async function decryptState(state: StageState, password: string): Promise<StageState> {
  const clone = structuredClone(state);

  for (const resource of Object.values(clone.resources)) {
    if (resource.type === "hyperdrive" && resource.output) {
      const out = resource.output as HyperdriveOutput;
      if (out.origin?.startsWith("v1:")) {
        out.origin = await decrypt(out.origin, password);
      }
    }
  }

  if (clone.storedSecrets) {
    for (const workerSecrets of Object.values(clone.storedSecrets)) {
      for (const [key, value] of Object.entries(workerSecrets)) {
        if (value.startsWith("v1:")) {
          workerSecrets[key] = await decrypt(value, password);
        }
      }
    }
  }

  return clone;
}
