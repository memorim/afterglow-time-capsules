import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const requireFromTlock = createRequire(require.resolve('tlock-js'));
await build({
  entryPoints: ['capsule-crypto.js'],
  outfile: 'public/vendor/capsule-crypto.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  alias: { buffer: requireFromTlock.resolve('buffer/') },
  target: 'es2022',
  minify: true,
  legalComments: 'eof',
});
