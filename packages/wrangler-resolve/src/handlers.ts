/**
 * Cloudflare Workers secret reference handler for node-env-resolver.
 *
 * Resolves `cf://` URI references by reading secrets from
 * Cloudflare Workers environment (env bindings).
 *
 * @example
 * ```ts
 * import { resolveAsync } from 'node-env-resolver';
 * import { processEnv } from 'node-env-resolver/resolvers';
 * import { createCloudflareHandler } from 'node-env-resolver-cloudflare/handlers';
 *
 * const config = await resolveAsync({
 *   resolvers: [[processEnv(), { DATABASE_URL: string() }]],
 *   references: {
 *     handlers: { cf: createCloudflareHandler(env) },
 *   },
 * });
 * ```
 */

type CloudflareReferenceHandler = {
  name: string;
  resolve: (reference: string, context?: unknown) => {
    value: string;
    resolvedVia: string;
    metadata: { secretName: string };
  };
  resolveSync?: (reference: string, context?: unknown) => {
    value: string;
    resolvedVia: string;
    metadata: { secretName: string };
  };
};

export interface CloudflareHandlerOptions {
  /**
   * The Cloudflare Workers env object (from the fetch handler or scheduled handler).
   * In Workers, this is the second argument to your exported fetch() function.
   */
  env: Record<string, unknown>;
}

const CF_PATTERN = /^cf:\/\/(.+)$/;

/**
 * Create a Cloudflare Workers reference handler for `cf://` URIs.
 *
 * Inside a Worker, `env` contains both bindings and secrets.
 * This handler lets you dereference `cf://SECRET_NAME` patterns.
 *
 * @param options - Must provide the `env` object from your Worker handler
 *
 * @example
 * ```ts
 * // In your Worker:
 * export default {
 *   async fetch(request, env, ctx) {
 *     const handler = createCloudflareHandler({ env });
 *     const config = await resolveAsync({
 *       resolvers: [[processEnv(), { DB_URL: string() }]],
 *       references: { handlers: { cf: handler } },
 *     });
 *   }
 * };
 * ```
 */
export function createCloudflareHandler(
  options: CloudflareHandlerOptions,
): CloudflareReferenceHandler {
  return {
    name: 'cf',
    resolve(reference: string, _context?: unknown) {
      const match = CF_PATTERN.exec(reference);
      if (!match) {
        throw new Error(
          `Invalid cf reference: "${reference}". Expected format: cf://<secret-name>`,
        );
      }
      const secretName = match[1]!;
      const value = options.env[secretName];

      if (value === undefined || value === null) {
        throw new Error(
          `Cloudflare secret "${secretName}" not found in env bindings. ` +
            `Available bindings: ${Object.keys(options.env).join(', ')}`,
        );
      }

      return {
        value: String(value),
        resolvedVia: 'cf-workers',
        metadata: {
          secretName,
        },
      };
    },
    resolveSync(reference: string, _context?: unknown) {
      const match = CF_PATTERN.exec(reference);
      if (!match) {
        throw new Error(
          `Invalid cf reference: "${reference}". Expected format: cf://<secret-name>`,
        );
      }
      const secretName = match[1]!;
      const value = options.env[secretName];

      if (value === undefined || value === null) {
        throw new Error(
          `Cloudflare secret "${secretName}" not found in env bindings. ` +
            `Available bindings: ${Object.keys(options.env).join(', ')}`,
        );
      }

      return {
        value: String(value),
        resolvedVia: 'cf-workers',
        metadata: {
          secretName,
        },
      };
    },
  };
}

/**
 * Create a Cloudflare handler from a Workers `env` object.
 * Alias for createCloudflareHandler — shorter for inline use.
 */
export const cfHandler = createCloudflareHandler;
