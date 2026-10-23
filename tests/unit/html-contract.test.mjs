import assert from 'node:assert/strict';
import test from 'node:test';
import {checkPages} from '../../html-checks.ts';

const manual = 'https://manufacturer.invalid/manual.pdf';
const main = 'Simulador de variador.html';
const study = 'Simulador de variador, guía de estudio.html';
function pages() {
  const html = `<!doctype html><html lang="es"><title>Simulator</title><style>body{color:black}</style><div id="app"></div><script id="application">/* MIT License */(()=>{window.VFDSimulator={};const manual="${manual}";})();</script></html>`;
  return new Map([[main, html], [study, html], ['index.html', `<a href="${main}">Simulator</a><a href="${manual}#page=53">Manual</a>`]]);
}
function changeAll(files, before, after) {
  for (const name of [main, study]) files.set(name, files.get(name).replace(before, after));
  return files;
}

test('Standalone output may link to official manuals without downloading runtime assets', () => {
  assert.doesNotThrow(() => checkPages(pages(), [manual]));
});

test('A non-executable or non-invoked application cannot be shipped as a working page', () => {
  assert.throws(() => checkPages(changeAll(pages(), '<script id=', '<script type="application/json" id='), [manual]), /classic JavaScript/);
  assert.throws(() => checkPages(changeAll(pages(), '})();', '});'), [manual]), /invoke itself/);
});

test('Projection and study pages must contain identical runtime code', () => {
  const files = pages();
  files.set(study, files.get(study).replace('window.VFDSimulator={}', 'window.VFDSimulator={changed:true}'));
  assert.throws(() => checkPages(files, [manual]), /same code/);
});

test('Relative links remain valid under a repository subpath', () => {
  const files = pages();
  files.set('index.html', `<a href="/${main}">Simulator</a>`);
  assert.throws(() => checkPages(files, [manual]), /root-relative/);
  files.set('index.html', '<a href="missing.html">Simulator</a>');
  assert.throws(() => checkPages(files, [manual]), /broken link/);
});

test('Runtime downloads and undocumented document hosts are rejected', () => {
  assert.throws(() => checkPages(changeAll(pages(), '<div id="app">', '<img src="https://runtime.invalid/image.png"><div id="app">'), [manual]), /runtime asset/);
  assert.throws(() => checkPages(changeAll(pages(), 'body{color:black}', '@import "https://runtime.invalid/style.css";'), [manual]), /stylesheet/);
  const files = pages();
  files.set('index.html', '<a href="https://other.invalid/manual.pdf">Manual</a>');
  assert.throws(() => checkPages(files, [manual]), /undocumented external link/);
});


test('Explicit scientific references are permitted without weakening the runtime or manual contract', () => {
  const files = pages();
  const reference = 'https://science.invalid/equations.pdf';
  files.set('Documentación del simulador.html', '<a href="' + reference + '">Source</a>');
  assert.throws(() => checkPages(files, [manual]), /undocumented/);
  assert.doesNotThrow(() => checkPages(files, [manual], [reference]));
  assert.throws(() => checkPages(changeAll(files, '<div id="app">', '<img src="' + reference + '"><div id="app">'), [manual], [reference]), /runtime asset/);
});
