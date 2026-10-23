import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, dist } from '../helpers/app.mjs';
for (const name of ['Simulador de variador.html', 'Simulador de variador, guía de estudio.html']) test(name + ' reverse motoring and open-U DC output', async ({
  app
}) => {
  const {
    page,
    ready,
    file,
    guide,
    output
  } = app;
  await ready(name.includes('guía') ? guide : file);
  const html = await readFile(join(dist, name), 'utf8');
  assert.doesNotMatch(html, /\/home\/|\/Users\/|[A-Z]:\\Users\\|scratch-workspaces/);
  await page.waitForFunction(() => !!window.VFDSimulator);
  await page.locator('#LI2').click();
  await page.waitForFunction(() => VFDSimulator.getState().rpm < -500);
  const reverse = await page.evaluate(() => VFDSimulator.getState());
  assert.ok(reverse.currentLag < Math.PI / 2 && reverse.regenerativePower === 0);
  assert.doesNotMatch(await page.locator('#scope-summary').innerText(), /devuelve energía/);
  const configuration = await page.evaluate(() => VFDSimulator.getConfig());
  configuration.inputs.LI1 = false;
  configuration.inputs.LI2 = false;
  configuration.inputs.outputConnections.U = false;
  configuration.parameters['FUn.AdC.ACt'] = 'Ct';
  const result = await page.evaluate(text => VFDSimulator.importText(text), JSON.stringify(configuration));
  assert.equal(result.ok, true);
  await page.waitForFunction(() => VFDSimulator.getState().outputMode === 'dc' && VFDSimulator.getState().phaseCurrentV > 1.4);
  const dc = await page.evaluate(() => VFDSimulator.getState());
  assert.equal(dc.phaseCurrentU, 0);
  assert.equal(dc.phaseCurrentV, dc.phaseCurrentW);
  assert.equal(dc.regenerativePower, 0);
  assert.ok(dc.voltage > 0);
  assert.match(await page.locator('#scope-summary').innerText(), /entre V y W/);
  assert.equal(await page.locator('#scope-summary').evaluate(element => {
    const panel = element.closest('.tab-panel');
    return element.getBoundingClientRect().bottom <= panel.getBoundingClientRect().bottom;
  }), true);
  await page.screenshot({
    path: join(output, name.startsWith('Simulador de variador,') ? 'study-dc.png' : 'main-dc.png')
  });
});
