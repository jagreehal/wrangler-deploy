/**
 * Wrangler CLI integration for Cloudflare Workers.
 *
 * Provides dev, deploy, and types commands that wrap `wrangler`
 * with node-env-resolver config injection:
 *
 * - **dev**: Serves env via FIFO (secrets never touch disk on Unix),
 *   watches for changes, and auto-restarts wrangler
 * - **deploy**: Splits config into vars (visible) and secrets (hidden),
 *   uploads via wrangler with proper --var and --secrets-file flags
 * - **types**: Generates TypeScript Env interface from config schema
 *
 * @example
 * ```ts
 * import { WranglerFacade } from 'node-env-resolver-cloudflare/wrangler';
 * import { resolveAsync } from 'node-env-resolver';
 * import { dotenv } from 'node-env-resolver/resolvers';
 *
 * const facade = new WranglerFacade({
 *   resolvers: [[dotenv('.env'), { DATABASE_URL: postgres() }]],
 * });
 *
 * // Start dev server with hot reload
 * await facade.dev();
 *
 * // Deploy with vars/secrets split
 * await facade.deploy();
 *
 * // Generate Env types
 * await facade.types();
 * ```
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type {
  Resolver,
  SimpleEnvSchema,
  ResolveOptions,
} from 'node-env-resolver';
import { safeResolveAsync } from 'node-env-resolver';
import { createServingTempFile } from './fifo';
import { addSerializedEnvToRecord } from './chunking';
import { formatEnvFileContent, splitConfigForDeploy } from './format';

const isWindows = process.platform === 'win32';

const CF_SECRET_MAX_BYTES = 5120;

export interface WranglerFacadeOptions {
  /** Resolvers to load config from (same format as resolveAsync) */
  resolvers: Array<[Resolver, SimpleEnvSchema]>;
  /** Resolve options */
  resolveOptions?: Partial<ResolveOptions>;
  /** Paths to watch for changes during dev (default: auto-detected from resolvers) */
  watchPaths?: string[];
  /**
   * Strategy for auto-detecting watch paths when watchPaths is not provided.
   * - auto: use resolver metadata when available, fallback to common .env files
   * - metadata: use resolver metadata only
   * - fallback: ignore resolver metadata and use common .env files
   */
  watchStrategy?: 'auto' | 'metadata' | 'fallback';
  /** Debounce time in ms for file watching (default: 300) */
  watchDebounce?: number;
  /** Whether to include __NER_ENV serialized blob (default: true for dev) */
  includeSerializedEnv?: boolean;
  /** Prefixes that indicate sensitive keys (default: common secret prefixes) */
  sensitivePrefixes?: string[];
  /** Custom wrangler binary name (default: 'wrangler') */
  wranglerBin?: string;
  /** Debug mode — logs extra info */
  debug?: boolean;
}

const debugEnabled = !!process.env.NER_CF_DEBUG;
function debug(label: string, ...args: unknown[]) {
  if (debugEnabled) console.log(`[wrangler-resolve] ${label}`, ...args);
}

function isErrnoENOENT(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'ENOENT'
  );
}

function isSensitiveSchemaValue(value: unknown): boolean {
  if (typeof value === 'function') {
    const validator = value as unknown as Record<string, unknown>;
    return (
      validator.__sensitive === true ||
      validator.sensitive === true ||
      validator.isSensitive === true
    );
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const schemaDef = value as Record<string, unknown>;
    return (
      schemaDef.sensitive === true ||
      schemaDef.isSensitive === true ||
      schemaDef.type === 'secret'
    );
  }

  return false;
}

function deriveSchemaSensitivity(
  resolverTuples: Array<[Resolver, SimpleEnvSchema]>,
): Record<string, boolean> {
  const sensitivityByKey: Record<string, boolean> = {};
  for (const [, schema] of resolverTuples) {
    for (const [key, definition] of Object.entries(schema)) {
      if (isSensitiveSchemaValue(definition)) {
        sensitivityByKey[key] = true;
      }
    }
  }
  return sensitivityByKey;
}

