#!/usr/bin/env node

/**
 * wrangler-resolve — CLI wrapper around wrangler with node-env-resolver config injection.
 *
 * Commands:
 *   dev                      - Start wrangler dev with FIFO-served env + hot reload
 *   deploy / versions upload - Deploy with vars/secrets split + FIFO secrets file
 *   types                    - Generate Env types from config schema
 *   <any other>              - Passthrough to wrangler
 *
 * Environment variables:
 *   NER_CF_DEBUG=1           - Enable debug logging
 *   NER_CF_CONFIG             - Optional path to a module exporting WranglerFacade options
 */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WranglerFacade } from '../dist/wrangler.js';
import { processEnv } from 'node-env-resolver/resolvers';

async function createFacade() {
  const configPath = process.env.NER_CF_CONFIG;
  if (!configPath) {
    return new WranglerFacade({
      resolvers: [[processEnv(), {}]],
      debug: !!process.env.NER_CF_DEBUG,
    });
  }

  const absolutePath = resolve(process.cwd(), configPath);
  const mod = await import(pathToFileURL(absolutePath).href);
  const options = mod.default ?? mod.options ?? mod;
  if (!options || !Array.isArray(options.resolvers)) {
    throw new Error(
      `NER_CF_CONFIG must export WranglerFacade options with a "resolvers" array. Received: ${typeof options}`,
    );
  }

  return new WranglerFacade({
    ...options,
    debug: options.debug ?? !!process.env.NER_CF_DEBUG,
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('wrangler-resolve: wrangler wrapper with node-env-resolver config injection');
    console.log('Usage: wrangler-resolve <command> [options]');
    console.log('');
    console.log('Enhanced commands:');
    console.log('  dev                      - inject resolved env via named pipe (no secrets on disk)');
    console.log('  deploy / versions upload - upload env as Cloudflare vars and secrets');
    console.log('  types                    - generate types including resolved env vars');
    console.log('');
    console.log('All other commands are passed through to wrangler unchanged.');
    process.exit(0);
  }

  const facade = await createFacade();

  const command = args[0];

  if (command === 'dev') {
    await facade.dev(args);
  } else if (command === 'deploy' || (command === 'versions' && args[1] === 'upload')) {
    await facade.deploy(args);
  } else if (command === 'types') {
    await facade.types(args);
  } else {
    await facade.passthrough(args);
  }
}

main().catch((err) => {
  console.error('wrangler-resolve: unexpected error:', err);
  process.exitCode = 1;
});
