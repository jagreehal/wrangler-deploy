import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/handlers.ts',
    'src/wrangler.ts',
    'src/chunking.ts',
    'src/fifo.ts',
  ],
  outDir: './dist/',
  clean: false,
  format: ['esm', 'cjs'],
  splitting: true,
  sourcemap: process.env.NODE_ENV !== 'production',
  bundle: true,
  watch: false,
  treeshake: true,
  dts: true,
  target: 'es2022',
  minify: process.env.NODE_ENV === 'production',
  keepNames: false,
  removeNodeProtocol: false,
  external: [],
});