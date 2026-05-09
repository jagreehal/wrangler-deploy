// src/signing.ts

const enc = new TextEncoder();

async function hmac(key: string, data: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signRequest(args: {
  method: string;
  path: string;
  timestamp: string;
  key: string;
}): Promise<string> {
  return hmac(args.key, `${args.method.toUpperCase()}\n${args.path}\n${args.timestamp}`);
}

export async function verifyRequest(args: {
  method: string;
  path: string;
  timestamp: string;
  signature: string;
  key: string;
  now: Date;
  maxSkewSeconds: number;
}): Promise<boolean> {
  const ts = Date.parse(args.timestamp);
  if (Number.isNaN(ts)) return false;
  if (Math.abs(args.now.getTime() - ts) > args.maxSkewSeconds * 1000) return false;
  const expected = await signRequest(args);
  if (expected.length !== args.signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ args.signature.charCodeAt(i);
  return diff === 0;
}
