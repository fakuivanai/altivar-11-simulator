// Original mobile viewport regression checks. No server or external resources.
// Run: node qa-mobile.mjs [projection HTML] [output directory]
// PLAYWRIGHT_MODULE, BROWSER_PATH and optional WEBKIT_PATH select local tools.
// Toolbar shrinking is a controlled VisualViewport contract fixture. Actual
// mobile metrics, touch controls and multitouch zoom are exercised separately.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {basename, dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const require = createRequire(import.meta.url);
const {chromium, webkit} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const file = resolve(process.argv[2] || 'Simulador de variador.html');
const guide = join(dirname(file), 'Simulador de variador, guía de estudio.html');
const output = resolve(process.argv[3] || 'qa-mobile-output');
await mkdir(output, {recursive: true});
const inputs = {};
for (const path of [file, guide]) inputs[basename(path)] = createHash('sha256').update(await readFile(path)).digest('hex');
const webkitPath = process.env.WEBKIT_PATH || webkit.executablePath();
const availability = {webkit: {installed: existsSync(webkitPath)}};
const checks = [], snapshots = [], errors = [], externalRequests = [], gestures = [];
const limitations = ['Browser chrome, operating-system keyboards and physical-device safe areas are not reproduced by desktop browser emulation.'];
if (!availability.webkit.installed) limitations.push('A local Playwright WebKit executable is not installed; Safari/iOS remains unverified.');

// Self-contained because Playwright serializes this function into the page.
function inspectViewport() {
  const visual = window.visualViewport;
  const view = visual ? {width: visual.width, height: visual.height, scale: visual.scale,
    left: visual.offsetLeft, top: visual.offsetTop} : {width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight, scale: 1, left: 0, top: 0};
  const rectangle = id => document.getElementById(id)?.getBoundingClientRect().toJSON();
  return {innerWidth, innerHeight, clientWidth: document.documentElement.clientWidth,
    clientHeight: document.documentElement.clientHeight, scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight, visual: view, stage: rectangle('stage'),
    transform: document.getElementById('stage')?.style.transform,
    coarsePointer: matchMedia('(pointer: coarse)').matches, touchPoints: navigator.maxTouchPoints,
    controls: ['LI1', 'LI2', 'LI3', 'LI4', 'LI1-mode', 'LI2-mode', 'LI3-mode', 'LI4-mode', 'analog-type'].map(id => {
      const element = document.getElementById(id), bounds = element?.getBoundingClientRect();
      const hit = bounds && document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      return {id, bounds: bounds?.toJSON(), hit: !!element && (element === hit || element.contains(hit))};
    })};
}
function assertFits(state) {
  assert.ok(state.touchPoints > 0 && state.coarsePointer, 'mobile touch metrics are required');
  assert.ok(Math.abs(state.visual.scale - 1) < .01, 'fit check expects an unzoomed viewport');
  assert.ok(state.scrollWidth <= state.clientWidth + 1 && state.scrollHeight <= state.clientHeight + 1,
    'transformed drawing expands the document: ' + JSON.stringify(state));
  for (const item of [{id: 'stage', bounds: state.stage}, ...state.controls]) {
    const box = item.bounds, view = state.visual;
    assert.ok(box && box.width > 0 && box.height > 0, 'missing or collapsed ' + item.id);
    assert.ok(box.left >= view.left - 1 && box.right <= view.left + view.width + 1
      && box.top >= view.top - 1 && box.bottom <= view.top + view.height + 1,
    item.id + ' outside visual viewport: ' + JSON.stringify({box, view}));
    if ('hit' in item) assert.equal(item.hit, true, item.id + ' is clipped or covered');
  }
}

