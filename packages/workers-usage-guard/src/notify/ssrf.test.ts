import { describe, it, expect } from "vitest";
import { validateWebhookUrl } from "./ssrf.js";

describe("validateWebhookUrl", () => {
  it("accepts https://discord.com/...", () => {
    expect(validateWebhookUrl("https://discord.com/api/webhooks/x/y").ok).toBe(true);
  });

  it("rejects http", () => {
    const r = validateWebhookUrl("http://example.com/x");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/https/i);
  });

  it.each([
    "http://10.0.0.1/x",
    "https://10.0.0.1/x",
    "https://127.0.0.1/x",
    "https://169.254.169.254/x",
    "https://192.168.1.1/x",
    "https://172.16.0.1/x",
    "https://172.31.255.254/x",
    "https://localhost/x",
  ])("rejects %s", (url) => {
    const r = validateWebhookUrl(url);
    expect(r.ok).toBe(false);
  });

  it("accepts an external IP-literal https URL", () => {
    expect(validateWebhookUrl("https://8.8.8.8/x").ok).toBe(true);
  });

  it("rejects malformed URLs", () => {
    expect(validateWebhookUrl("not a url").ok).toBe(false);
  });
});