function parseWatchPathsFromResolverName(name?: string): string[] {
  if (!name) return [];

  const dotenvExpandMatch = /^dotenv-expand\((.+)\)$/.exec(name);
  if (dotenvExpandMatch) {
    const base = dotenvExpandMatch[1]!;
    const env = process.env.NODE_ENV || 'development';
    return [
      `${base}.defaults`,
      base,
      `${base}.local`,
      `${base}.${env}`,
      `${base}.${env}.local`,
    ];
  }

  const singlePathResolvers = [
    /^dotenv\((.+)\)$/,
    /^dotenvx\((.+)\)$/,
  ];
  for (const pattern of singlePathResolvers) {
    const match = pattern.exec(name);
    if (match) return [match[1]!];
  }

  const dotenvxKeychainMatch = /^dotenvxKeychain\((.+)\+(.+)\)$/.exec(name);
  if (dotenvxKeychainMatch) {
    return [dotenvxKeychainMatch[1]!, dotenvxKeychainMatch[2]!];
  }

  return [];
}

function extractResolverWatchPaths(resolver: Resolver): string[] {
  const metadata = (resolver as { metadata?: Record<string, unknown> }).metadata;
  if (!metadata) return parseWatchPathsFromResolverName(resolver.name);

  const candidateKeys = ['watchPaths', 'sourceFiles', 'sources'] as const;
  const metadataPaths: string[] = [];

  for (const key of candidateKeys) {
    const raw = metadata[key];
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === 'string' && item.length > 0) metadataPaths.push(item);
      }
    }
  }

  if (metadataPaths.length > 0) return metadataPaths;
  return parseWatchPathsFromResolverName(resolver.name);
}

