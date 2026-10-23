// Resource instrumentation is confined to this isolated renderer page.
import { bundleFixture, openFixture } from './bundle-fixture.mjs';
const source = `
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
};`;
let bundled;
export async function openRendererFixture(page, testInfo) {
  const script = await (bundled ??= bundleFixture(source, 'motor-view-fixture'));
  await openFixture(page, testInfo, {
    name: 'motor-view-fixture',
    script,
    body: '<canvas id="motor"></canvas><button id="control">Fixture control</button>',
    style: 'body{margin:24px;background:#fff}canvas{display:block;width:300px;height:175px}button{display:block;margin-top:12px;height:30px}'
  });
  await page.waitForFunction(() => !!window.motorFixture);
}
