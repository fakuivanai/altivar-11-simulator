import assert from 'node:assert/strict';
import { test } from '../helpers/app.mjs';
const inputNumber = value => String(Number(value.toPrecision(3)));

test.use({ controlledClock: true });

async function advance(page, seconds) {
  await page.evaluate(value => VFDSimulator.advance(value), seconds);
  await page.clock.runFor(200);
}
async function changeNumber(field, value) {
  await field.fill(String(value));
  await field.press('Tab');
}

test('Legacy motor files disclose their estimate and manual circuits round trip explicitly', async ({ app }) => {
  const { page, original, config, install, shot } = app;
  await page.clock.pauseAt(Date.now() + 10000);
  const legacy = structuredClone(original);
  delete legacy.motorElectrical;
  await install(legacy);
  await advance(page, .3);
  await page.locator('#tab-motor').click();
  await page.locator('#motor-circuit summary').click();
  assert.deepEqual((await config()).motorElectrical, { mode: 'estimated' });
  assert.match(await page.locator('#status').textContent(), /Archivo anterior/);
  assert.match(await page.locator('#motor-circuit-mode').textContent(), /estimado desde la placa/);
  assert.match(await page.locator('#motor-fit-note').textContent(), /residuos de la estimación, no datos de placa/);
  const comparison = await page.locator('#motor-fit tbody tr').allTextContents();
  assert.equal(comparison.length, 3);
  assert.match(comparison[0], /2,1/);
  assert.match(comparison[2], /12,6/);
  assert.ok(await page.locator('#motor-fit-warning').isVisible());
  const estimatedExport = await page.evaluate(() => JSON.parse(VFDSimulator.exportText()));
  assert.deepEqual(estimatedExport.motorElectrical, { mode: 'estimated' });
  await shot('motor-estimate-diagnostics');

  const resistance = page.locator('#motor-Rs');
  const estimatedResistance = Number(await resistance.inputValue());
  await changeNumber(resistance, estimatedResistance * 1.2);
  const manual = await config();
  assert.equal(manual.motorElectrical.mode, 'manual');
  assert.equal(manual.motorElectrical.parameters.Rs, estimatedResistance * 1.2);
  assert.match(await page.locator('#motor-circuit-mode').textContent(), /valores manuales/);
  assert.equal(await page.locator('#motor-fit').count(), 0);
  const exported = await page.evaluate(() => VFDSimulator.exportText());
  assert.deepEqual(JSON.parse(exported).motorElectrical, manual.motorElectrical);
  await install(JSON.parse(exported));
  await advance(page, .3);
  assert.deepEqual((await config()).motorElectrical, manual.motorElectrical);
  await page.locator('#motor-estimate').click();
  assert.deepEqual((await config()).motorElectrical, { mode: 'estimated' });
  assert.equal(Number(await resistance.inputValue()), estimatedResistance);
  assert.ok(await page.locator('#motor-fit').isVisible());
});

test('Invalid manual circuit fields roll back and incompatible imports change no existing setting', async ({ app }) => {
  const { page, config } = app;
  await page.clock.pauseAt(Date.now() + 10000);
  await page.locator('#tab-motor').click();
  await page.locator('#motor-circuit summary').click();
  const before = await config();
  const resistance = page.locator('#motor-Rs');
  const originalResistance = Number(await resistance.inputValue());
  await changeNumber(resistance, 0);
  assert.deepEqual(await config(), before);
  assert.ok(Math.abs(Number(await resistance.inputValue()) - originalResistance) < 1e-6);
  assert.match(await page.locator('#status').textContent(), /Circuito Rs/);

  await changeNumber(resistance, originalResistance * 1.1);
  const manual = await config();
  const invalid = structuredClone(manual);
  invalid.parameters.ACC = 17;
  invalid.motorElectrical.parameters.Lm = -1;
  const result = await page.evaluate(text => VFDSimulator.importText(text), JSON.stringify(invalid));
  assert.equal(result.ok, false);
  assert.deepEqual(await config(), manual);
  assert.equal(await resistance.inputValue(), inputNumber(manual.motorElectrical.parameters.Rs));
});