function spawnWrangler(args: string[], bin: string = 'wrangler'): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: 'inherit',
      shell: isWindows,
    });
    child.on('error', (err) => {
      if (isErrnoENOENT(err)) {
        console.error('Error: wrangler not found. Install it with your package manager:');
        console.error('  npm install wrangler');
      }
      reject(err);
    });
    child.on('exit', (code, signal) => {
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

async function resolvableConfigFromResolvers(
  resolverTuples: Array<[Resolver, SimpleEnvSchema]>,
  resolveOptions?: Partial<ResolveOptions>,
): Promise<Record<string, { value: unknown; isSensitive?: boolean }>> {
  const schemaSensitivity = deriveSchemaSensitivity(resolverTuples);

  // safeResolveAsync returns raw loaded data without schema transformation.
  const rawResult = await safeResolveAsync({
    resolvers: resolverTuples,
    ...(resolveOptions ? { options: resolveOptions } : {}),
  });

  if (!rawResult.success) {
    throw new Error(`Failed to resolve config: ${rawResult.error}`);
  }

  // Build config with sensitivity markers
  const config: Record<string, { value: unknown; isSensitive?: boolean }> = {};
  for (const [key, value] of Object.entries(rawResult.data)) {
    const isSensitive = schemaSensitivity[key];
    config[key] = isSensitive === true ? { value, isSensitive: true } : { value };
  }

  return config;
}

/**
 * Wrangler facade for Cloudflare Workers integration.
 *
 * Wraps `wrangler` CLI commands with config injection from node-env-resolver:
 * - dev: FIFO-based env serving with hot reload
 * - deploy: vars/secrets split with chunking for large payloads
 * - types: Env interface generation
 */
export class WranglerFacade {
  private options: WranglerFacadeOptions;

  constructor(options: WranglerFacadeOptions) {
    this.options = options;
  }

  /**
   * Run `wrangler dev` with env injection via FIFO.
   *
   * - Creates a named pipe (Unix) or temp file (Windows)
   * - Serves resolved config as dotenv content
   * - Watches source files for changes and auto-restarts wrangler
   * - Secrets never touch disk on Unix
   */
  async dev(args: string[] = []): Promise<void> {
    if (args.length === 0) args = process.argv.slice(3);

    // Check for conflicting .dev.vars
    if (existsSync('.dev.vars')) {
      console.error([
        'Error: a .dev.vars file was detected in your project.',
        'This conflicts with wrangler-resolve which manages env vars automatically.',
        'Remove .dev.vars and define your variables in .env files instead.',
      ].join('\n'));
      process.exitCode = 1;
      return;
    }

    const config = await resolvableConfigFromResolvers(
      this.options.resolvers,
      this.options.resolveOptions,
    );
    const serializedJson = JSON.stringify(config);
    const envContent = formatEnvFileContent(
      config,
      this.options.includeSerializedEnv !== false ? serializedJson : undefined,
      this.options.sensitivePrefixes,
    );

    const tmp = createServingTempFile('ner-dev-env');
    debug('dev', 'created serving file at', tmp.filePath);

    let cachedContent = envContent;
    let wranglerChild: ChildProcess | undefined;
    const watchers: Array<ReturnType<typeof watch>> = [];
    const debounceMs = this.options.watchDebounce ?? 300;
    const bin = this.options.wranglerBin ?? 'wrangler';

    const handle = tmp.startServing(() => cachedContent);

    function cleanup() {
      if (restartTimeout) {
        clearTimeout(restartTimeout);
        restartTimeout = undefined;
      }
      handle.stop();
      for (const w of watchers) w.close();
      tmp.cleanup();
    }

    process.on('SIGINT', () => {
      wranglerChild?.kill();
      cleanup();
      process.exit(1);
    });
    process.on('SIGTERM', () => {
      wranglerChild?.kill();
      cleanup();
      process.exit(1);
    });

    // Watch source files for changes
    const watchPaths = this.options.watchPaths ?? this.detectWatchPaths();
    let restartTimeout: ReturnType<typeof setTimeout> | undefined;
    let restartPending = false;

    for (const filePath of watchPaths) {
      const fullPath = isAbsolute(filePath) ? filePath : join(process.cwd(), filePath);
      if (existsSync(fullPath)) {
        try {
          const w = watch(fullPath, () => {
            if (restartTimeout) clearTimeout(restartTimeout);
            restartTimeout = setTimeout(async () => {
              restartTimeout = undefined;
              try {
                const freshConfig = await resolvableConfigFromResolvers(
                  this.options.resolvers,
                  this.options.resolveOptions,
                );
                const freshJson = JSON.stringify(freshConfig);
                cachedContent = formatEnvFileContent(
                  freshConfig,
                  this.options.includeSerializedEnv !== false ? freshJson : undefined,
                  this.options.sensitivePrefixes,
                );
                handle.update(cachedContent);
                console.log('[wrangler-resolve] env changed, restarting wrangler...');
                restartPending = true;
                wranglerChild?.kill();
              } catch (err) {
                console.error('[wrangler-resolve] failed to re-resolve env:', (err as Error).message);
              }
            }, debounceMs);
          });
          watchers.push(w);
          debug('dev', 'watching', fullPath);
        } catch {
          // file may not exist yet
        }
      }
    }

    const varCount = Object.keys(config).length;
    console.log(`\x1b[36m✨ ${varCount} env var${varCount !== 1 ? 's' : ''} resolved by node-env-resolver 🧩\x1b[0m`);

    try {
      while (true) {
        wranglerChild = spawn(bin, [...args, '--env-file', tmp.filePath], {
          stdio: ['inherit', 'pipe', 'pipe'],
          shell: isWindows,
          env: { ...process.env, FORCE_COLOR: '1' },
        });

        const tmpBasename = tmp.filePath.split(/[/\\]/).pop()!;
        const rewriteOutput = (stream: { write: (chunk: string) => unknown }) => (chunk: Buffer) => {
          let str = chunk.toString();
          if (str.includes(tmpBasename)) {
            str = str.replace(/.*ner-dev-env-[a-f0-9]+.*\n?/g, '');
          }
          if (str.includes('Environment Variable')) {
            str = str.replace(/.*Environment Variable.*\n?/g, '');
          }
          if (str) stream.write(str);
        };
        wranglerChild.stdout?.on('data', rewriteOutput(process.stdout));
        wranglerChild.stderr?.on('data', rewriteOutput(process.stderr));

        const exitCode = await new Promise<number>((resolve) => {
          wranglerChild!.on('error', (err) => {
            if (isErrnoENOENT(err)) {
              console.error('Error: wrangler not found. Install it with your package manager.');
            }
            resolve(1);
          });
          wranglerChild!.on('exit', (code, signal) => {
            resolve(code ?? (signal ? 1 : 0));
          });
        });

        // If wrangler exited on its own (not killed by watcher), stop
        if (!restartPending) {
          process.exitCode = exitCode;
          break;
        }
        restartPending = false;
        debug('dev', 'restarting wrangler due to env change');
      }
    } finally {
      cleanup();
    }
  }

  /**
   * Deploy to Cloudflare Workers with vars/secrets split.
   *
   * - Non-sensitive config → `--var KEY:VALUE` flags (visible in CF dashboard)
   * - Sensitive config → secrets file via FIFO (never touches disk on Unix)
   * - Automatically handles 5KB secret chunking
   */
  async deploy(args: string[] = []): Promise<void> {
    if (args.length === 0) args = process.argv.slice(3);

    if (args.includes('--secrets-file')) {
      console.error('Error: --secrets-file is managed automatically by wrangler-resolve.');
      console.error('Remove --secrets-file from your command.');
      process.exitCode = 1;
      return;
    }

    const config = await resolvableConfigFromResolvers(
      this.options.resolvers,
      this.options.resolveOptions,
    );

    const { vars, secrets } = splitConfigForDeploy(config, this.options.sensitivePrefixes);

    // Add serialized env blob as a secret for runtime init
    const serializedJson = JSON.stringify(config);
    addSerializedEnvToRecord(secrets, serializedJson, CF_SECRET_MAX_BYTES);

    // Create FIFO for secrets file
    const tmp = createServingTempFile('ner-secrets');
    const secretsContent = JSON.stringify(secrets);
    const handle = tmp.startServing(() => secretsContent);

    process.on('SIGINT', () => { handle.stop(); tmp.cleanup(); process.exit(1); });
    process.on('SIGTERM', () => { handle.stop(); tmp.cleanup(); process.exit(1); });

    // Build --var flags for non-sensitive config
    const varFlags: string[] = [];
    for (const [key, value] of Object.entries(vars)) {
      varFlags.push('--var', `${key}:${value}`);
    }

    const secretCount = Object.keys(secrets).filter((k) => !k.startsWith('__NER_ENV')).length;
    const varCount = varFlags.length / 2;
    console.log(`\x1b[36m✨ Deploying: ${varCount} var${varCount !== 1 ? 's' : ''}, ${secretCount} secret${secretCount !== 1 ? 's' : ''} 🧩\x1b[0m`);

    const bin = this.options.wranglerBin ?? 'wrangler';
    let exitCode: number;
    try {
      exitCode = await spawnWrangler(
        [...args, ...varFlags, '--secrets-file', tmp.filePath, '--keep-vars=false'],
        bin,
      );
    } finally {
      handle.stop();
      tmp.cleanup();
    }

    process.exitCode = exitCode;
  }

  /**
   * Generate TypeScript Env interface from config schema.
   */
  async types(args: string[] = []): Promise<void> {
    if (args.length === 0) args = process.argv.slice(3);

    const config = await resolvableConfigFromResolvers(
      this.options.resolvers,
      this.options.resolveOptions,
    );

    // Generate stub env file — only key names, no real values
    const envFileLines: string[] = [];
    for (const key in config) {
      envFileLines.push(`${key}=`);
    }

    const tmp = createServingTempFile('ner-types-env');
    const handle = tmp.startServing(() => envFileLines.join('\n'));
    const bin = this.options.wranglerBin ?? 'wrangler';

    try {
      process.exitCode = await spawnWrangler([...args, '--env-file', tmp.filePath], bin);
    } finally {
      handle.stop();
      tmp.cleanup();
    }
  }

  /**
   * Run any wrangler command (passthrough).
   */
  async passthrough(args: string[]): Promise<void> {
    const bin = this.options.wranglerBin ?? 'wrangler';
    const exitCode = await spawnWrangler(args, bin);
    process.exitCode = exitCode;
  }

  /**
   * Auto-detect watch paths from resolvers.
   * Returns common .env file paths to watch.
   */
  private detectWatchPaths(): string[] {
    const strategy = this.options.watchStrategy ?? 'auto';
    const metadataPaths = new Set<string>();
    const fallbackPaths = [
      '.env',
      '.env.local',
      '.env.development',
      '.env.development.local',
    ];

    if (strategy === 'metadata' || strategy === 'auto') {
      for (const [resolver] of this.options.resolvers) {
        for (const p of extractResolverWatchPaths(resolver)) {
          if (p) metadataPaths.add(p);
        }
      }
    }

    if (strategy === 'metadata') {
      return [...metadataPaths];
    }

    if (strategy === 'fallback') {
      return fallbackPaths;
    }

    // auto
    if (metadataPaths.size > 0) {
      return [...metadataPaths];
    }

    return fallbackPaths;
  }
}

// Re-export for direct usage
export { createServingTempFile, type ServingHandle, type TempFileResult } from './fifo';
export { chunkString, addSerializedEnvToRecord, addSerializedEnvToLines, reassembleEnvFromRecord, CF_SECRET_MAX_BYTES } from './chunking';
export { formatEnvLine, formatEnvFileContent, splitConfigForDeploy, isSensitiveKey } from './format';
