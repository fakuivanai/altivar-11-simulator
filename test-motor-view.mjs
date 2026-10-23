// Original browser regression checks for the local native WebGL motor renderer.
// Run with the package dependencies installed and Playwright available, as for qa-chromium.mjs.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('.', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'motor-view-test-'));
const errors = [], requests = [], checks = [];
let browser;

// Instrument only the fixture's context. Production geometry and renderer stay unchanged.
const fixture = `
import {makeMotorView} from './motor-view.ts';
const canvas = document.getElementById('motor');
const gl = canvas.getContext('webgl', {alpha:false, antialias:true, depth:true});
if (!gl) throw Error('WebGL is required for the isolated renderer test');
const live = {buffers:new Set(), programs:new Set(), shaders:new Set()};
const allocated = {buffers:[], programs:[]};
const created = {buffers:0, programs:0, shaders:0};
const deleted = {buffers:0, programs:0, shaders:0};
for (const [kind, createName, deleteName] of [
  ['buffers', 'createBuffer', 'deleteBuffer'],
  ['programs', 'createProgram', 'deleteProgram'],
  ['shaders', 'createShader', 'deleteShader'],
]) {
  const allocate = gl[createName].bind(gl), release = gl[deleteName].bind(gl);
  gl[createName] = (...args) => {
    const resource = allocate(...args);
    if (resource !== null) {
      live[kind].add(resource); created[kind]++;
      if (kind in allocated) allocated[kind].push(resource);
    }
    return resource;
  };
  gl[deleteName] = resource => {
    if (resource !== null) {live[kind].delete(resource); deleted[kind]++;}
    release(resource);
  };
}
let losses = 0, restorations = 0, restoredPixels = null;
canvas.addEventListener('webglcontextlost', () => {
  losses++;
  // A lost context invalidates its resources without explicit delete calls.
  for (const resources of Object.values(live)) resources.clear();
});
const view = makeMotorView(canvas);
const extension = gl.getExtension('WEBGL_lose_context');
if (!extension) throw Error('WEBGL_lose_context is required for this test');
function pixels() {
  if (gl.isContextLost()) throw Error('Cannot read pixels from a lost context');
  const bytes = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  const error = gl.getError();
  if (error !== gl.NO_ERROR) throw Error('readPixels failed: ' + error);
  let shaded = 0, minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
  for (let i = 0; i < bytes.length; i += 4) {
    if (bytes[i] < 245 || bytes[i + 1] < 245 || bytes[i + 2] < 245) {
      const pixel = i / 4, x = pixel % canvas.width, y = Math.floor(pixel / canvas.width);
      shaded++; minX = Math.min(minX,x); maxX = Math.max(maxX,x);
      minY = Math.min(minY,y); maxY = Math.max(maxY,y);
    }
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
  return {width:canvas.width, height:canvas.height, shaded, minX, minY, maxX, maxY, data:btoa(binary)};
}
canvas.addEventListener('webglcontextrestored', () => {
  restorations++;
  // The renderer's earlier listener has already redrawn the last physical angle.
  // Read in this event task, before a non-preserved drawing buffer can be discarded.
  restoredPixels = pixels();
});
function metrics() {
  return {
    canvas:canvas.getBoundingClientRect().toJSON(),
    button:document.getElementById('control').getBoundingClientRect().toJSON(),
    width:canvas.width, height:canvas.height, dpr:devicePixelRatio,
    created:{...created}, deleted:{...deleted},
    live:Object.fromEntries(Object.entries(live).map(([key,value]) => [key,value.size])),
    fallbackCount:document.querySelectorAll('[role=status]').length,
    fallbackVisible:[...document.querySelectorAll('[role=status]')].some(e => getComputedStyle(e).display !== 'none'),
    fallbackText:document.querySelector('[role=status]')?.textContent ?? null,
    visibility:canvas.style.visibility, losses, restorations,
  };
}
window.motorFixture = {
  sample(angle) {view.draw(angle); return pixels();},
  draw(angle) {view.draw(angle);}, metrics,
  resize(width,height) {canvas.style.width=width+'px'; canvas.style.height=height+'px';},
  lose() {extension.loseContext();}, restore() {extension.restoreContext();},
  restoredPixels() {return restoredPixels;},
  dispose() {view.dispose(); view.dispose(); gl.useProgram(null);},
  resourceHandlesValid() {
    return {buffers:[...live.buffers].every(r => gl.isBuffer(r)), programs:[...live.programs].every(r => gl.isProgram(r))};
  },
  releasedHandlesInvalid() {
    return {buffers:allocated.buffers.every(r => !gl.isBuffer(r)), programs:allocated.programs.every(r => !gl.isProgram(r))};
  },
  drawAfterDispose() {
    try {view.draw(0); return null;} catch (error) {return String(error);}
  },
};
`;

