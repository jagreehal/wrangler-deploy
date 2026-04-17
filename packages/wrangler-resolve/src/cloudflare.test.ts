import { describe, it, expect } from 'vitest';
import type { Resolver } from 'node-env-resolver';
import { secret } from 'node-env-resolver/validators';
import {
  chunkString,
  addSerializedEnvToRecord,
  addSerializedEnvToLines,
  reassembleEnvFromRecord,
  CF_SECRET_MAX_BYTES,
} from './chunking';
import { formatEnvLine, formatEnvFileContent, splitConfigForDeploy, isSensitiveKey } from './format';
import { createCloudflareHandler } from './handlers';
import { WranglerFacade } from './wrangler';

describe('chunking', () => {
  describe('chunkString', () => {
    it('should return single chunk when string fits within maxBytes', () => {
      expect(chunkString('hello', 100)).toEqual(['hello']);
    });

    it('should split string that exceeds maxBytes', () => {
      const long = 'a'.repeat(100);
      const chunks = chunkString(long, 30);
      for (const chunk of chunks) {
        expect(Buffer.byteLength(chunk)).toBeLessThanOrEqual(30);
      }
      expect(chunks.join('')).toBe(long);
    });

    it('should never split multi-byte characters', () => {
      const emojis = '🔒🧩✨🚀';
      const chunks = chunkString(emojis, 5);
      for (const chunk of chunks) {
        expect(chunk.length).toBeGreaterThan(0);
      }
      expect(chunks.join('')).toBe(emojis);
    });

    it('should handle empty string', () => {
      expect(chunkString('', 100)).toEqual([]);
    });

    it('should handle exact boundary size', () => {
      const str = 'a'.repeat(10);
      const chunks = chunkString(str, 10);
      expect(chunks).toEqual([str]);
    });

    it('should produce correct number of chunks', () => {
      const str = 'x'.repeat(25);
      const chunks = chunkString(str, 10);
      expect(chunks).toHaveLength(3);
      expect(chunks.join('')).toBe(str);
    });
  });

  describe('addSerializedEnvToRecord', () => {
    it('should add __NER_ENV directly when within limit', () => {
      const record: Record<string, string> = {};
      addSerializedEnvToRecord(record, '{"key":"value"}');
      expect(record.__NER_ENV).toBe('{"key":"value"}');
      expect(record.__NER_ENV_CHUNKS).toBeUndefined();
    });

    it('should chunk when exceeding limit', () => {
      const record: Record<string, string> = {};
      const large = 'x'.repeat(6000);
      const json = `{"data":"${large}"}`;
      addSerializedEnvToRecord(record, json, 5120);

      expect(record.__NER_ENV).toBeUndefined();
      expect(record.__NER_ENV_CHUNKS).toBeDefined();
      const chunkCount = parseInt(record.__NER_ENV_CHUNKS!, 10);
      expect(chunkCount).toBeGreaterThan(1);

      let reassembled = '';
      for (let i = 0; i < chunkCount; i++) {
        reassembled += record[`__NER_ENV_${i}`];
      }
      expect(reassembled).toBe(json);
    });
  });

  describe('addSerializedEnvToLines', () => {
    it('should add single line when within limit', () => {
      const lines: string[] = [];
      addSerializedEnvToLines(lines, '{"key":"value"}', 5120, formatEnvLine);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("__NER_ENV='");
    });

    it('should add chunked lines when exceeding limit', () => {
      const lines: string[] = [];
      const large = 'x'.repeat(6000);
      const json = `{"data":"${large}"}`;
      addSerializedEnvToLines(lines, json, 5120, formatEnvLine);

      expect(lines.some((l) => l.startsWith("__NER_ENV_CHUNKS="))).toBe(true);
      expect(lines.some((l) => l.startsWith('__NER_ENV_0='))).toBe(true);
    });
  });

  describe('reassembleEnvFromRecord', () => {
    it('should return __NER_ENV directly if present', () => {
      const record = { __NER_ENV: '{"key":"value"}' };
      expect(reassembleEnvFromRecord(record)).toBe('{"key":"value"}');
    });

    it('should reassemble from chunks', () => {
      const json = `{"data":"${'x'.repeat(6000)}"}`;
      const record: Record<string, string> = {};
      addSerializedEnvToRecord(record, json, 5120);
      expect(reassembleEnvFromRecord(record)).toBe(json);
    });

    it('should return null if no env data found', () => {
      expect(reassembleEnvFromRecord({})).toBeNull();
    });

    it('should return null if chunks are incomplete', () => {
      expect(reassembleEnvFromRecord({ __NER_ENV_CHUNKS: '3' })).toBeNull();
    });
  });

  it('should export CF_SECRET_MAX_BYTES as 5120', () => {
    expect(CF_SECRET_MAX_BYTES).toBe(5120);
  });
});