const browser = await chromium.launch({headless: true, executablePath: process.env.BROWSER_PATH,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
async function run(name, path, viewport, body, init) {
  if (process.env.MOBILE_QA_FILTER && !name.includes(process.env.MOBILE_QA_FILTER)) return;
  const context = await browser.newContext({viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
  const page = await context.newPage();
  page.setDefaultTimeout(3000);
  page.on('pageerror', error => errors.push(String(error)));
  page.on('request', request => { if (!/^(file|blob|data|about):/.test(request.url())) externalRequests.push(request.url()); });
  await page.route('**/*', route => /^(file|blob|data|about):/.test(route.request().url()) ? route.continue() : route.abort());
  await page.addInitScript(() => {
    window.__mobileTouches = [];
    document.addEventListener('pointerdown', event => {
      window.__mobileTouches.push({type: event.pointerType, trusted: event.isTrusted, id: event.target.closest?.('[id]')?.id,
        x: event.clientX, y: event.clientY});
    }, true);
  });
  if (init) await page.addInitScript(init);
  const snapshot = async suffix => {
    await page.waitForTimeout(150);
    const state = await page.evaluate(inspectViewport);
    snapshots.push({name: name + (suffix ? '-' + suffix : ''), ...state});
    await page.screenshot({path: join(output, name + (suffix ? '-' + suffix : '') + '.png')});
    return state;
  };
  try {
    await page.goto(pathToFileURL(path).href); await page.waitForFunction(() => !!window.VFDSimulator);
    await body({page, context, snapshot, viewport});
    checks.push({name, ok: true}); console.log('PASS', name);
  } catch (error) {
    checks.push({name, ok: false, error: String(error.message ?? error)}); console.log('FAIL', name, String(error));
    await snapshot('failure');
  } finally { await context.close(); }
}
async function bottomTouch(page) {
  await page.locator('#LI4').tap(); assert.equal(await page.evaluate(() => VFDSimulator.getConfig().inputs.LI4), true);
  await page.locator('#LI4').tap(); assert.equal(await page.evaluate(() => VFDSimulator.getConfig().inputs.LI4), false);
  await page.locator('#LI4-mode').tap();
  assert.equal(await page.evaluate(() => VFDSimulator.getConfig().inputModes.LI4), 'button');
  await page.locator('#LI4').tap(); assert.equal(await page.evaluate(() => VFDSimulator.getConfig().inputs.LI4), false);
  await page.locator('#LI4-mode').tap();
  assert.equal(await page.evaluate(() => VFDSimulator.getConfig().inputModes.LI4), 'switch');
  assert.ok((await page.evaluate(() => window.__mobileTouches)).some(event => event.type === 'touch' && event.trusted));
}
async function runStopTouch(page) {
  await page.locator('#LI1').tap();
  await page.waitForFunction(() => VFDSimulator.getState().running && VFDSimulator.getState().rpm > 150, undefined, {timeout: 10000});
  await page.locator('#LI1').tap();
  await page.waitForFunction(() => !VFDSimulator.getState().running && VFDSimulator.getState().rpm === 0, undefined, {timeout: 10000});
}
async function touchDrag(cdp, page, from, to) {
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{id: 8, x: from.x, y: from.y}]});
  for (let step = 1; step <= 10; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{id: 8,
      x: from.x + (to.x - from.x) * step / 10, y: from.y + (to.y - from.y) * step / 10}]});
    await page.waitForTimeout(25);
  }
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await page.waitForTimeout(150);
}

