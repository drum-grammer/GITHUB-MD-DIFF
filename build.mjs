import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
await build({
  entryPoints: { content: 'src/content.ts', background: 'src/background.ts' },
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  outdir: 'dist',
  logLevel: 'info',
});
cpSync('static', 'dist', { recursive: true });
cpSync('src/styles.css', 'dist/styles.css');
