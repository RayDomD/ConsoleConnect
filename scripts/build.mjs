import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/main.ts'], outfile: 'dist/main.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron', 'node-pty'] });
await build({ entryPoints: ['src/preload.ts'], outfile: 'dist/preload.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
await build({ entryPoints: ['src/renderer.ts'], outfile: 'dist/renderer.js', bundle: true, platform: 'browser', format: 'iife' });
await cp('src/index.html', 'dist/index.html');
await cp('src/styles.css', 'dist/styles.css');
await cp('src/discussion.css', 'dist/discussion.css');
await cp('src/decisions.css', 'dist/decisions.css');
await cp('src/terminal.css', 'dist/terminal.css');
await cp('node_modules/@xterm/xterm/css/xterm.css', 'dist/xterm.css');
await mkdir('dist/fonts', { recursive: true });
for (const [pkg, file] of [
  ['newsreader', 'newsreader-latin-opsz-normal.woff2'],
  ['newsreader', 'newsreader-latin-ext-opsz-normal.woff2'],
  ['instrument-sans', 'instrument-sans-latin-wght-normal.woff2'],
  ['instrument-sans', 'instrument-sans-latin-ext-wght-normal.woff2'],
  ['jetbrains-mono', 'jetbrains-mono-latin-wght-normal.woff2'],
  ['jetbrains-mono', 'jetbrains-mono-latin-ext-wght-normal.woff2'],
]) await cp(`node_modules/@fontsource-variable/${pkg}/files/${file}`, `dist/fonts/${file}`);