try {
  const matrix = [[568, 240], [667, 300], [844, 300], [915, 320], [932, 260], [1024, 256], [1024, 600]];
  for (const [width, height] of matrix) {
    await run('main-' + width + 'x' + height, file, {width, height}, async ({page, snapshot}) => {
      assertFits(await snapshot()); await bottomTouch(page);
      if (width === 1024 && height === 256) await runStopTouch(page);
    });
  }
  for (const [width, height] of [[568, 240], [844, 300], [1024, 256]]) {
    await run('guide-' + width + 'x' + height, guide, {width, height}, async ({page, snapshot}) => {
      assertFits(await snapshot()); await bottomTouch(page);
      if (width === 568) await runStopTouch(page);
    });
  }
  for (const [label, path] of [['main', file], ['guide', guide]]) {
    await run(label + '-rotation', path, {width: 390, height: 844}, async ({page, context, snapshot}) => {
      for (const [width, height] of [[390, 844], [844, 390], [390, 844]]) {
        await page.setViewportSize({width, height}); assertFits(await snapshot(width + 'x' + height));
        await bottomTouch(page);
      }
      if (label === 'guide') {
        const cdp = await context.newCDPSession(page);
        // A real touch drag over the blank left margin scrolls the mobile notes.
        for (let i = 0; i < 3; i += 1) await touchDrag(cdp, page, {x: 8, y: 730}, {x: 8, y: 110});
        const visible = await page.evaluate(() => {
          const guide = document.getElementById('guide'), bounds = guide.getBoundingClientRect();
          return {scroll: document.querySelector('.guide-layout').scrollTop,
            visible: bounds.top < visualViewport.height && bounds.bottom > 0};
        });
        assert.ok(visible.scroll > 100 && visible.visible, 'native touch cannot reach study notes: ' + JSON.stringify(visible));
        await snapshot('notes-scrolled');
      }
    });
    await run(label + '-toolbar-contract', path, {width: 915, height: 412}, async ({page, snapshot}) => {
      for (const height of [412, 320, 260, 412]) {
        await page.evaluate(height => window.__setMobileVisibleHeight(height), height);
        const state = await snapshot('visible-' + height);
        assert.equal(state.clientHeight, 412, 'fixture must retain the larger layout viewport');
        assert.equal(state.visual.height, height); assertFits(state); await bottomTouch(page);
      }
    }, () => {
      let visibleHeight = null;
      const visual = new EventTarget();
      Object.defineProperties(visual, {
        width: {get: () => document.documentElement.clientWidth},
        height: {get: () => visibleHeight ?? document.documentElement.clientHeight},
        scale: {get: () => 1}, offsetLeft: {get: () => 0}, offsetTop: {get: () => 0},
      });
      Object.defineProperty(window, 'visualViewport', {configurable: true, value: visual});
      window.__setMobileVisibleHeight = height => { visibleHeight = height; visual.dispatchEvent(new Event('resize')); };
    });
  }
  await run('native-pinch-and-pan-4to1', file, {width: 1024, height: 256}, async ({page, context, snapshot}) => {
    const initial = await snapshot('before'); assertFits(initial);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 5});
    const canvas = await page.locator('#motor-canvas').boundingBox(); assert.ok(canvas);
    const centerX = canvas.x + canvas.width / 2, y = canvas.y + canvas.height / 2;
    // A sufficient initial span and movement crosses Chromium's native pinch
    // threshold. A short 40px/5-move gesture produces touch events but no zoom.
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{id: 1, x: centerX - 50, y}, {id: 2, x: centerX + 50, y}]});
    for (let step = 1; step <= 10; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{id: 1, x: centerX - 50 - step * 8, y}, {id: 2, x: centerX + 50 + step * 8, y}]});
      await page.waitForTimeout(25);
    }
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    const zoomed = await snapshot('zoomed');
    assert.ok(zoomed.visual.scale > 1.2, 'native multitouch did not zoom');
    assert.equal(zoomed.transform, initial.transform, 'fitting cancels the user pinch');
    let bottom = zoomed;
    const panSteps = [];
    for (let step = 0; step < 20; step += 1) {
      const mode = bottom.controls.find(control => control.id === 'LI4-mode').bounds, view = bottom.visual;
      if (mode.left >= view.left && mode.right <= view.left + view.width
        && mode.top >= view.top && mode.bottom <= view.top + view.height) break;
      // Touch coordinates are relative to the visual viewport in CSS pixels.
      // Start inside it, over background rather than a capturing keypad button.
      const from = await page.evaluate(view => {
        for (const [x, y] of [[.8,.8],[.5,.8],[.2,.8],[.8,.5],[.2,.5],[.5,.5]]) {
          const element = document.elementFromPoint(view.left + x * view.width, view.top + y * view.height);
          if (element && !element.closest('button,input,select,a')) return {x: x * view.width, y: y * view.height};
        }
        return null;
      }, view);
      assert.ok(from, 'no visible background for a native pan');
      const targetLeft = Math.max(0, Math.min(bottom.clientWidth - view.width, mode.left + mode.width / 2 - view.width / 2));
      const targetTop = Math.max(0, Math.min(bottom.clientHeight - view.height, mode.top + mode.height / 2 - view.height / 2));
      const dx = Math.max(-(view.width - from.x - 1), Math.min(from.x - 1, targetLeft - view.left));
      const dy = Math.max(-(view.height - from.y - 1), Math.min(from.y - 1, targetTop - view.top));
      await touchDrag(cdp, page, from, {x: from.x - dx, y: from.y - dy});
      bottom = await page.evaluate(inspectViewport); panSteps.push(bottom.visual);
      assert.equal(bottom.transform, initial.transform, 'drawing follows visual viewport pan offsets');
    }
    bottom = await snapshot('zoomed-bottom');
    const moved = Math.abs(bottom.visual.left - zoomed.visual.left) + Math.abs(bottom.visual.top - zoomed.visual.top) > 1;
    assert.equal(moved, true, 'native zoomed viewport cannot pan');
    assert.equal(bottom.transform, initial.transform);
    const mode = bottom.controls.find(control => control.id === 'LI4-mode').bounds;
    assert.ok(mode.left >= bottom.visual.left && mode.right <= bottom.visual.left + bottom.visual.width
      && mode.top >= bottom.visual.top && mode.bottom <= bottom.visual.top + bottom.visual.height,
    'bottom mode control cannot be reached by native zoom/pan');
    // CDP adds visual offsets to obtain PointerEvent.clientX/clientY. Subtract
    // those offsets once; multiplying by the zoom scale would miss the control.
    const tap = {id: 9, x: mode.left + mode.width / 2 - bottom.visual.left,
      y: mode.top + mode.height / 2 - bottom.visual.top};
    for (const expected of ['button', 'switch']) {
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [tap]});
      await page.waitForTimeout(80);
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
      await page.waitForTimeout(350);
      assert.equal(await page.evaluate(() => VFDSimulator.getConfig().inputModes.LI4), expected,
        'native touch cannot operate the bottom mode control after zoom/pan: '
        + JSON.stringify(await page.evaluate(() => window.__mobileTouches.slice(-3))));
    }
    const zoomOutSteps = [];
    let restored = bottom;
    for (let round = 0; round < 3 && restored.visual.scale > 1.01; round += 1) {
      const view = restored.visual;
      const start = await page.evaluate(view => {
        for (const fraction of [.6, .5, .8, .2]) {
          const left = document.elementFromPoint(view.left + .1 * view.width, view.top + fraction * view.height);
          const right = document.elementFromPoint(view.left + .9 * view.width, view.top + fraction * view.height);
          // Maintained contacts and mode buttons allow pinch (manipulation/auto).
          // Avoid the keypad/shaft handlers which intentionally capture holds,
          // and native form widgets that may open their own interface.
          if (left && right && !left.closest('.key,#hold-shaft,input,select') && !right.closest('.key,#hold-shaft,input,select')) {
            return {left: .1 * view.width, right: .9 * view.width, y: fraction * view.height};
          }
        }
        return null;
      }, view);
      assert.ok(start, 'no visible background for native zoom out');
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [
        {id: 1, x: start.left, y: start.y}, {id: 2, x: start.right, y: start.y}]});
      const movement = ((start.right - start.left) / 2 - 8) / 10;
      for (let step = 1; step <= 10; step += 1) {
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [
          {id: 1, x: start.left + movement * step, y: start.y},
          {id: 2, x: start.right - movement * step, y: start.y}]});
        await page.waitForTimeout(25);
      }
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
      await page.waitForTimeout(150); restored = await page.evaluate(inspectViewport);
      zoomOutSteps.push(restored.visual);
      assert.ok(restored.visual.scale < view.scale, 'reverse native pinch does not reduce zoom');
    }
    assertFits(await snapshot('restored')); await bottomTouch(page);
    gestures.push({nativePinch: true, zoom: zoomed.visual.scale, panObserved: moved,
      beforePan: zoomed.visual, panSteps, bottomControlReached: true, bottomPan: bottom.visual,
      nativeZoomOut: true, zoomOutSteps});
  });
  await run('visual-viewport-unavailable-fallback', file, {width: 932, height: 260}, async ({page, snapshot}) => {
    assertFits(await snapshot()); await bottomTouch(page);
  }, () => Object.defineProperty(window, 'visualViewport', {configurable: true, value: undefined}));
  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
} finally {
  const version = browser.version(); await browser.close();
  const receipt = {passed: checks.length > 0 && checks.every(check => check.ok) && errors.length === 0 && externalRequests.length === 0,
    browser: 'Chromium', version, mobile: {isMobile: true, hasTouch: true, deviceScaleFactor: 2}, inputs,
    availability, checks, snapshots, gestures, errors, externalRequests, limitations};
  await writeFile(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
}
const failed = checks.filter(check => !check.ok).length;
console.log(`${checks.length - failed}/${checks.length} passed`);
process.exitCode = failed || errors.length || externalRequests.length ? 1 : 0;
