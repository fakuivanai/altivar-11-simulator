// Build isolated component pages from the same source modules as the application.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { transformAsync } from '@babel/core';
import solid from 'babel-preset-solid';
import typescript from '@babel/preset-typescript';
const root = fileURLToPath(new URL('../../', import.meta.url));
const observations = new WeakMap();
async function compile(code, filename) {
  const result = await transformAsync(code, {
    filename,
    babelrc: false,
    configFile: false,
    presets: [[solid, {
      generate: 'dom'
    }], [typescript, {
      onlyRemoveTypeImports: true
    }]]
  });
  assert.ok(result?.code, 'The fixture compiler must produce code.');
  return result.code;
}
export async function bundleFixture(contents, name, tsx = false) {
  const code = tsx ? await compile(contents, join(root, name + '.tsx')) : contents;
  const result = await build({
    absWorkingDir: root,
    stdin: {
      contents: code,
      resolveDir: root,
      loader: 'js'
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    conditions: ['browser'],
    target: 'es2020',
    define: {
      'process.env.NODE_ENV': '"production"'
    },
    plugins: [{
      name: 'solid-fixture',
      setup(builder) {
        builder.onLoad({
          filter: /\.tsx$/
        }, async args => ({
          contents: await compile(await readFile(args.path, 'utf8'), args.path),
          loader: 'js'
        }));
      }
    }]
  });
  assert.equal(result.outputFiles.length, 1);
  return result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
}
export async function openFixture(page, testInfo, {
  name,
  script,
  body,
  style
}) {
  const html = '<!doctype html><html lang="es"><head><meta charset="utf-8">' + '<title>' + name + '</title><style>' + style + '</style></head><body>' + body + '<script>' + script + '</script></body></html>';
  const filename = testInfo.outputPath(name + '.html');
  await mkdir(dirname(filename), {
    recursive: true
  });
  await writeFile(filename, html);
  const errors = [],
    requests = [];
  const http = 'http://127.0.0.1:' + (process.env.VFD_TEST_PORT || 4173) + '/classroom/drive-simulator/';
  const url = testInfo.project.metadata.transport === 'http' ? http + '__fixtures__/' + name + '.html' : pathToFileURL(filename).href;
  page.on('pageerror', error => errors.push(String(error)));
  page.on('request', request => {
    if (!/^(file|blob|data|about):/.test(request.url()) && request.url() !== url) requests.push(request.url());
  });
  await page.route('**/*', route => /^(file|blob|data|about):/.test(route.request().url()) ? route.continue() : route.request().url() === url ? route.fulfill({
    path: filename,
    contentType: 'text/html'
  }) : route.abort());
  observations.set(page, {
    errors,
    requests
  });
  await page.goto(url);
}
export function assertFixtureClean(page) {
  const observation = observations.get(page);
  assert.ok(observation, 'The fixture page must have been opened.');
  assert.deepEqual(observation.errors, []);
  assert.deepEqual(observation.requests, []);
}
