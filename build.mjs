// Original offline bundle assembly. Solid's MIT notice is preserved in the HTML.
// TSX goes through Babel with babel-preset-solid (Solid's compiler for JSX), then
// esbuild bundles everything into one inline script for each page.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { transformAsync } from '@babel/core';
import solid from 'babel-preset-solid';
import typescript from '@babel/preset-typescript';

const root = fileURLToPath(new URL('.', import.meta.url));
const source = name => path.join(root, name);
const license = await readFile(source('LICENSES.txt'), 'utf8');
assert.ok(!license.includes('*/'), 'The library notice must fit in a script comment.');

const solidJSX = {
  name: 'solid-jsx',
  setup(builder) {
    builder.onLoad({ filter: /\.tsx$/ }, async args => {
      const code = await readFile(args.path, 'utf8');
      const result = await transformAsync(code, {
        filename: args.path, babelrc: false, configFile: false, sourceMaps: false,
        presets: [[solid, { generate: 'dom' }], [typescript, { onlyRemoveTypeImports: true }]],
      });
      assert.ok(result?.code, 'Babel produced no code for ' + args.path);
      return { contents: result.code, loader: 'js' };
    });
  },
};

const output = await build({
  absWorkingDir: root,
  entryPoints: [source('App.tsx')],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  conditions: ['browser'],
  target: 'es2020',
  // Remove generated source-path comments; retain the dependency license below.
  minifyWhitespace: true,
  legalComments: 'inline',
  banner: { js: `/*\n${license}\n*/` },
  metafile: true,
  plugins: [solidJSX],
  define: { 'process.env.NODE_ENV': '"production"' },
});
assert.equal(output.outputFiles.length, 1, 'The application must produce one inline script.');
const script = output.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const styles = await readFile(source('styles.css'), 'utf8');
assert.ok(!/<\/style/i.test(styles), 'The stylesheet must not close its own element.');
let html = await readFile(source('template.html'), 'utf8');
for (const [marker, value] of [['/*STYLES*/', styles.trim()], ['/*BUNDLE*/', script]]) {
  assert.equal(html.split(marker).length, 2, `Missing or repeated build marker ${marker}`);
  html = html.replace(marker, () => value);
}
await writeFile(source('Simulador de variador.html'), html);
const guideHtml = html.replace('<html lang="es">', '<html lang="es" data-mode="guide">')
  .replace('<title>Simulador de variador</title>', '<title>Simulador de variador, guía de estudio</title>');
assert.notEqual(guideHtml, html, 'The learning page must differ from the projection page.');
await writeFile(source('Simulador de variador, guía de estudio.html'), guideHtml);
await writeFile(source('Manual del simulador de variador.html'), await readFile(source('manual.html')));
await build({ absWorkingDir: root, entryPoints: [source('engine.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: source('engine.cjs'), target: 'node20' });
await build({ absWorkingDir: root, entryPoints: [source('configuration.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: source('configuration.cjs'), target: 'node20' });
await build({ absWorkingDir: root, entryPoints: [source('scales.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: source('scales.cjs'), target: 'node20' });
await build({ absWorkingDir: root, entryPoints: [source('waveforms.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: source('waveforms.cjs'), target: 'node20' });
const bundledLibraries = Object.keys(output.metafile.inputs).filter(name => name.includes('node_modules/'));
assert.ok(bundledLibraries.length > 0, 'The Solid runtime must be embedded.');
assert.ok(bundledLibraries.every(name => name.includes('/solid-js/')), 'A new bundled library requires its license notice.');
console.log(`Simulador de variador.html: ${Buffer.byteLength(html)} bytes`);
