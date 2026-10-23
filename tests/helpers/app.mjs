import assert from 'node:assert/strict';
import { test as base } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import documents from '../../manufacturer-documents.json' with { type: 'json' };
import { auditStage } from './stage-audit.mjs';
export const root = fileURLToPath(new URL('../../', import.meta.url));
export const dist = join(root, 'dist');
export const userManual = documents.find(document => document.id === 'user').sourceUrl;
export const test = base.extend({
  controlledClock: [false, {
    option: true
  }],
  app: async ({
    page,
    context,
    browser,
    controlledClock
  }, use, testInfo) => {
    const errors = [],
      requests = [];
    const transport = testInfo.project.metadata.transport;
    const httpBase = 'http://127.0.0.1:' + (process.env.VFD_TEST_PORT || 4173) + '/classroom/drive-simulator/';
    const url = name => transport === 'http' ? httpBase + encodeURIComponent(name) : pathToFileURL(join(dist, name)).href;
    const file = url('Simulador de variador.html'),
      guide = url('Simulador de variador, guía de estudio.html');
    const observe = page => page.on('pageerror', error => errors.push(String(error)));
    context.on('page', observe);
    observe(page);
    context.on('request', request => {
      if (!/^(file|blob|data|about):/.test(request.url()) && !request.url().startsWith(httpBase)) requests.push(request.url());
    });
    await context.route('**/*', route => /^(file|blob|data|about):/.test(route.request().url()) || route.request().url().startsWith(httpBase) ? route.continue() : route.abort());
    const ready = async (target = file) => {
      await page.goto(target);
      await page.waitForFunction(() => !!window.VFDSimulator);
      await page.waitForFunction(() => VFDSimulator.getState().dcBus > 300);
    };
    const config = () => page.evaluate(() => VFDSimulator.getConfig());
    const drive = () => page.evaluate(() => VFDSimulator.getState());
    const install = async value => assert.equal((await page.evaluate(text => VFDSimulator.importText(text), JSON.stringify(value))).ok, true);
    const pause = ms => page.waitForTimeout(ms);
    const pointerDown = async selector => {
      const box = await page.locator(selector).boundingBox();
      assert.ok(box);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
    };
    const adjust = async (selector, key) => {
      await page.locator(selector).focus();
      await page.keyboard.press(key);
    };
    const stop = async () => {
      if ((await config()).inputs.LI1) await page.locator('#LI1').click();
      await page.waitForFunction(() => !VFDSimulator.getState().running && VFDSimulator.getState().status !== 'dcb' && Math.abs(VFDSimulator.getState().rFr) < .1);
    };
    const shot = async name => page.screenshot({
      path: testInfo.outputPath(name + '.png')
    });
    const audit = async () => {
      const result = await page.evaluate(auditStage);
      assert.ok(result.counts.wires >= 35 && result.counts.placed >= 25);
      assert.deepEqual(result.problems, []);
    };
    const pixels = () => page.evaluate(() => {
      const canvas = document.getElementById('motor-canvas'),
        gl = canvas.getContext('webgl');
      if (!gl) throw Error('WebGL required');
      VFDSimulator.advance(0);
      const data = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
      let shaded = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) shaded++;
      return {
        shaded,
        total: canvas.width * canvas.height,
        width: canvas.width,
        height: canvas.height,
        error: gl.getError()
      };
    });
    if (controlledClock) await page.clock.install();
    await ready();
    const original = await config();
    try {
      await use({
        page,
        context,
        browser,
        file,
        guide,
        index: url('index.html'),
        ready,
        config,
        drive,
        install,
        pause,
        pointerDown,
        adjust,
        stop,
        shot,
        audit,
        pixels,
        original,
        errors,
        requests,
        output: testInfo.outputDir,
        wallTime: []
      });
    } finally {
      assert.deepEqual(errors, []);
      assert.deepEqual(requests, []);
    }
  }
});