describe('wrangler metadata integration', () => {
  it('uses explicit schema sensitivity from validators', () => {
    const config = {
      API_TOKEN: { value: 'tok_123', isSensitive: (secret() as unknown as { __sensitive?: boolean }).__sensitive },
      PUBLIC_URL: { value: 'https://example.com' },
    };
    const { vars, secrets } = splitConfigForDeploy(config);
    expect(secrets.API_TOKEN).toBe('tok_123');
    expect(vars.PUBLIC_URL).toBe('https://example.com');
  });

  it('detects watch paths from resolver metadata', () => {
    const resolver: Resolver = {
      name: 'custom',
      metadata: { watchPaths: ['.env.custom', '.env.custom.local'] },
      loadSync: () => ({}),
    };
    const facade = new WranglerFacade({ resolvers: [[resolver, {}]] });
    const detectWatchPaths = Reflect.get(facade as unknown as object, 'detectWatchPaths') as () => string[];
    const watchPaths = detectWatchPaths.call(facade);
    expect(watchPaths).toContain('.env.custom');
    expect(watchPaths).toContain('.env.custom.local');
  });

  it('derives watch paths from resolver naming conventions', () => {
    const resolver: Resolver = {
      name: 'dotenvxKeychain(.env.local+.env.local.secrets)',
      loadSync: () => ({}),
    };
    const facade = new WranglerFacade({ resolvers: [[resolver, {}]] });
    const detectWatchPaths = Reflect.get(facade as unknown as object, 'detectWatchPaths') as () => string[];
    const watchPaths = detectWatchPaths.call(facade);
    expect(watchPaths).toContain('.env.local');
    expect(watchPaths).toContain('.env.local.secrets');
  });

  it('uses fallback strategy when explicitly requested', () => {
    const resolver: Resolver = {
      name: 'custom',
      metadata: { watchPaths: ['.env.custom'] },
      loadSync: () => ({}),
    };
    const facade = new WranglerFacade({
      resolvers: [[resolver, {}]],
      watchStrategy: 'fallback',
    });
    const detectWatchPaths = Reflect.get(facade as unknown as object, 'detectWatchPaths') as () => string[];
    const watchPaths = detectWatchPaths.call(facade);
    expect(watchPaths).toEqual([
      '.env',
      '.env.local',
      '.env.development',
      '.env.development.local',
    ]);
  });

  it('uses metadata strategy and does not fallback', () => {
    const resolver: Resolver = {
      name: 'custom',
      metadata: { watchPaths: ['.env.custom'] },
      loadSync: () => ({}),
    };
    const facade = new WranglerFacade({
      resolvers: [[resolver, {}]],
      watchStrategy: 'metadata',
    });
    const detectWatchPaths = Reflect.get(facade as unknown as object, 'detectWatchPaths') as () => string[];
    const watchPaths = detectWatchPaths.call(facade);
    expect(watchPaths).toEqual(['.env.custom']);
  });

  it('returns empty list for metadata strategy when no metadata exists', () => {
    const resolver: Resolver = {
      name: 'custom',
      loadSync: () => ({}),
    };
    const facade = new WranglerFacade({
      resolvers: [[resolver, {}]],
      watchStrategy: 'metadata',
    });
    const detectWatchPaths = Reflect.get(facade as unknown as object, 'detectWatchPaths') as () => string[];
    const watchPaths = detectWatchPaths.call(facade);
    expect(watchPaths).toEqual([]);
  });
});

