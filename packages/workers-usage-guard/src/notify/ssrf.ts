export type SsrfValidation = { ok: true } | { ok: false; reason: string };

export type SsrfValidator = { validate: (url: string) => SsrfValidation };

const PRIVATE_V4 = [
  { net: [10, 0, 0, 0], mask: 8 },
  { net: [172, 16, 0, 0], mask: 12 },
  { net: [192, 168, 0, 0], mask: 16 },
  { net: [127, 0, 0, 0], mask: 8 },
  { net: [169, 254, 0, 0], mask: 16 },
  { net: [0, 0, 0, 0], mask: 8 },
];

function ipv4ToInt(parts: number[]): number {
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

function isPrivateV4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const ip = [+m[1]!, +m[2]!, +m[3]!, +m[4]!];
  if (ip.some((o) => o < 0 || o > 255)) return true;
  const ipInt = ipv4ToInt(ip);
  for (const { net, mask } of PRIVATE_V4) {
    const netInt = ipv4ToInt(net);
    const bits = mask === 0 ? 0 : (0xffffffff << (32 - mask)) >>> 0;
    if ((ipInt & bits) === (netInt & bits)) return true;
  }
  return false;
}

export function validateWebhookUrl(raw: string): SsrfValidation {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "malformed URL" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "https required" };
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return { ok: false, reason: "localhost" };
  if (isPrivateV4(host)) return { ok: false, reason: "private or reserved IPv4" };
  return { ok: true };
}

export const ssrfValidator: SsrfValidator = { validate: validateWebhookUrl };
