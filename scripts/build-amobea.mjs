import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'simulator/amobea');
const result = await build({
  absWorkingDir: root,
  entryPoints: ['simulator/amobea/src/main.tsx'],
  bundle: true, minify: true, write: false, outdir: out,
  jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{
    name: 'graduate-navigation',
    setup(builder) {
      // Translate only the two approved cross-links; never depend on the sandbox.
      builder.onLoad({ filter: /(?:ThreadStudio|IndividualView)\.tsx$/ }, async ({ path: filename }) => ({
        loader: 'tsx',
        contents: (await readFile(filename, 'utf8'))
          .replace('href="/__mockup/preview/amobea-thread/ThreadStudio"', 'data-amobea-view="thread" href="/simulator/amobea/index.html#thread"')
          .replace('href="/__mockup/preview/amobea-thread/IndividualView"', 'data-amobea-view="individual" href="/simulator/amobea/index.html#individual"'),
      }));
    },
  }],
});
await mkdir(out, { recursive: true });
let version = createHash('sha256');
for (const file of result.outputFiles) {
  version.update(file.contents);
  await writeFile(file.path, file.contents);
}
const hash = version.digest('hex').slice(0, 12);
await writeFile(path.join(out, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Amobea — Church Machine IDE</title>
<link rel="stylesheet" href="./main.css?v=${hash}"></head><body>
<div id="root"></div><noscript>Enable JavaScript to use Amobea. No live machine operations are performed here.</noscript>
<script src="./main.js?v=${hash}" defer></script></body></html>`);
console.log('Built standalone IDE Amobea assets:', hash);
