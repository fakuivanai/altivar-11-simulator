import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from '../helpers/app.mjs';
test.use({
  controlledClock: true
});
test('Scope traces, zoom, voltage references and integrated audio/fullscreen controls', async ({
  app
}) => {
  const {
    page,
    drive,
    original: factory,
    shot: screenshot
  } = app;
  // Scope samples are about modeled output, independent of host rendering speed.
  const start = Date.now();
  await page.clock.pauseAt(start + 10000);
  const sleep = async milliseconds => {
    await page.evaluate(seconds => VFDSimulator.advance(seconds), milliseconds / 1000);
    await page.clock.runFor(200);
  };
  const value = expression => page.evaluate(expression),
    evaluate = value,
    click = selector => page.locator(selector).click();
  // Counts canvas pixels close to a colour, to tell that a trace was drawn.
  const tracePixels = colour => value("(() => { const c = document.getElementById('scope-canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const [r, g, b] = " + JSON.stringify(colour) + "; let n = 0; for (let k = 0; k < d.length; k += 4) if (Math.abs(d[k] - r) < 40 && Math.abs(d[k + 1] - g) < 40 && Math.abs(d[k + 2] - b) < 40 && d[k + 3] > 200) n++; return n; })()");
  const COLOURS = {
    U: [213, 94, 0],
    V: [0, 114, 178],
    W: [0, 158, 115],
    fundamental: [123, 50, 146]
  };
  await test.step('the scope tab draws the PWM voltage, its fundamental and three currents while running', async () => {
    await evaluate('VFDSimulator.importText(' + JSON.stringify(JSON.stringify(factory)) + ')');
    await click('#tab-scope');
    assert.equal(await page.locator('#scope-periods').getAttribute('aria-pressed'), 'true');
    assert.equal(await value("document.getElementById('tab-scope').getAttribute('aria-selected')"), 'true');
    assert.match(await value("document.getElementById('scope-summary').textContent"), /Sin salida/);
    await click('#LI1');
    await sleep(4500);
    assert.equal((await drive()).outputMode, 'ac');
    for (const name of ['U', 'V', 'W', 'fundamental']) assert.ok((await tracePixels(COLOURS[name])) > 150, name + ' trace missing');
    const summary = await value("document.getElementById('scope-summary').textContent");
    assert.match(summary, /\d+(?:,\d+)? Hz/);
    assert.match(summary, /kHz/);
    assert.match(summary, /cos φ 0,\d{1,3}/);
    await screenshot('scope-periods');
  });
  await test.step('zooming shows individual pulses around the chosen angle', async () => {
    await click('#scope-zoom');
    await sleep(300);
    assert.equal(await value("document.getElementById('scope-zoom').getAttribute('aria-pressed')"), 'true');
    assert.ok(await value("document.getElementById('scope-angle') !== null"));
    await screenshot('scope-zoom');
    await click('#scope-periods');
  });
  await test.step('the voltage selector shows line, phase-to-neutral and pole voltages', async () => {
    for (const kind of ['phase', 'pole', 'line']) {
      await click('#voltage-' + kind);
      await sleep(300);
      assert.equal(await value("document.getElementById('voltage-" + kind + "').getAttribute('aria-pressed')"), 'true');
      assert.ok((await tracePixels(COLOURS.fundamental)) > 150, kind + ': mean voltage trace missing');
      await screenshot('scope-' + kind);
    }
    await click('#scope-zoom');
    await click('#voltage-phase');
    await sleep(300);
    await screenshot('scope-phase-zoom');
    await click('#voltage-line');
    await click('#scope-periods');
  });
  await test.step('opening W leaves two opposite currents on the scope', async () => {
    await click('#phase-W');
    await sleep(1500);
    await screenshot('scope-open-W');
    const state = await drive();
    assert.ok(state.currentImbalance > 50);
    assert.ok(Math.abs(state.phaseCurrentW) < .01);
    assert.ok((await tracePixels(COLOURS.U)) > 150 && (await tracePixels(COLOURS.V)) > 150);
    await click('#phase-W');
    await sleep(2000);
    assert.ok((await drive()).currentImbalance < 10);
  });
  await test.step('sound is off by default and toggles without errors', async () => {
    assert.equal(await value("document.getElementById('sound-toggle').getAttribute('aria-pressed')"), 'false');
    await click('#sound-toggle');
    await sleep(600);
    assert.equal(await value("document.getElementById('sound-toggle').getAttribute('aria-pressed')"), 'true');
    await click('#sound-toggle');
    await sleep(200);
    assert.equal(await value("document.getElementById('sound-toggle').getAttribute('aria-pressed')"), 'false');
  });
  await test.step('the fullscreen button appears exactly where the browser supports it', async () => {
    assert.equal(await value("document.getElementById('fullscreen-toggle') !== null"), await value('document.fullscreenEnabled'));
  });
});
test('Physical scope records live transients and holds single-shot start, load and fault captures', async ({ app }) => {
  const { page, drive, shot } = app;
  await page.clock.pauseAt(Date.now() + 10000);
  await page.locator('#tab-scope').click();
  await page.locator('#scope-history').click();
  assert.equal(await page.locator('#scope-history').getAttribute('aria-pressed'), 'true');
  await page.locator('#scope-duration').selectOption('1');
  const advance = async seconds => {
    await page.evaluate(value => VFDSimulator.advance(value), seconds);
    await page.clock.runFor(200);
  };
  const status = () => page.locator('#scope-capture-status').textContent();
  const canvas = page.locator('#scope-canvas');
  // Keep drawing dimensions fixed while checking retained physical samples.
  // The live summary can wrap and resize the ordinary responsive canvas.
  await canvas.evaluate(element => { element.style.flex = '0 0 ' + element.clientHeight + 'px'; });
  await page.clock.runFor(200);
  const image = async () => {
    const drawn = await canvas.evaluate(element => ({
      data: element.toDataURL(), width: element.width, height: element.height
    }));
    return { width: drawn.width, height: drawn.height,
      hash: createHash('sha256').update(drawn.data).digest('hex') };
  };

  await page.locator('#scope-capture-toggle').click();
  await page.locator('#scope-arm').click();
  assert.equal(await status(), 'Armada');
  assert.equal(await page.locator('#scope-capture-status').getAttribute('title'), 'Esperando: Arranque');
  await page.locator('#LI1').click();
  await advance(1.2);
  assert.equal(await status(), 'Retenida');
  const held = await image();
  await advance(.3);
  assert.deepEqual(await image(), held, 'a completed capture must retain its physical samples at fixed drawing dimensions');
  await shot('scope-captured-start');
  for (const channels of ['mechanical', 'magnetic', 'electrical']) {
    await page.locator('#scope-channels-' + channels).click();
    await page.clock.runFor(200);
    assert.equal(await page.locator('#scope-channels-' + channels).getAttribute('aria-pressed'), 'true');
    await shot('scope-history-' + channels);
  }

  await page.locator('#scope-capture-toggle').click();
  await page.locator('#scope-live').click();
  await page.locator('#scope-capture-toggle').click();
  await page.locator('#scope-trigger').selectOption('load');
  await page.locator('#scope-arm').click();
  await page.locator('#load').focus();
  await page.keyboard.press('ArrowRight');
  await advance(1);
  assert.equal(await status(), 'Retenida');
  await shot('scope-captured-load');

  await page.locator('#scope-capture-toggle').click();
  await page.locator('#scope-live').click();
  await page.locator('#scope-capture-toggle').click();
  await page.locator('#scope-trigger').selectOption('fault');
  await page.locator('#scope-arm').click();
  await page.locator('#short-bridge').click();
  await advance(1);
  assert.equal((await drive()).fault, 'SCF');
  assert.equal(await status(), 'Retenida');
  await shot('scope-captured-fault');
});
test('Scope keeps trace headings and time labels readable at projector and phone viewport sizes', async ({ app }) => {
  const { page, shot } = app;
  await page.clock.pauseAt(Date.now() + 10000);
  await page.locator('#LI1').click();
  await page.evaluate(() => VFDSimulator.advance(4));
  // Observe the real drawing calls without changing the production dimensions.
  await page.evaluate(() => {
    const prototype = CanvasRenderingContext2D.prototype;
    const originalClear = prototype.clearRect, originalText = prototype.fillText, originalRect = prototype.strokeRect;
    window.scopeDrawing = { texts: [], plots: [] };
    prototype.clearRect = function (...args) {
      if (this.canvas.id === 'scope-canvas') window.scopeDrawing = { texts: [], plots: [] };
      return originalClear.apply(this, args);
    };
    prototype.fillText = function (text, x, y, ...rest) {
      if (this.canvas.id === 'scope-canvas') window.scopeDrawing.texts.push({
        text, x, y, width: this.measureText(text).width, align: this.textAlign,
      });
      return originalText.call(this, text, x, y, ...rest);
    };
    prototype.strokeRect = function (x, y, width, height) {
      if (this.canvas.id === 'scope-canvas') window.scopeDrawing.plots.push({ x, y, width, height });
      return originalRect.call(this, x, y, width, height);
    };
  });
  for (const [width, height] of [[1600, 900], [568, 240]]) {
    await page.setViewportSize({ width, height });
    for (const view of ['periods', 'history', 'zoom']) {
      await page.locator('#scope-' + view).click();
      await page.clock.runFor(200);
      const drawing = await page.locator('#scope-canvas').evaluate(canvas => ({
        ...window.scopeDrawing, width: canvas.clientWidth, height: canvas.clientHeight,
        scopeHeight: canvas.parentElement.clientHeight, scopeScrollHeight: canvas.parentElement.scrollHeight,
      }));
      assert.equal(drawing.plots.length, 2);
      assert.ok(drawing.scopeScrollHeight <= drawing.scopeHeight + 1, JSON.stringify(drawing));
      for (const plot of drawing.plots) assert.ok(plot.height >= 100, JSON.stringify(drawing));
      const headings = drawing.texts.filter(text => /^(Tensión|Corrientes)/.test(text.text));
      assert.equal(headings.length, 2);
      headings.forEach((heading, index) => {
        assert.ok(heading.y + 14 < drawing.plots[index].y, JSON.stringify(heading));
        assert.ok(heading.x >= 0 && heading.x + heading.width <= drawing.width);
      });
      const windowLabels = drawing.texts.filter(text => / (?:ms|s)$/.test(text.text));
      assert.equal(windowLabels.length, 2);
      windowLabels.forEach((label, index) => {
        assert.ok(label.y >= drawing.plots[index].y + drawing.plots[index].height);
        assert.ok(label.y + 12 <= drawing.height, JSON.stringify(drawing));
        assert.ok(label.x <= drawing.width && label.x - label.width >= 0);
      });
      if (view === 'history') {
        assert.ok(headings.every(heading => /eficaz|eficaces/.test(heading.text)), 'History must display RMS magnitudes');
        assert.equal(await page.locator('#scope-capture-settings').getAttribute('open'), null);
        await page.locator('#scope-capture-toggle').click();
        const settings = await page.locator('#scope-capture-settings .scope-capture-options').boundingBox();
        const scope = await page.locator('.scope').boundingBox();
        assert.ok(settings.x >= scope.x && settings.x + settings.width <= scope.x + scope.width + 1);
        await page.locator('#scope-capture-toggle').click();
      }
      await shot('scope-' + view + '-' + width + 'x' + height);
    }
  }
});
test('Brake module toggles and guide retains route and fault explanations', async ({
  app
}) => {
  const {
    page,
    ready,
    guide,
    config
  } = app;
  await page.locator('#brake-module').click();
  assert.equal((await config()).inputs.brakeModule, true);
  assert.equal(await page.locator('#brake-state').textContent(), 'Conectado');
  await page.locator('#brake-module').click();
  assert.equal((await config()).inputs.brakeModule, false);
  await ready(guide);
  const guideText = () => page.locator('#guide').innerText();
  await page.locator('#up').click();
  await page.locator('#up').click();
  assert.match(await guideText(), /Menú|Funciones|Supervisión|Control/);
  await page.evaluate(() => VFDSimulator.navigate('ACC'));
  await page.locator('#ent').click();
  await page.locator('#up').click();
  assert.match(await guideText(), /Manual, pág\. 57/);
  await page.locator('#esc').click();
  await page.locator('#esc').click();
  assert.equal(await page.locator('#guide tr.row').count(), 82);
  await page.evaluate(() => [...document.querySelectorAll('#guide tr.row')].find(row => row.title === 'Tipo de mando').click());
  assert.equal(await page.locator('#display').textContent(), 'ACt');
  assert.match(await guideText(), /2C\s*Dos hilos/);
  for (let i = 0; i < 3; i++) await page.locator('#esc').click();
  await page.locator('#short-bridge').click();
  await page.locator('#LI1').click();
  await page.waitForFunction(() => VFDSimulator.getState().fault === 'SCF');
  const text = await guideText();
  assert.match(text, /En el simulador/);
  assert.match(text, /Eliminar la causa, cortar la red/);
  assert.match(text, /0,4 s/);
});
