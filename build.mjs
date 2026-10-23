// Original offline bundle assembly. Solid's MIT notice is preserved in the HTML.
// TSX goes through Babel with babel-preset-solid (Solid's compiler for JSX), then
// esbuild bundles everything into one inline script for each page.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { transformAsync } from '@babel/core';
import solid from 'babel-preset-solid';
import typescript from '@babel/preset-typescript';
import documents from './manufacturer-documents.json' with { type: 'json' };
import { checkPages } from './html-checks.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const source = name => path.join(root, name);
const destination = path.resolve(root, process.env.BUILD_DIR || 'dist');
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
const guideHtml = html.replace('<html lang="es">', '<html lang="es" data-mode="guide">')
  .replace('<title>Simulador de variador</title>', '<title>Simulador de variador, guía de estudio</title>');
assert.notEqual(guideHtml, html, 'The study page must differ from the projection page.');
const userManual = documents.find(item => item.id === 'user');
const technicalManual = documents.find(item => item.id === 'technical');
assert.ok(userManual && technicalManual, 'Both manufacturer references are required.');
const escape = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const userUrl = userManual.sourceUrl + '#page=' + userManual.pageMapping.SpanishPdf[0];
const index = `<!doctype html>
<html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Simulador de variador</title>
<style>body{margin:2rem;font:20px/1.5 Arial,sans-serif;color:#222}main{max-width:48rem}a{color:#245c76}li{margin:1rem 0}</style>
<main><h1>Simulador de variador de frecuencia</h1>
<p>Modelo didáctico de un ATV11HU09M2E. Los modelos y sus supuestos se explican en la documentación.</p>
<ul><li><a href="Simulador de variador.html">Abrir el simulador para proyección</a></li>
<li><a href="Simulador de variador, guía de estudio.html">Abrir la guía de estudio</a></li>
<li><a href="Documentación del simulador.html">Cómo funciona el simulador</a></li>
<li><a href="Limitaciones del modelo.html">Limitaciones del modelo</a></li></ul>
<p>Las páginas se pueden descargar y abrir sin conexión. Conserve los HTML juntos para seguir los enlaces entre ellos.</p>
<p><a href="${escape(userUrl)}">Descargar manual oficial del fabricante</a>. La sección española comienza en la página 53 del PDF, impresa 52. Su consulta requiere internet.</p></main>
</html>
`;
const manual = `<!doctype html>
<html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="0;url=${escape(userUrl)}"><title>Manual del fabricante</title>
<p><a href="${escape(userUrl)}">Descargar manual oficial. Español: página 53 del PDF, impresa 52.</a></p>
<p><a href="${escape(technicalManual.sourceUrl)}">Descargar referencia técnica oficial</a></p>
<p>Los documentos del fabricante requieren internet.</p>
<p><a href="Simulador de variador.html">Volver al simulador</a></p></html>
`;
// Build-time TypeScript is bundled independently; documentation ships no script.
const documentationBuild = await build({ absWorkingDir: root,
  entryPoints: [source('documentation.ts')], bundle: true, write: false,
  platform: 'node', format: 'esm', target: 'node24', logLevel: 'silent' });
const docs = await import('data:text/javascript;base64,' + Buffer.from(documentationBuild.outputFiles[0].text).toString('base64'));
const documentation = docs.renderDocumentation(await readFile(source('documentation.html'), 'utf8'));
const limitations = await readFile(source('limitations.html'), 'utf8');
const pages = new Map([
  ['index.html', index],
  ['Simulador de variador.html', html],
  ['Simulador de variador, guía de estudio.html', guideHtml],
  ['Manual del simulador de variador.html', manual],
  [docs.DOCUMENTATION_PAGE, documentation],
  [docs.LIMITATIONS_PAGE, limitations],
]);
checkPages(pages, documents.map(item => item.sourceUrl), docs.DOCUMENTATION_REFERENCES);
const existing = await readdir(destination).catch(error => {
  if (error.code === 'ENOENT') return [];
  throw error;
});
assert.ok(existing.every(name => pages.has(name)), 'Build directory contains files outside the HTML output: ' + existing.filter(name => !pages.has(name)).join(', '));
await mkdir(destination, {recursive: true});
for (const [name, content] of pages) await writeFile(path.join(destination, name), content);
const bundledLibraries = Object.keys(output.metafile.inputs).filter(name => name.includes('node_modules/'));
assert.ok(bundledLibraries.length > 0, 'The Solid runtime must be embedded.');
assert.ok(bundledLibraries.every(name => name.includes('/solid-js/')), 'A new bundled library requires its license notice.');
console.log(`Built ${pages.size} checked HTML files in ${path.relative(root, destination) || "."}.`);