function decode(sample) {return Buffer.from(sample.data, 'base64');}
function assertGeometry(sample) {
  assert.ok(sample.shaded > sample.width * sample.height * .1, 'The canvas must contain shaded 3D geometry');
  assert.ok(sample.shaded < sample.width * sample.height * .8, 'The motor must fit inside a white canvas');
  assert.ok(sample.minX > 1 && sample.minY > 1 && sample.maxX < sample.width - 2 && sample.maxY < sample.height - 2, 'Geometry must not be clipped at the canvas edges');
}
function assertLayout(before, after) {
  assert.deepEqual(after.canvas, before.canvas, 'Changing backing resolution must not move or resize the canvas');
  assert.deepEqual(after.button, before.button, 'Changing backing resolution must not move neighboring controls');
}
async function openPage(deviceScaleFactor) {
  const page = await browser.newPage({viewport:{width:800,height:600}, deviceScaleFactor});
  page.on('pageerror', error => errors.push(String(error)));
  page.on('request', request => {
    if (!/^(file|blob|data):/.test(request.url())) requests.push(request.url());
  });
  await page.route('**/*', route => /^(file|blob|data):/.test(route.request().url()) ? route.continue() : route.abort());
  await page.goto(pathToFileURL(join(temporary,'fixture.html')).href);
  await page.waitForFunction(() => !!window.motorFixture);
  return page;
}