test('Motor fields stay locked during AC operation, freewheel motion and stationary DC injection', async ({ app }) => {
  const { page, original, config, drive, install } = app;
  await page.clock.pauseAt(Date.now() + 10000);
  const freewheel = structuredClone(original);
  freewheel.parameters['FUn.nSt'] = 'LI4';
  freewheel.parameters['FUn.PS2.LIb'] = 'nO';
  freewheel.inputs.LI4 = true;
  await install(freewheel);
  await advance(page, .3);
  await page.locator('#tab-motor').click();
  await page.locator('#motor-circuit summary').click();
  const current = page.getByLabel('Corriente A', { exact: true });
  const resistance = page.locator('#motor-Rs');
  const controls = [current, resistance, page.locator('#motor-poles'), page.locator('#motor-estimate')];
  for (const control of controls) assert.equal(await control.isEnabled(), true);
  const assertLocked = async () => {
    for (const control of controls) assert.equal(await control.isDisabled(), true);
    const previous = await config();
    // The model guard also rejects programmatic events sent to a disabled field.
    await resistance.evaluate(field => {
      field.value = '5';
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });
    assert.deepEqual(await config(), previous);
  };
  await page.locator('#LI1').click();
  await advance(page, 1);
  assert.equal((await drive()).outputMode, 'ac');
  assert.ok(Math.abs((await drive()).rpm) > 10);
  await assertLocked();

  await page.locator('#LI4').click();
  await advance(page, .001);
  assert.equal((await drive()).outputMode, 'off');
  assert.ok(Math.abs((await drive()).rpm) > 10);
  await assertLocked();

  const dc = structuredClone(original);
  dc.parameters['FUn.AdC.ACt'] = 'Ct';
  await install(dc);
  await advance(page, .3);
  assert.equal((await drive()).outputMode, 'dc');
  assert.ok(Math.abs((await drive()).rpm) < .1);
  await assertLocked();

  await install(original);
  await advance(page, .3);
  for (const control of controls) assert.equal(await control.isEnabled(), true);
  await changeNumber(current, original.motor.current + .1);
  assert.equal((await config()).motor.current, original.motor.current + .1);
});

test('Circuit controls show concise natural units, preserve precision and stay inside the motor scroll panel', async ({ app }) => {
  const { page, original, config, install, shot } = app;
  await page.clock.pauseAt(Date.now() + 10000);
  const precise = structuredClone(original);
  precise.motorElectrical = { mode: 'manual', parameters: {
    Rs: 21.0445371, Rr: 6.123456, Lls: .02512345, Llr: .0206789, Lm: .2054321,
  } };
  await install(precise);
  await page.locator('#tab-motor').click();
  assert.equal(await page.locator('#motor-circuit').evaluate(details => details.open), false);
  const before = await config();
  await page.locator('#motor-circuit summary').click();
  await page.locator('#motor-Lls').scrollIntoViewIfNeeded();
  assert.match(await page.locator('label').filter({ has: page.locator('#motor-Lls') }).textContent(), /mH/);
  const reading = await page.locator('#motor-Lls').inputValue();
  assert.equal(reading, '25.1', 'Display rounds henries to three significant figures in mH');
  assert.deepEqual(await config(), before, 'Viewing rounded fields must preserve full stored precision');
  await changeNumber(page.locator('#motor-Lls'), 25);
  const manual = await config();
  assert.equal(manual.motorElectrical.parameters.Lls, .025, 'mH input converts to stored H');
  assert.equal(manual.motorElectrical.parameters.Rs, 21.0445371, 'Editing one rounded field preserves every other full-precision value');
  const geometry = await page.locator('#panel-motor').evaluate(panel => {
    const load = document.querySelector('#load').closest('.mechanics').parentElement.getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    return { scrolls: panel.scrollHeight > panel.clientHeight, panelBottom: bounds.bottom, loadTop: load.top,
      overflow: getComputedStyle(panel).overflowY };
  });
  assert.equal(geometry.scrolls, true);
  assert.equal(geometry.overflow, 'auto');
  assert(geometry.panelBottom <= geometry.loadTop + 1, 'Circuit fields must scroll above the load controls');
  await page.locator('#motor-estimate').scrollIntoViewIfNeeded();
  await shot('motor-circuit-readable-fields');
});
