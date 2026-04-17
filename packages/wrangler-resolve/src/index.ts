/**
 * Cloudflare Workers integration for node-env-resolver.
 *
 * Provides CLI wrappers around `wrangler` for dev/deploy/types
 * with node-env-resolver config injection, FIFO-based secret serving,
 * and automatic vars/secrets splitting.
 *
 * @example
 * ```ts
 * // CLI: npx wrangler-resolve dev
 * // CLI: npx wrangler-resolve deploy
 * // CLI: npx wrangler-resolve types
 *
 * // Programmatic:
 * import { WranglerFacade } from 'node-env-resolver-cloudflare';
 * import { resolveAsync } from 'node-env-resolver';
 * import { dotenv } from 'node-env-resolver/resolvers';
 *
 * const facade = new WranglerFacade({
 *   resolvers: [[dotenv('.env'), { DATABASE_URL: postgres() }]],
 * });
 * await facade.dev();
 * ```
 */

export { WranglerFacade, type WranglerFacadeOptions } from './wrangler';
export { createServingTempFile, type ServingHandle, type TempFileResult } from './fifo';
export { chunkString, addSerializedEnvToRecord, addSerializedEnvToLines, reassembleEnvFromRecord, CF_SECRET_MAX_BYTES } from './chunking';
export { formatEnvLine, formatEnvFileContent, splitConfigForDeploy, isSensitiveKey } from './format';
export { createCloudflareHandler, cfHandler, type CloudflareHandlerOptions } from './handlers';