try {
  await build({stdin:{contents:fixture, resolveDir:root, sourcefile:'motor-view-fixture.mjs', loader:'js'}, bundle:true, format:'iife', target:'es2020', outfile:join(temporary,'fixture.js'), logLevel:'silent'});
  await writeFile(join(temporary,'fixture.html'), '<!doctype html><html><head><meta charset="utf-8"><title>Motor renderer test</title><style>body{margin:24px;background:#fff}canvas{display:block;width:300px;height:175px}button{display:block;margin-top:12px;height:30px}</style></head><body><canvas id="motor"></canvas><button id="control">Fixture control</button><script src="fixture.js"></script></body></html>');
  browser = await chromium.launch({headless:true, executablePath:process.env.BROWSER_PATH, args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page = await openPage(1);
  const before = await page.evaluate(() => motorFixture.metrics());
  const zero = await page.evaluate(() => motorFixture.sample(0));
  assertGeometry(zero);
  assert.equal(zero.width,300); assert.equal(zero.height,175);
  const after = await page.evaluate(() => motorFixture.metrics());
  assert.equal(after.dpr,1); assertLayout(before,after);
  assert.deepEqual(after.live,{buffers:2,programs:1,shaders:0});
  assert.deepEqual(await page.evaluate(() => motorFixture.resourceHandlesValid()),{buffers:true,programs:true});
  checks.push('native WebGL renders shaded geometry with valid buffers and program');

  const quarter = await page.evaluate(() => motorFixture.sample(Math.PI/2));
  const full = await page.evaluate(() => motorFixture.sample(2*Math.PI));
  const zeroBytes=decode(zero), quarterBytes=decode(quarter);
  let changed = 0;
  for (let i=0;i<zeroBytes.length;i+=4) {
    if (zeroBytes[i]!==quarterBytes[i] || zeroBytes[i+1]!==quarterBytes[i+1] || zeroBytes[i+2]!==quarterBytes[i+2]) changed++;
  }
  assert.ok(changed > 100,'The radial reference mark must visibly rotate');
  assert.deepEqual(decode(full),zeroBytes,'A complete physical turn must return the identical image');
  checks.push('draw(0) and draw(pi/2) differ, while draw(2pi) matches draw(0)');

  await page.evaluate(() => {motorFixture.sample(Math.PI/2); motorFixture.lose();});
  await page.waitForFunction(() => motorFixture.metrics().losses===1);
  const lost = await page.evaluate(() => motorFixture.metrics());
  assert.equal(lost.visibility,'hidden'); assert.equal(lost.fallbackVisible,true);
  assert.equal(lost.fallbackText,'Se perdió la vista 3D. Esperando recuperar WebGL.');
  assertLayout(after,lost);
  await page.evaluate(() => motorFixture.draw(Math.PI/2));
  await page.evaluate(() => motorFixture.restore());
  await page.waitForFunction(() => motorFixture.metrics().restorations===1);
  const restored = await page.evaluate(() => motorFixture.metrics());
  assert.equal(restored.fallbackVisible,false); assert.equal(restored.visibility,before.visibility);
  assert.deepEqual(restored.live,{buffers:2,programs:1,shaders:0});
  assert.deepEqual(restored.created,{buffers:4,programs:2,shaders:4});
  assert.deepEqual(decode(await page.evaluate(() => motorFixture.restoredPixels())),quarterBytes,'Restoration must redraw the last physical angle without another draw call');
  assertLayout(after,restored);
  checks.push('context loss shows a local message and restoration recreates resources at the last angle');

  await page.evaluate(() => motorFixture.dispose());
  const disposed = await page.evaluate(() => motorFixture.metrics());
  assert.deepEqual(disposed.live,{buffers:0,programs:0,shaders:0});
  assert.deepEqual(disposed.deleted,{buffers:2,programs:1,shaders:4});
  assert.deepEqual(await page.evaluate(() => motorFixture.releasedHandlesInvalid()),{buffers:true,programs:true});
  assert.equal(disposed.fallbackCount,0); assert.equal(disposed.visibility,before.visibility);
  assert.match(await page.evaluate(() => motorFixture.drawAfterDispose()),/después de liberar/);
  checks.push('idempotent disposal releases GPU resources and removes the local fallback');
  await page.close();

  const dense = await openPage(2);
  for (const [width,height] of [[300,175],[280,160],[320,180],[160,220]]) {
    await dense.evaluate(([width,height]) => motorFixture.resize(width,height),[width,height]);
    const layout = await dense.evaluate(() => motorFixture.metrics());
    const sample = await dense.evaluate(() => motorFixture.sample(Math.PI/2));
    const sized = await dense.evaluate(() => motorFixture.metrics());
    assert.equal(sized.dpr,2); assert.equal(sample.width,width*2); assert.equal(sample.height,height*2);
    assert.equal(sized.canvas.width,width); assert.equal(sized.canvas.height,height);
    assertLayout(layout,sized); assertGeometry(sample);
  }
  checks.push('DPR 2 and four measured canvas sizes retain CSS layout and visible perspective geometry');
  await dense.evaluate(() => motorFixture.lose());
  await dense.waitForFunction(() => motorFixture.metrics().losses===1);
  assert.equal((await dense.evaluate(() => motorFixture.metrics())).fallbackVisible,true);
  await dense.evaluate(() => motorFixture.dispose());
  const stopped = await dense.evaluate(() => motorFixture.metrics());
  assert.equal(stopped.fallbackCount,0); assert.equal(stopped.visibility,'');
  await dense.evaluate(() => motorFixture.restore());
  await dense.waitForFunction(() => motorFixture.metrics().restorations===1);
  const noRestart = await dense.evaluate(() => motorFixture.metrics());
  assert.deepEqual(noRestart.created,stopped.created,'A disposed renderer must not recreate resources on restoration');
  assert.deepEqual(noRestart.live,{buffers:0,programs:0,shaders:0});
  assert.equal(noRestart.fallbackCount,0);
  checks.push('disposal during context loss removes the visible message and prevents restoration from restarting the renderer');
  await dense.close();
  assert.deepEqual(errors,[]); assert.deepEqual(requests,[]);
  const receipt={passed:true,browser:browser.version(),checks,errors,requests,sourceSHA256:createHash('sha256').update(await readFile(join(root,'motor-view.ts'))).digest('hex')};
  if (process.env.MOTOR_VIEW_RECEIPT) await writeFile(process.env.MOTOR_VIEW_RECEIPT,JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt,null,2));
} finally {
  try {if (browser) await browser.close();} finally {await rm(temporary,{recursive:true,force:true});}
}
