import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, userManual } from '../helpers/app.mjs';
import { auditStage } from '../helpers/stage-audit.mjs';
import documents from '../../manufacturer-documents.json' with { type: 'json' };
for (const [width, height] of [[1024, 768], [1280, 720], [1920, 1080]]) for (const name of ['projection', 'guide']) test(name + ' layout ' + width + 'x' + height, async ({
  app
}) => {
  const {
    page,
    file,
    guide,
    ready,
    audit,
    pixels,
    shot
  } = app;
  const path = name === 'guide' ? guide : file;
  await page.setViewportSize({
    width,
    height
  });
  await ready(path);
  await audit(name + '-' + width);
  const view = await pixels();
  assert.equal(view.error, 0);
  assert.ok(view.shaded > view.total * .05, JSON.stringify(view));
  const boxes = await page.evaluate(() => {
    const stage = document.getElementById('stage').getBoundingClientRect();
    const host = document.getElementById('stage-host')?.getBoundingClientRect();
    return {
      stage: stage.toJSON(),
      host: host?.toJSON(),
      width: innerWidth,
      height: innerHeight
    };
  });
  const container = boxes.host || {
    left: 0,
    top: 0,
    right: width,
    bottom: height
  };
  assert.ok(boxes.stage.left >= container.left - 1 && boxes.stage.right <= container.right + 1);
  assert.ok(boxes.stage.top >= container.top - 1 && boxes.stage.bottom <= container.bottom + 1);
  assert.ok(Math.abs(boxes.stage.width / boxes.stage.height - 16 / 9) < .001);
  const pageSize = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight, innerWidth, innerHeight]);
  assert.ok(pageSize[0] <= pageSize[2] && pageSize[1] <= pageSize[3]);
  await shot(name + '-' + width + 'x' + height);
});
test('the landing page opens both application pages with relative links', async ({
  app
}) => {
  const {
    page,
    index,
    file,
    guide
  } = app;
  for (const [label, target, mode] of [['Abrir el simulador para proyección', file, null], ['Abrir la guía de estudio', guide, 'guide']]) {
    await page.goto(index);
    const manual = page.getByRole('link', {
      name: 'Descargar manual oficial del fabricante',
      exact: true
    });
    assert.equal(await manual.getAttribute('href'), userManual + '#page=53');
    assert.match(await page.locator('main').innerText(), /página 53 del PDF, impresa 52/);
    const link = page.getByRole('link', {
      name: label,
      exact: true
    });
    const href = await link.getAttribute('href');
    assert.equal(href, decodeURIComponent(new URL(target).pathname.split('/').at(-1)));
    await link.click();
    await page.waitForFunction(() => !!window.VFDSimulator && VFDSimulator.getState().dcBus > 300);
    assert.equal(decodeURIComponent(page.url()), decodeURIComponent(target));
    assert.equal(await page.locator('html').getAttribute('data-mode'), mode);
  }
});
test("factory setup, relay, official manual and ENT-ready semantics", async ({
  app
}) => {
  const {
    page,
    drive
  } = app;
  assert.equal((await page.evaluate(() => VFDSimulator.validateConfig(VFDSimulator.getConfig()))).ok, true);
  assert.equal(await page.locator('#display').textContent(), 'rdY');
  assert.equal((await drive()).relay, true);
  assert.ok((await drive()).dcBus > 300);
  await page.locator('#ent').click();
  assert.equal(await page.locator('#display').textContent(), 'rdY');
  assert.equal((await drive()).running, false);
  assert.equal((await page.evaluate(() => VFDSimulator.panel())).editing, null);
  assert.match(await page.locator('#status').textContent(), /LI1/);
  const href = await page.locator('#manufacturer-manual').getAttribute('href');
  assert.equal(href, userManual + '#page=53');
  assert.equal(await page.locator('#manufacturer-manual').getAttribute('title'), 'Descarga oficial del manual. Español: página PDF 53, impresa 52. Requiere internet.');
});
test('official manual clicks support PDF downloads and preserve simulator state', async ({
  app
}) => {
  const context = await app.browser.newContext();
  const unexpected = [],
    errors = [],
    requests = [];
  const base = new URL('./', app.file).href;
  let expectedUrl;
  // A synthetic one-page PDF exercises downloads without fetching manufacturer files.
  const pdf = [
    "%PDF-1.4",
    "1 0 obj",
    "<< /Type /Catalog /Pages 2 0 R >>",
    "endobj",
    "2 0 obj",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "endobj",
    "3 0 obj",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] >>",
    "endobj",
    "xref",
    "0 4",
    "0000000000 65535 f ",
    "0000000009 00000 n ",
    "0000000058 00000 n ",
    "0000000115 00000 n ",
    "trailer",
    "<< /Size 4 /Root 1 0 R >>",
    "startxref",
    "184",
    "%%EOF",
    ""
  ].join('\n');
  context.on('page', page => page.on('pageerror', error => errors.push(String(error))));
  await context.route('**/*', route => {
    const request = route.request();
    if (request.url() === expectedUrl && request.isNavigationRequest() && request.resourceType() === 'document') {
      requests.push(request.url());
      return route.fulfill({
        contentType: 'application/pdf',
        headers: {
          'Content-Disposition': 'attachment; filename="official-manual.pdf"'
        },
        body: Buffer.from(pdf)
      });
    }
    if (/^(data|blob|about):/.test(request.url()) || request.url().startsWith(base)) return route.continue();
    unexpected.push(request.url());
    return route.abort();
  });
  const page = await context.newPage();
  try {
    const technical = documents.find(document => document.id === 'technical');
    assert.ok(technical);
    for (const [target, selector, href, navigate] of [
      [app.file, '#manufacturer-manual', userManual + '#page=53', null],
      [app.guide, '#guide a[href="' + technical.sourceUrl + '#page=38"]', technical.sourceUrl + '#page=38', 'FUn.tLS']
    ]) {
      await page.goto(target);
      await page.waitForFunction(() => !!window.VFDSimulator);
      if (navigate) await page.evaluate(id => VFDSimulator.navigate(id), navigate);
      assert.equal(await page.evaluate(() => VFDSimulator.saveParameter('ACC', 4)), true);
      const before = await page.evaluate(() => VFDSimulator.getConfig());
      const link = page.locator(selector).first();
      if (navigate) assert.equal(await link.textContent(), 'Manual técnico, pág. 101, PDF 38');
      assert.equal(await link.getAttribute('href'), href);
      expectedUrl = href.split('#')[0];
      const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
      assert.equal(download.url(), href);
      assert.equal(download.suggestedFilename(), 'official-manual.pdf');
      assert.equal(page.url(), target);
      assert.deepEqual(await page.evaluate(() => VFDSimulator.getConfig()), before);
      await download.cancel();
    }
    assert.deepEqual(requests, [userManual, technical.sourceUrl]);
    assert.deepEqual(unexpected, []);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
test("native pointer and keyboard keys change exactly one step and ESC cancels", async ({
  app
}) => {
  const {
    page,
    config,
    install,
    original
  } = app;
  await install(original);
  await page.evaluate(() => VFDSimulator.navigate('ACC'));
  await page.locator('#ent').click();
  await page.locator('#up').click();
  assert.equal((await page.evaluate(() => VFDSimulator.panel())).draft, 3.1);
  await page.locator('#esc').click();
  assert.equal((await config()).parameters.ACC, 3);
  await page.locator('#ent').focus();
  await page.keyboard.press('Enter');
  await page.locator('#up').focus();
  await page.keyboard.press('Space');
  assert.equal((await page.evaluate(() => VFDSimulator.panel())).draft, 3.1);
  await page.locator('#ent').focus();
  await page.keyboard.press('Space');
  assert.equal((await config()).parameters.ACC, 3.1);
  await install(original);
});
test("native ENT on unchanged tCC and SFt preserves customized assignments and command state", async ({
  app
}) => {
  const {
    page,
    config,
    drive,
    install,
    original
  } = app;
  const customized = structuredClone(original);
  Object.assign(customized.parameters, {
    'FUn.rrS': 'LI4',
    'FUn.PS2.LIA': 'LI2',
    'FUn.PS2.LIb': 'LI3',
    'FUn.tCC.tCt': 'LEL',
    'FUn.Atr': 'YES',
    'FUn.FLr': 'YES',
    'FUn.SFt.ACt': 'LF',
    'FUn.SFt.SFr': 2
  });
  customized.inputs.LI2 = true;
  await install(customized);
  await page.waitForFunction(() => VFDSimulator.getState().armed && VFDSimulator.getState().status === 'rdY');
  const before = await drive();
  assert.equal(before.running, false);
  assert.equal(before.fault, null);
  await page.evaluate(() => VFDSimulator.navigate('FUn.tCC.ACt'));
  await page.locator('#ent').click();
  assert.equal((await page.evaluate(() => VFDSimulator.panel())).draft, '2C');
  // A normal native click confirms the displayed value; it is not a mode change.
  await page.locator('#ent').click();
  assert.deepEqual((await config()).parameters, customized.parameters);
  assert.deepEqual((await config()).inputs, customized.inputs);
  const confirmed = await drive();
  for (const key of ['armed', 'status', 'running', 'fault', 'direction', 'frequency', 'rampFrequency', 'FrH', 'switchingFrequency']) {
    assert.equal(confirmed[key], before[key], 'unchanged tCC altered ' + key);
  }
  for (const [mode, frequency] of [['LF', 2], ['HF', 8]]) {
    const setting = structuredClone(customized);
    setting.parameters['FUn.SFt.ACt'] = mode;
    setting.parameters['FUn.SFt.SFr'] = frequency;
    await install(setting);
    await page.waitForFunction(() => VFDSimulator.getState().armed);
    await page.evaluate(() => VFDSimulator.navigate('FUn.SFt.ACt'));
    await page.locator('#ent').click();
    await page.locator('#ent').click();
    assert.deepEqual((await config()).parameters, setting.parameters);
    assert.equal((await drive()).armed, true);
    assert.equal((await drive()).status, 'rdY');
    assert.equal((await drive()).switchingFrequency, frequency);
  }
  await install(original);
});
test("native held ENT confirms 3C and LI2 latches while LI1 stops", async ({
  app
}) => {
  const {
    page,
    config,
    drive,
    install,
    pause,
    pointerDown,
    audit,
    original
  } = app;
  await install(original);
  await page.evaluate(() => VFDSimulator.navigate('FUn.tCC.ACt'));
  await page.locator('#ent').click();
  await page.locator('#up').click();
  await page.locator('#ent').click();
  assert.equal((await config()).parameters['FUn.tCC.ACt'], '2C');
  await pointerDown('#ent');
  await pause(2100);
  await page.mouse.up();
  assert.equal((await config()).parameters['FUn.tCC.ACt'], '3C');
  assert.equal((await config()).parameters['FUn.rrS'], 'LI3');
  assert.equal(await page.locator('#LI1-purpose').textContent(), 'Parada');
  assert.equal(await page.locator('#LI2-purpose').textContent(), 'Marcha');
  await page.locator('#esc').click();
  await page.locator('#esc').click();
  await page.locator('#esc').click();
  await page.locator('#LI1').click();
  await page.locator('#LI2').click();
  // These native-input/layout assertions depend on model time, not rendering speed.
  await page.evaluate(() => VFDSimulator.advance(6));
  await page.waitForFunction(() => VFDSimulator.getState().running && VFDSimulator.getState().rpm > 450);
  await page.locator('#LI2').click();
  await pause(100);
  await page.evaluate(() => VFDSimulator.advance(0));
  assert.equal((await drive()).running, true);
  await audit('3C-running');
  await page.locator('#LI1').click();
  await page.evaluate(() => VFDSimulator.advance(6));
  await page.waitForFunction(() => !VFDSimulator.getState().running && Math.abs(VFDSimulator.getState().rpm) < 1);
  await install(original);
});
test("native LI1 starts and stops using real wall time", async ({
  app
}) => {
  const {
    page,
    drive,
    install,
    stop,
    original,
    wallTime
  } = app;
  await install(original);
  const start = performance.now();
  await page.locator('#LI1').click();
  await page.waitForFunction(() => VFDSimulator.getState().running && VFDSimulator.getState().rpm > 600);
  assert.equal(await page.locator('#LI1').getAttribute('aria-pressed'), 'true');
  wallTime.push({
    action: 'LI1 start',
    elapsedMS: Math.round(performance.now() - start),
    rpm: (await drive()).rpm
  });
  const end = performance.now();
  await stop();
  await page.waitForFunction(() => Math.abs(VFDSimulator.getState().rpm) < 1);
  wallTime.push({
    action: 'LI1 stop',
    elapsedMS: Math.round(performance.now() - end),
    rpm: (await drive()).rpm
  });
});
test("native pushbutton, lost capture and window blur release inputs", async ({
  app
}) => {
  const {
    page,
    config,
    drive,
    install,
    pause,
    pointerDown,
    original
  } = app;
  await install(original);
  await page.locator('#LI1-mode').click();
  assert.equal(await page.locator('#LI1-mode').textContent(), 'Pulsador');
  assert.notEqual(await page.locator('#LI1-push').getAttribute('d'), '');
  await pointerDown('#LI1');
  await pause(250);
  assert.equal((await config()).inputs.LI1, true);
  assert.equal((await drive()).running, true);
  await page.mouse.up();
  assert.equal((await config()).inputs.LI1, false);
  await pointerDown('#LI1');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.equal((await config()).inputs.LI1, false);
  await page.mouse.up();
  await page.locator('#LI1').focus();
  await page.keyboard.down('Space');
  assert.equal((await config()).inputs.LI1, true);
  await page.keyboard.up('Space');
  assert.equal((await config()).inputs.LI1, false);
  await install(original);
});
test("native AI1 and relative load sliders update stored values and drawings", async ({
  app
}) => {
  const {
    page,
    config,
    install,
    adjust,
    original
  } = app;
  await install(original);
  const before = await page.locator('#pot-wiper').getAttribute('d');
  await page.locator('#analog-position').evaluate(element => {
    element.value = '90';
    element.dispatchEvent(new Event('input', {
      bubbles: true
    }));
  });
  assert.equal(await page.locator('#analog-reading').textContent(), 'AI1 4.5 V');
  await adjust('#analog-position', 'End');
  assert.equal((await config()).inputs.analogPosition, 100);
  assert.equal(await page.locator('#analog-reading').textContent(), 'AI1 5.0 V');
  assert.notEqual(await page.locator('#pot-wiper').getAttribute('d'), before);
  await adjust('#load', 'Home');
  assert.ok((await config()).mechanical.torque < 0);
  await adjust('#load', 'End');
  assert.ok((await config()).mechanical.torque > 0);
  assert.match(await page.locator('#load-reading').textContent(), /200 % Tn/);
  await adjust('#inertia', 'Home');
  assert.equal((await config()).mechanical.inertia, 0);
  await adjust('#inertia', 'End');
  assert.ok((await config()).mechanical.inertia > 0);
  await adjust('#friction', 'End');
  assert.ok((await config()).mechanical.friction > 0);
  await page.locator('#tab-files').click();
  await adjust('#ventilation', 'Home');
  assert.equal((await config()).inputs.ventilation, 0);
  await adjust('#ventilation', 'End');
  assert.equal((await config()).inputs.ventilation, 1);
  await install(original);
});
test("external 10V/current sources replace the pot and match AI1 readings", async ({
  app
}) => {
  const {
    page,
    config,
    install,
    audit,
    original
  } = app;
  await install(original);
  for (const [type, units, factor] of [['10V', 'V', .1], ['20mA', 'mA', .2], ['5V', 'V', .05]]) {
    await page.locator('#analog-type').selectOption(type);
    assert.equal((await config()).inputs.analogType, type);
    assert.equal(await page.locator('#analog-reading').textContent(), `AI1 ${(original.inputs.analogPosition * factor).toFixed(1)} ${units}`);
    assert.equal(await page.locator('#pot-wiper').count(), type === '5V' ? 1 : 0);
    await audit('AI1-' + type);
  }
});
test("native nameplate fields reject running/invalid changes and update when stopped", async ({
  app
}) => {
  const {
    page,
    config,
    install,
    stop,
    original
  } = app;
  await install(original);
  await page.locator('#LI1').click();
  await page.waitForFunction(() => VFDSimulator.getState().running);
  await page.locator('#tab-motor').click();
  const power = page.locator('#settings .fields input').first();
  assert.equal(await power.isDisabled(), true);
  await power.evaluate(field => {
    field.value = '0.55';
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal((await config()).motor.powerKW, .37);
  assert.equal(await power.inputValue(), '0.37');
  assert.match(await page.locator('#status').textContent(), /Desactive la salida/);
  await stop();
  await page.waitForFunction(() => !document.querySelector('#settings .fields input').disabled);
  await power.fill('0.55');
  await power.press('Tab');
  assert.equal((await config()).motor.powerKW, .55);
  await power.fill('');
  await power.press('Tab');
  assert.equal((await config()).motor.powerKW, .55);
  assert.equal(await power.inputValue(), '0.55');
  await page.locator('#motor-poles').selectOption('6');
  assert.equal((await config()).motor.poles, 4);
  assert.equal(await page.locator('#motor-poles').inputValue(), '4');
  const speed = page.locator('#settings .fields input').nth(4);
  await speed.fill('900');
  await speed.press('Tab');
  await page.locator('#motor-poles').selectOption('6');
  assert.equal((await config()).motor.poles, 6);
  await install(original);
});
test("one open phase has zero current; two opens have no closed circuit", async ({
  app
}) => {
  const {
    page,
    drive,
    install,
    audit,
    original
  } = app;
  await install(original);
  await page.locator('#phase-W').click();
  await page.locator('#LI1').click();
  await page.evaluate(() => VFDSimulator.advance(0));
  await page.waitForFunction(() => VFDSimulator.getState().phaseCurrentU > 0);
  const single = await drive();
  assert.equal(single.phaseCurrentW, 0);
  assert.ok(single.phaseCurrentU > 0);
  assert.ok(single.currentImbalance > 50);
  assert.equal(single.fault, null);
  assert.equal(single.rpm, 0);
  await page.locator('#phase-V').click();
  await page.evaluate(() => VFDSimulator.advance(0));
  await page.waitForFunction(() => VFDSimulator.getState().LCr === 0);
  const open = await drive();
  assert.equal(open.LCr, 0);
  assert.equal(open.phaseCurrentU, 0);
  assert.equal(open.fault, null);
  await audit('two-open-phases');
  await page.locator('#phase-V').click();
  await page.locator('#phase-W').click();
  // Settle reconnection independently of the animation-frame work budget.
  await page.evaluate(() => VFDSimulator.advance(6));
  await page.waitForFunction(() => VFDSimulator.getState().rpm > 450);
  await install(original);
});
test("native shaft hold freezes angle and release resumes acceleration", async ({
  app
}) => {
  const {
    page,
    config,
    drive,
    install,
    pause,
    pointerDown,
    stop,
    original
  } = app;
  // Isolate finite brake mechanics from optional current-load alarms. Other
  // browser cases continue to use the unchanged default classroom bench.
  const mechanics = structuredClone(original);
  mechanics.mechanical.torque = 1.2;
  // This heavier brake/restart fixture uses the IR setting verified by the control tests.
  mechanics.parameters['drC.UFr'] = 100;
  mechanics.parameters['FUn.tOL'] = mechanics.parameters['FUn.tUL'] = 0;
  await install(mechanics);
  await page.locator('#LI1').click();
  await page.evaluate(() => VFDSimulator.advance(4));
  await page.waitForFunction(() => VFDSimulator.getState().rpm > 600);
  await page.evaluate(() => {
    document.addEventListener('pointerdown', event => {
      if (!event.target.closest('#hold-shaft')) return;
      // Public advance drains pending frame time. Flush it before the native
      // brake handler, while the shaft is free, so the later step is exactly 5 ms.
      window.shaftFreeBeforeHold = !VFDSimulator.getConfig().inputs.shaftHeld;
      VFDSimulator.advance(0);
    }, { once: true, capture: true });
    document.addEventListener('pointerdown', event => {
      if (!event.target.closest('#hold-shaft')) return;
      // This listener follows the registered native/delegated UI handler.
      // One physical step distinguishes finite travel from a speed clamp.
      const before = VFDSimulator.getState();
      VFDSimulator.advance(.005);
      window.shaftHoldStep = { held: VFDSimulator.getConfig().inputs.shaftHeld,
        freeBefore: window.shaftFreeBeforeHold, before, after: VFDSimulator.getState() };
    }, { once: true });
  });
  await pointerDown('#hold-shaft');
  const first = await page.evaluate(() => window.shaftHoldStep);
  assert.equal(first.freeBefore, true);
  assert.equal(first.held, true);
  assert.ok(Math.abs(first.after.time - first.before.time - .005) < 1e-9);
  assert.ok(first.after.rpm > 0 && first.after.rpm < first.before.rpm,
    `Finite brake step: ${first.before.rpm} to ${first.after.rpm}rpm`);
  assert.notEqual(first.after.angle, first.before.angle);
  await page.waitForFunction(() => VFDSimulator.getState().rpm === 0 && VFDSimulator.getState().currentLimited);
  const held = await drive();
  assert.equal(held.rpm, 0);
  assert.ok(held.currentLimited);
  assert.ok(held.LCr > 0);
  await pause(150);
  assert.equal((await drive()).angle, held.angle);
  await page.mouse.up();
  assert.equal((await config()).inputs.shaftHeld, false);
  await page.evaluate(() => VFDSimulator.advance(8));
  assert.equal((await drive()).fault, null);
  await page.waitForFunction(() => VFDSimulator.getState().rpm > 600);
  await stop();
});
test("upstream short is inactive at rest and trips SCF despite open motor disconnects", async ({
  app
}) => {
  const {
    page,
    drive,
    install,
    pause,
    shot,
    audit,
    original
  } = app;
  await install(original);
  await page.locator('#phase-U').click();
  await page.locator('#phase-V').click();
  await page.locator('#short-bridge').click();
  await pause(100);
  assert.equal((await drive()).fault, null);
  const position = await page.evaluate(() => {
    const path = document.querySelector('#short-jumper path');
    return {
      x: path.getBBox().x,
      firstBlade: document.getElementById('phase-U-blade').getBBox().x
    };
  });
  assert.ok(position.x < position.firstBlade, 'short must be before motor disconnects');
  await audit('upstream-short-open-phases');
  await page.locator('#LI1').click();
  await page.waitForFunction(() => VFDSimulator.getState().fault === 'SCF');
  assert.equal((await drive()).relay, false);
  assert.equal(await page.locator('#display').textContent(), 'SCF');
  assert.equal(await page.locator('#short-jumper').getAttribute('visibility'), 'visible');
  await shot('projection-SCF');
  await page.locator('#short-bridge').click();
  await page.locator('#LI1').click();
  await page.locator('#power-breaker').click();
  await pause(500);
  assert.equal(await page.locator('#display').textContent(), '');
  await page.locator('#power-breaker').click();
  await page.waitForFunction(() => VFDSimulator.getState().fault === null && VFDSimulator.getState().dcBus > 300);
  assert.equal(await page.locator('#display').textContent(), 'rdY');
  await install(original);
});
test("all 74 settings and 8 monitors remain reachable through real menu routes", async ({
  app
}) => {
  const {
    page,
    install,
    original
  } = app;
  const result = await page.evaluate(original => {
    const covered = new Set(),
      scenarios = [original];
    const expanded = structuredClone(original);
    Object.assign(expanded.parameters, {
      'AIt.ACt': 'CUS',
      'FUn.tCC.tCt': 'LEL',
      'FUn.HSP.LIA': 'LI3',
      'FUn.HSP.LIb': 'LI4',
      'FUn.rP2.LI': 'LI3',
      'FUn.LC2.LI': 'LI4',
      'FUn.FLr': 'YES',
      'FUn.Atr': 'YES',
      'FUn.dO.ACt': 'FtA'
    });
    scenarios.push(expanded);
    const pi = structuredClone(expanded);
    Object.assign(pi.parameters, {
      'FUn.PI.PIF': 'AI1',
      'FUn.rrS': 'nO',
      'FUn.PS2.LIA': 'LI1',
      'FUn.PI.Pr2': 'LI3',
      'FUn.PI.Pr4': 'LI4',
      'FUn.tLS': 1,
      'FUn.dO.ACt': 'CtA'
    });
    scenarios.push(pi);
    for (const scenario of scenarios) {
      const imported = VFDSimulator.importText(JSON.stringify(scenario));
      if (!imported.ok) throw new Error(imported.error);
      for (const metadata of VFDSimulator.CATALOG) {
        if (!VFDSimulator.visible(metadata.id, scenario.parameters)) continue;
        for (let i = 0; i < 8; i += 1) VFDSimulator.escapeKey();
        for (const code of [...metadata.path, metadata.code]) {
          let found = false;
          for (let i = 0; i < 100; i += 1) {
            if (document.getElementById('display').textContent === code) {
              found = true;
              break;
            }
            VFDSimulator.key(-1);
          }
          if (!found) throw new Error('unreachable ' + metadata.id + '/' + code);
          VFDSimulator.enter();
        }
        if (VFDSimulator.panel().editing !== metadata.id) throw new Error('wrong route ' + metadata.id);
        covered.add(metadata.id);
      }
    }
    return {
      covered: [...covered].sort(),
      expected: VFDSimulator.CATALOG.map(metadata => metadata.id).sort()
    };
  }, original);
  assert.equal(result.expected.length, 82);
  assert.deepEqual(result.covered, result.expected);
  await install(original);
});
test("stop-only edits, live ramps, monitor persistence and source backup commands", async ({
  app
}) => {
  const {
    page,
    install,
    stop,
    original
  } = app;
  await install(original);
  await page.locator('#LI1').click();
  await page.waitForFunction(() => VFDSimulator.getState().running);
  assert.equal(await page.evaluate(() => VFDSimulator.saveParameter('drC.UnS', 240)), false);
  assert.equal(await page.evaluate(() => VFDSimulator.saveParameter('ACC', 4)), true);
  await stop();
  const result = await page.evaluate(() => {
    VFDSimulator.navigate('SUP.LCr');
    VFDSimulator.enter();
    const temporary = VFDSimulator.getConfig().driveMemory.monitor;
    VFDSimulator.enter();
    const persistent = VFDSimulator.getConfig().driveMemory.monitor;
    VFDSimulator.saveParameter('ACC', 8);
    VFDSimulator.saveParameter('FUn.SCS', 'YES');
    VFDSimulator.saveParameter('ACC', 3);
    VFDSimulator.saveParameter('FUn.FCS', 'rEC', 2000);
    const recalled = VFDSimulator.getConfig().parameters.ACC;
    VFDSimulator.saveParameter('FUn.FCS', 'InI', 2000);
    return {
      temporary,
      persistent,
      recalled,
      restored: VFDSimulator.getConfig().parameters.ACC
    };
  });
  assert.deepEqual(result, {
    temporary: 'FrH',
    persistent: 'LCr',
    recalled: 8,
    restored: 3
  });
  await install(original);
});
test("COd lock rejects wrong code and admits the matching code", async ({
  app
}) => {
  const {
    page,
    config,
    install,
    original
  } = app;
  await install(original);
  await page.evaluate(() => {
    VFDSimulator.navigate('SUP.COd');
    VFDSimulator.enter();
    VFDSimulator.key(1);
    VFDSimulator.enter();
  });
  assert.equal((await config()).parameters['SUP.COd'], 2);
  assert.equal(await page.evaluate(() => VFDSimulator.saveParameter('ACC', 4)), false);
  await page.evaluate(() => {
    VFDSimulator.key(1);
    VFDSimulator.key(1);
    VFDSimulator.enter();
  });
  assert.match(await page.locator('#status').textContent(), /incorrecto/);
  await page.evaluate(() => {
    VFDSimulator.key(1);
    VFDSimulator.enter();
  });
  assert.equal(await page.evaluate(() => VFDSimulator.saveParameter('ACC', 4)), true);
  await install(original);
});
test("malformed, hidden, dependent and physical inputs reject atomically as values", async ({
  app
}) => {
  const {
    page,
    config,
    install,
    original
  } = app;
  await install(original);
  const before = await config();
  const invalid = ['{', JSON.stringify({
    ...before,
    version: 2
  })];
  for (const mutate of [value => value.parameters.ACC = 100, value => value.parameters.HSP = 5, value => value.parameters['FUn.SFt.SFr'] = 16, value => value.parameters['FUn.PI.PIF'] = 'AI1', value => value.inputs.outputConnections.U = 0, value => delete value.inputs.outputConnections.V, value => value.inputs.outputConnections.T = true, value => value.inputs.shaftHeld = 'yes']) {
    const value = structuredClone(before);
    mutate(value);
    invalid.push(JSON.stringify(value));
  }
  for (const text of invalid) {
    const result = await page.evaluate(text => VFDSimulator.importText(text), text);
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, 'string');
    assert.deepEqual(await config(), before);
  }
});
test("native local download and file picker preserve complete setup without automatic motion", async ({
  app
}) => {
  const {
    page,
    config,
    drive,
    install,
    original,
    output
  } = app;
  await install(original);
  const saved = await config();
  saved.parameters.ACC = 7.5;
  saved.inputs.LI1 = true;
  await install(saved);
  assert.equal((await drive()).running, false);
  await page.locator('#tab-files').click();
  const downloaded = page.waitForEvent('download');
  await page.locator('#export').click();
  const download = await downloaded,
    path = join(output, 'roundtrip.json');
  await download.saveAs(path);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), saved);
  await install(original);
  await page.locator('#import').setInputFiles(path);
  await page.waitForFunction(() => VFDSimulator.getConfig().parameters.ACC === 7.5);
  assert.deepEqual(await config(), saved);
  assert.equal((await drive()).running, false);
  assert.equal(await page.locator('#file-name').textContent(), 'roundtrip.json');
  assert.match(await page.locator('#status').textContent(), /Configuración cargada/);
  const invalid = join(output, 'invalid.json');
  await writeFile(invalid, '{"version":2}');
  await page.locator('#import').setInputFiles(invalid);
  await page.waitForFunction(() => !document.getElementById('status').textContent.startsWith('Configuración cargada'));
  assert.deepEqual(await config(), saved);
  await install(original);
});
test("guide tracks stored/draft values and manual page links", async ({
  app
}) => {
  const {
    page,
    guide,
    ready
  } = app;
  await ready(guide);
  await ready(guide);
  assert.match(await page.locator('#guide').innerText(), /rdY\s*Variador listo/);
  assert.match(await page.locator('.guide-lower').innerText(), /Sin orden de marcha\. Cierre LI1/);
  await page.evaluate(() => VFDSimulator.navigate('ACC'));
  await page.locator('#ent').click();
  await page.locator('#up').click();
  const text = await page.locator('#guide').innerText();
  assert.match(text, /ACC\s*Tiempo de aceleración/);
  assert.match(text, /En edición\s*3\.1 s/);
  assert.equal(await page.locator('#guide a').first().getAttribute('href'), userManual + '#page=58');
  assert.equal(await page.locator('#guide a').first().textContent(), 'Manual, pág. 57, PDF 58');
  await page.locator('#esc').click();
  await page.locator('#esc').click();
  const row = page.locator('#guide tr.row[title="Tiempo de aceleración"]');
  await row.click();
  assert.equal(await page.locator('#display').textContent(), 'ACC');
  assert.equal(await page.locator('#guide tr.row').count(), 82);
  await page.locator('.cfg-tools input').check();
  assert.equal(await page.locator('#guide tr.row').count(), 0);
  await page.evaluate(() => VFDSimulator.saveParameter('ACC', 4));
  assert.equal(await page.locator('#guide tr.row').count(), 1);
  await page.locator('.cfg-tools input').uncheck();
});
test("guide tracks active/last SCF, native hover and current direction", async ({
  app
}) => {
  const {
    page,
    guide,
    ready,
    install,
    pause,
    shot,
    original
  } = app;
  await ready(guide);
  await install(original);
  await page.locator('#short-bridge').click();
  await page.locator('#LI1').click();
  await page.waitForFunction(() => VFDSimulator.getState().fault === 'SCF');
  assert.match(await page.locator('#guide').innerText(), /SCF\s*Cortocircuito en el motor/);
  assert.match(await page.locator('.guide-lower').innerText(), /corto U-V sigue puesto/);
  await page.locator('#short-bridge').click();
  await page.locator('#LI1').click();
  await page.locator('#power-breaker').click();
  await pause(500);
  await page.locator('#power-breaker').click();
  await page.waitForFunction(() => VFDSimulator.getState().fault === null && VFDSimulator.getState().dcBus > 300);
  assert.match(await page.locator('#guide').innerText(), /Última falla, ya rearmada/);
  await page.locator('#brake-module').hover();
  assert.match(await page.locator('.element-help').innerText(), /Módulo de frenado entre PA\/\+ y PC\/-/);
  const reverse = structuredClone(original);
  reverse.parameters['FUn.tCC.tCt'] = 'LEL';
  await install(reverse);
  await page.locator('#LI1').click();
  await page.locator('#LI2').click();
  await page.waitForFunction(() => VFDSimulator.getState().direction === -1 && VFDSimulator.getState().frequency < -1);
  assert.match(await page.locator('.guide-lower').innerText(), /En marcha atrás/);
  await shot('guide-running-reverse');
  await install(original);
});
test("valid extreme motor and load values stay readable inside projector controls", async ({
  app
}) => {
  const {
    page,
    ready,
    install,
    shot,
    audit,
    original
  } = app;
  const failures = [];
  for (const [name, values] of [['high-torque', {
    powerKW: 3,
    speedRPM: 50,
    frequency: 200,
    poles: 12,
    inertia: 2
  }], ['low-torque', {
    powerKW: .05,
    speedRPM: 11999,
    frequency: 200,
    poles: 2,
    inertia: .0001
  }]]) {
    const extreme = structuredClone(original);
    Object.assign(extreme.motor, values);
    Object.assign(extreme.mechanical, {
      torque: 20,
      inertia: 2,
      friction: .2
    });
    for (const [width, height] of [[1024, 768], [1280, 720], [1920, 1080]]) {
      await page.setViewportSize({
        width,
        height
      });
      await ready();
      await install(extreme);
      try {
        await audit(name + '-' + width);
      } catch (error) {
        failures.push(name + '-' + width + ': ' + String(error));
      }
      await shot('projection-' + name + '-' + width);
    }
  }
  await page.setViewportSize({
    width: 1280,
    height: 720
  });
  await ready();
  await install(original);
  assert.deepEqual(failures, []);
});
test("WebGL DPR 2 remains fitted and unavailable WebGL preserves native model controls", async ({
  app
}) => {
  const {
    context,
    browser,
    file
  } = app;
  const high = await browser.newContext({
    viewport: {
      width: 1280,
      height: 720
    },
    deviceScaleFactor: 2
  });
  const dpiPage = await high.newPage();
  await dpiPage.goto(file);
  await dpiPage.waitForFunction(() => !!window.VFDSimulator);
  const dimensions = await dpiPage.locator('#motor-canvas').evaluate(canvas => ({
    width: canvas.width,
    cssWidth: canvas.getBoundingClientRect().width,
    webgl: canvas.getContext('webgl') !== null
  }));
  assert.equal(dimensions.webgl, true, 'The DPR test requires an available WebGL driver.');
  assert.ok(Math.abs(dimensions.width - dimensions.cssWidth * 2) < 2);
  assert.deepEqual((await dpiPage.evaluate(auditStage)).problems, []);
  await high.close();
  const fallback = await context.newPage();
  await fallback.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      return kind === 'webgl' ? null : original.call(this, kind, ...args);
    };
  });
  await fallback.goto(file);
  await fallback.waitForFunction(() => !!window.VFDSimulator);
  assert.equal(await fallback.locator('#motor-canvas').evaluate(canvas => getComputedStyle(canvas).visibility), 'hidden');
  assert.ok(await fallback.getByText('Vista 3D no disponible. Este navegador no ofrece WebGL.', {
    exact: true
  }).isVisible());
  await fallback.locator('#LI1').click();
  await fallback.waitForFunction(() => VFDSimulator.getState().rpm > 600);
  await fallback.close();
});
test("no JavaScript errors or external resources", async ({
  app
}) => {
  const {
    errors,
    requests
  } = app;
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
});
