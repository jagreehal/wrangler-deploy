// Guardrail: integration tests must not hit a production Cloudflare account.
// Opt-in required via GUARD_TEST_ALLOW_REMOTE, intended only for the
// dedicated test account.
if (process.env.CLOUDFLARE_API_TOKEN && !process.env.GUARD_TEST_ALLOW_REMOTE) {
  throw new Error(
    "Integration tests must not use a real Cloudflare token. " +
      "Set GUARD_TEST_ALLOW_REMOTE=1 only in the dedicated test account."
  );
}
