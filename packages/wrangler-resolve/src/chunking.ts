/**
 * Chunking utilities for Cloudflare Workers secrets.
 *
 * Cloudflare limits individual secrets to 5KB. When the serialized env
 * payload exceeds that, we split it into numbered chunks that get
 * reassembled at runtime.
 *
 * @example
 * ```ts
 * import { chunkString, addSerializedEnv } from 'node-env-resolver-cloudflare/chunking';
 *
 * const record: Record<string, string> = { API_KEY: 'secret' };
 * addSerializedEnv(record, jsonString, 5120);
 * // If jsonString ≤ 5120 bytes → record.__NER_ENV = jsonString
 * // If larger → record.__NER_ENV_CHUNKS = "3", record.__NER_ENV_0 = chunk0, ...
 * ```
 */

const DEFAULT_MAX_BYTES = 5120;

/**
 * Split a string into chunks where each chunk's UTF-8 byte length ≤ maxBytes.
 * Never splits a multi-byte character.
 */
export function chunkString(str: string, maxBytes: number = DEFAULT_MAX_BYTES): string[] {
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;

  for (const char of str) {
    const charBytes = Buffer.byteLength(char);
    if (currentBytes + charBytes > maxBytes && current) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += char;
    currentBytes += charBytes;
  }

  if (current) chunks.push(current);
  return chunks;
}

/**
 * Add the serialized env blob to a key-value record.
 *
 * If the value fits in one secret: `record.__NER_ENV = json`
 * If too large: `record.__NER_ENV_CHUNKS = "N"` + `record.__NER_ENV_0`, etc.
 */
export function addSerializedEnvToRecord(
  record: Record<string, string>,
  json: string,
  maxBytes: number = DEFAULT_MAX_BYTES,
): void {
  if (Buffer.byteLength(json) <= maxBytes) {
    record.__NER_ENV = json;
    return;
  }

  const chunks = chunkString(json, maxBytes);
  record.__NER_ENV_CHUNKS = String(chunks.length);
  for (let i = 0; i < chunks.length; i++) {
    record[`__NER_ENV_${i}`] = chunks[i];
  }
}

/**
 * Add the serialized env blob to dotenv-format lines.
 * Splits into chunks if the value exceeds the Cloudflare secret size limit.
 */
export function addSerializedEnvToLines(
  lines: string[],
  json: string,
  maxBytes: number = DEFAULT_MAX_BYTES,
  formatLine: (key: string, value: string) => string,
): void {
  if (Buffer.byteLength(json) <= maxBytes) {
    lines.push(formatLine('__NER_ENV', json));
    return;
  }

  const chunks = chunkString(json, maxBytes);
  lines.push(formatLine('__NER_ENV_CHUNKS', String(chunks.length)));
  for (let i = 0; i < chunks.length; i++) {
    lines.push(formatLine(`__NER_ENV_${i}`, chunks[i]));
  }
}

/**
 * Reassemble a chunked env payload from a record.
 * Reads __NER_ENV directly or __NER_ENV_CHUNKS + __NER_ENV_0..N.
 */
export function reassembleEnvFromRecord(record: Record<string, string>): string | null {
  if (record.__NER_ENV) return record.__NER_ENV;

  const chunkCount = record.__NER_ENV_CHUNKS;
  if (!chunkCount) return null;

  const n = parseInt(chunkCount, 10);
  if (isNaN(n) || n <= 0) return null;

  let assembled = '';
  for (let i = 0; i < n; i++) {
    const chunk = record[`__NER_ENV_${i}`];
    if (chunk === undefined) return null;
    assembled += chunk;
  }

  return assembled;
}

export { DEFAULT_MAX_BYTES as CF_SECRET_MAX_BYTES };