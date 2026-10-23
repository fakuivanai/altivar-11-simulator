import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scopeTrends, SCOPE_TREND_WINDOW } from '../../scope-trends.ts';

function sample(time, values = {}) {
  return { time, voltage: { U: 0, V: 0, W: 0 }, current: { U: 0, V: 0, W: 0 },
    torque: 0, rpm: 0, flux: .4, dcBus: 325, running: true, fault: null, loadTorque: 1, ...values };
}
function acSamples(frequency, seconds = 1) {
  return Array.from({ length: Math.round(seconds / .0005) + 1 }, (_, index) => {
    const time = index * .0005, angle = 2 * Math.PI * frequency * time;
    const phases = { U: 0, V: -2 * Math.PI / 3, W: 2 * Math.PI / 3 };
    return sample(time, {
      voltage: Object.fromEntries(Object.entries(phases).map(([phase, offset]) =>
        [phase, 230 * Math.sqrt(2 / 3) * Math.sin(angle + offset)])),
      current: Object.fromEntries(Object.entries(phases).map(([phase, offset]) =>
        [phase, 3 * Math.SQRT2 * Math.sin(angle + offset)])),
    });
  });
}
const close = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} versus ${expected}`);

test('A complete 50 Hz window gives known line-voltage and conductor RMS values', () => {
  const trends = scopeTrends(acSamples(50)).filter(value => value.time >= SCOPE_TREND_WINDOW);
  for (const value of trends) {
    close(value.voltageRms, 230);
    for (const phase of ['U', 'V', 'W']) close(value.currentRms[phase], 3);
  }
});

test('A 27 Hz trace shows a slow positive RMS trend rather than a seconds-wide raw AC band', () => {
  const trends = scopeTrends(acSamples(27)).filter(value => value.time >= .1);
  for (const value of trends) {
    assert.ok(value.voltageRms > 223 && value.voltageRms < 237);
    for (const phase of ['U', 'V', 'W']) assert.ok(value.currentRms[phase] > 2.9 && value.currentRms[phase] < 3.1);
  }
  assert.ok(acSamples(27).some(value => value.current.U < -4), 'The input really includes signed AC peaks');
});

test('DC and disconnected conductors retain physical RMS magnitudes without fabricated current', () => {
  const source = Array.from({ length: 401 }, (_, index) => sample(index * .0005, {
    voltage: { U: 10, V: -5, W: -5 }, current: { U: 0, V: -2, W: 2 },
  }));
  const result = scopeTrends(source).at(-1);
  close(result.voltageRms, 15);
  assert.equal(result.currentRms.U, 0);
  close(result.currentRms.V, 2);
  close(result.currentRms.W, 2);
});

test('Unevenly spaced samples use elapsed-time weighting and clip the leading window segment', () => {
  const source = [0, .03, .11, .2].map(time => sample(time, {
    torque: 100 * time, dcBus: 200 + 100 * time, flux: .1 + time, rpm: 1000 * time,
  }));
  const result = scopeTrends(source).at(-1);
  close(result.torqueMean, 15);
  close(result.dcBusMean, 215);
  close(result.fluxMean, .25);
  close(result.rpm, 200);
});

test('Causal averaging preserves a visible load transient without changing recorded samples', () => {
  const source = Array.from({ length: 1401 }, (_, index) => {
    const time = index * .0005;
    return sample(time, { torque: time >= .5 ? 10 : 0 });
  });
  const before = structuredClone(source);
  const trends = scopeTrends(source);
  const at = time => trends.find(value => Math.abs(value.time - time) < 1e-10);
  assert.equal(at(.495).torqueMean, 0);
  close(at(.55).torqueMean, 5, .03);
  close(at(.6).torqueMean, 10);
  assert.deepEqual(source, before);
  trends.at(-1).currentRms.U = 99;
  assert.equal(source.at(-1).current.U, 0);
});

test('The display point budget keeps endpoints and the raw recorder resolution separate', () => {
  const source = acSamples(50, 10);
  const trends = scopeTrends(source);
  assert.equal(source.length, 20001);
  assert.ok(trends.length <= 2002);
  assert.equal(trends[0].time, 0);
  assert.equal(trends.at(-1).time, 10);
  for (let index = 1; index < trends.length; index++) assert.ok(trends[index].time > trends[index - 1].time);
});

test('Empty histories and invalid trend windows fail at the appropriate boundary', () => {
  assert.deepEqual(scopeTrends([]), []);
  assert.throws(() => scopeTrends([], 0));
  assert.throws(() => scopeTrends([sample(NaN)]));
  assert.throws(() => scopeTrends([sample(1), sample(.5)]));
});
