import assert from 'node:assert/strict';
import { test } from '../helpers/app.mjs';

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
  assert.deepEqual((await config()).motorElectrical, { mode: 'estimated' });
  assert.match(await page.locator('#status').textContent(), /Archivo anterior/);
  assert.match(await page.locator('#motor-circuit-mode').textContent(), /estimado desde la placa/);
  assert.match(await page.locator('#motor-fit-note').textContent(), /residuos de la estimación, no datos de placa/);
  const comparison = await page.locator('#motor-fit tbody tr').allTextContents();
  assert.equal(comparison.length, 3);
  assert.match(comparison[0], /2\.10/);
  assert.match(comparison[2], /12\.60/);
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
  assert.ok(Math.abs(Number(await resistance.inputValue()) - manual.motorElectrical.parameters.Rs) < 1e-6);
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