describe('format', () => {
  describe('formatEnvLine', () => {
    it('should use single quotes for values without single quotes', () => {
      expect(formatEnvLine('KEY', 'value')).toBe("KEY='value'");
    });

    it('should use double quotes with escaping for values with single quotes', () => {
      expect(formatEnvLine('KEY', "it's")).toBe('KEY="it\'s"');
    });

    it('should escape backslashes in double-quoted values', () => {
      expect(formatEnvLine('KEY', "path\\to\\file")).toBe("KEY='path\\to\\file'");
    });

    it('should escape newlines in double-quoted values', () => {
      const val = "it's\nline2";
      expect(formatEnvLine('KEY', val)).toBe('KEY="it\'s\\nline2"');
    });
  });

  describe('formatEnvFileContent', () => {
    it('should format config as dotenv string', () => {
      const config = {
        PORT: { value: 3000, isSensitive: false },
        DATABASE_URL: { value: 'postgres://localhost:5432', isSensitive: true },
      };
      const content = formatEnvFileContent(config);
      expect(content).toContain("PORT='3000'");
      expect(content).toContain("'postgres://localhost:5432'");
      expect(content).toContain('AUTO-GENERATED');
    });

    it('should include serialized env when provided', () => {
      const config = { KEY: { value: 'val' } };
      const json = JSON.stringify(config);
      const content = formatEnvFileContent(config, json);
      expect(content).toContain('__NER_ENV');
    });
  });

  describe('isSensitiveKey', () => {
    it('should use explicit flag when provided', () => {
      expect(isSensitiveKey('MY_VAR', true)).toBe(true);
      expect(isSensitiveKey('MY_VAR', false)).toBe(false);
    });

    it('should detect sensitive keys by prefix', () => {
      expect(isSensitiveKey('SECRET_TOKEN', undefined)).toBe(true);
      expect(isSensitiveKey('API_KEY', undefined)).toBe(true);
      expect(isSensitiveKey('DATABASE_URL', undefined)).toBe(true);
      expect(isSensitiveKey('PASSWORD', undefined)).toBe(true);
      expect(isSensitiveKey('APP_NAME', undefined)).toBe(false);
      expect(isSensitiveKey('PORT', undefined)).toBe(false);
    });

    it('should detect sensitive keys containing prefix in name', () => {
      expect(isSensitiveKey('MY_SECRET_TOKEN', undefined)).toBe(true);
      expect(isSensitiveKey('STRIPE_API_KEY', undefined)).toBe(true);
    });
  });

  describe('splitConfigForDeploy', () => {
    it('should split config into vars and secrets', () => {
      const config = {
        APP_NAME: { value: 'my-app', isSensitive: false },
        PORT: { value: 3000, isSensitive: false },
        API_KEY: { value: 'secret-123', isSensitive: true },
        DATABASE_URL: { value: 'postgres://...', isSensitive: true },
      };

      const { vars, secrets } = splitConfigForDeploy(config);
      expect(vars).toEqual({ APP_NAME: 'my-app', PORT: '3000' });
      expect(secrets).toEqual({ API_KEY: 'secret-123', DATABASE_URL: 'postgres://...' });
    });

    it('should use prefix-based detection when isSensitive not set', () => {
      const config = {
        APP_NAME: { value: 'my-app' },
        SECRET_TOKEN: { value: 'super-secret' },
      };

      const { vars, secrets } = splitConfigForDeploy(config);
      expect(vars.APP_NAME).toBe('my-app');
      expect(secrets.SECRET_TOKEN).toBe('super-secret');
    });
  });
});

describe('handlers', () => {
  describe('createCloudflareHandler', () => {
    it('should create handler with name cf', () => {
      const handler = createCloudflareHandler({ env: {} });
      expect(handler.name).toBe('cf');
    });

    it('should resolve cf:// references from env bindings', () => {
      const handler = createCloudflareHandler({
        env: { MY_SECRET: 'secret-value', API_KEY: 'key-123' },
      });

      const result = handler.resolve('cf://MY_SECRET', {
        key: 'SECRET',
        source: null,
        reference: 'cf://MY_SECRET',
      }) as { value: string; resolvedVia: string; metadata: { secretName: string } };

      expect(result).toEqual({
        value: 'secret-value',
        resolvedVia: 'cf-workers',
        metadata: { secretName: 'MY_SECRET' },
      });
    });

    it('should throw for invalid reference format', () => {
      const handler = createCloudflareHandler({ env: {} });
      expect(() =>
        handler.resolve('invalid-format', {
          key: 'TEST',
          source: null,
          reference: 'invalid-format',
        }),
      ).toThrow('Invalid cf reference');
    });

    it('should throw with available bindings when secret not found', () => {
      const handler = createCloudflareHandler({
        env: { OTHER_KEY: 'value' },
      });

      expect(() =>
        handler.resolve('cf:// MISSING', {
          key: 'TEST',
          source: null,
          reference: 'cf://MISSING',
        }),
      ).toThrow(/not found in env bindings/);
    });

    it('should resolve synchronously via resolveSync', () => {
      const handler = createCloudflareHandler({
        env: { MY_VAR: 'sync-value' },
      });

      const result = handler.resolveSync!('cf://MY_VAR', {
        key: 'VAR',
        source: null,
        reference: 'cf://MY_VAR',
      }) as { value: string; resolvedVia: string };

      expect(result.value).toBe('sync-value');
    });
  });
});
