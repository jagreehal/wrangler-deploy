/**
 * Default stage name when neither --stage nor project context provides one.
 *
 * A developer's personal stage is their username.
 * Falls back to `dev` only when no username is discoverable (e.g. detached CI
 * containers without a USER set), since deploying to a stage called "unknown"
 * would be confusing.
 *
 * Resolution order:
 *   1. WD_STAGE env (explicit, highest priority for tooling)
 *   2. USER env (Unix)
 *   3. USERNAME env (Windows)
 *   4. "dev" sentinel
 */
export function defaultUserStage(): string {
  const explicit = process.env.WD_STAGE;
  if (explicit && explicit.trim()) return sanitizeStage(explicit.trim());

  const user = process.env.USER ?? process.env.USERNAME;
  if (user && user.trim()) return sanitizeStage(user.trim());

  return "dev";
}

/**
 * Cloudflare resource names allow [a-z0-9-]. Lowercase the username and
 * replace runs of disallowed chars with a single hyphen so a stage of
 * `Jag.Reehal` becomes `jag-reehal`.
 */
function sanitizeStage(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "dev"
  );
}
