// esbuild로 React 클라이언트를 client/dist 에 번들링
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'client', 'dist');
const watch = process.argv.includes('--watch');

function copyStatic() {
  fs.mkdirSync(out, { recursive: true });
  fs.copyFileSync(path.join(root, 'client', 'index.html'), path.join(out, 'index.html'));
  for (const f of fs.readdirSync(path.join(root, 'client', 'public'))) {
    fs.copyFileSync(path.join(root, 'client', 'public', f), path.join(out, f));
  }
}

const options = {
  entryPoints: { app: path.join(root, 'client', 'src', 'main.jsx'), 'app-style': path.join(root, 'client', 'src', 'styles.css') },
  outdir: out,
  entryNames: '[name]',
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  target: ['es2020'],
  minify: !watch,
  sourcemap: watch,
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
  logLevel: 'info',
  plugins: [
    {
      name: 'static',
      setup(b) {
        b.onEnd(() => {
          copyStatic();
          const css = path.join(out, 'app-style.css');
          if (fs.existsSync(css)) fs.renameSync(css, path.join(out, 'app.css'));
        });
      },
    },
  ],
};

fs.rmSync(out, { recursive: true, force: true });
if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
