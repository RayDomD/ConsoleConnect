import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('supabase/functions/console-connect/_internal', { recursive: true });
await build({ entryPoints: ['src/hosted-core.ts'],
  outfile: 'supabase/functions/console-connect/_internal/core.js', bundle: true, platform: 'browser', format: 'esm',
  target: 'es2022' });
