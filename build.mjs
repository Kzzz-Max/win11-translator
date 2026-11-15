import * as esbuild from 'esbuild';
import { rmSync, mkdirSync, cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outBase = path.join(root, 'dist', 'renderer');
const pages = ['popup', 'overlay', 'result', 'settings'];
const watch = process.argv.includes('--watch');

if (!watch) rmSync(outBase, { recursive: true, force: true });
mkdirSync(outBase, { recursive: true });

const common = {
  bundle: true,
  format: 'iife',
  target: ['chrome122'],
  jsx: 'automatic',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  legalComments: 'none',
  loader: { '.png': 'dataurl', '.svg': 'dataurl', '.woff2': 'dataurl' },
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
  logLevel: 'warning',
};

const builds = pages.map((p) => {
  const dir = path.join(outBase, p);
  mkdirSync(dir, { recursive: true });
  cpSync(path.join(root, 'src', 'renderer', p, 'index.html'), path.join(dir, 'index.html'));
  return {
    ...common,
    entryPoints: [path.join(root, 'src', 'renderer', p, 'main.jsx')],
    outfile: path.join(dir, 'app.js'),
  };
});

if (watch) {
  for (const cfg of builds) {
    const ctx = await esbuild.context(cfg);
    await ctx.watch();
  }
  console.log('[build] watching renderer…');
} else {
  await Promise.all(builds.map((cfg) => esbuild.build(cfg)));
  console.log('[build] renderer built →', outBase);
}
