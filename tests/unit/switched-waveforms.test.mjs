import assert from 'node:assert/strict';
import { test } from 'node:test';
import { phaseCurrents, switchedCurrents } from '../../waveforms.ts';
import { injectionTopology } from '../../electrical.ts';

const connected = { U: true, V: true, W: true };
function input(change = {}, circuit = {}) {
  const output = {
    mode: 'ac', frequency: 50, voltage: 230, dcBus: 325, switchingKHz: 4,
    aggregateCurrent: 1.5, current: { U: 1.5, V: 1.5, W: 1.5 }, currentLag: .8,
    connected, ...change,
  };
  if (output.mode === 'dc') output.topology = injectionTopology(output.connected);
  return { output, circuit: { statorResistance: 5, leakageInductance: .02, ...circuit } };
}
function rippleMean(signal, trace, phase, from, to) {
  let area = 0;
  for (let index = 1; index < trace.times.length; index++) {
    const a = trace.times[index - 1], b = trace.times[index];
    if (a < from - 1e-12 || b > to + 1e-12) continue;
    const x = trace.values[phase][index - 1] - phaseCurrents(signal.output, a)[phase];
    const y = trace.values[phase][index] - phaseCurrents(signal.output, b)[phase];
    area += (x + y) * (b - a) / 2;
  }
  return area / (to - from);
}
function peakRipple(signal) {
  const trace = switchedCurrents(signal, 0, .002);
  return Math.max(...trace.times.map((time, index) => Math.abs(trace.values.U[index] - phaseCurrents(signal.output, time).U)));
}

test('Continuous switched current keeps the carrier mean close to its averaged baseline', () => {
  const signal = input();
  assert.ok(peakRipple(signal) > .01);
  for (const switchingKHz of [2, 4, 8, 12, 16]) {
    const detail = switchedCurrents(input({ switchingKHz }), 0, .002);
    assert.ok(detail.times.length <= 1000);
    for (let index = 1; index < detail.times.length; index++) assert.ok(detail.times[index] > detail.times[index - 1]);
  }
  for (const operatingPoint of [signal, input({ frequency: 200, switchingKHz: 2 })]) {
    const detail = switchedCurrents(operatingPoint, 0, .002);
    const switchingHz = operatingPoint.output.switchingKHz * 1000;
    for (let carrier = 0; carrier < .002 * switchingHz; carrier++) {
      for (const phase of ['U', 'V', 'W']) {
        const mean = rippleMean(operatingPoint, detail, phase, carrier / switchingHz, (carrier + 1) / switchingHz);
        // Changing duty carries the R-L state forward, so a carrier's mean may
        // depart slightly from the baseline instead of resetting its current.
        assert.ok(Math.abs(mean) < .01 * operatingPoint.output.current[phase]);
      }
    }
  }
});

test('AC current is continuous when the duty changes at a carrier boundary', () => {
  for (const frequency of [200, -200]) {
    const signal = input({ frequency, switchingKHz: 2 });
    for (const boundary of [.0005, .001, .0015]) {
      const detail = switchedCurrents(signal, boundary - 1e-12, 2e-12);
      for (const phase of ['U', 'V', 'W'])
        assert.ok(Math.abs(detail.values[phase].at(-1) - detail.values[phase][0]) < 1e-6);
    }
  }
});

test('Leakage and switching frequency change the independent DC ripple as expected', () => {
  const dc = input({ mode: 'dc', voltage: 18, current: { U: 1.47, V: .735, W: .735 } });
  const trace = switchedCurrents(dc, 0, .002);
  for (let carrier = 0; carrier < 8; carrier++) {
    for (const phase of ['U', 'V', 'W'])
      assert.ok(Math.abs(rippleMean(dc, trace, phase, carrier / 4000, (carrier + 1) / 4000)) < 1e-5);
  }
  const original = peakRipple(dc);
  assert.ok(original > .01);
  assert.ok(peakRipple({ ...dc, circuit: { ...dc.circuit, leakageInductance: .04 } }) < original * .56);
  assert.ok(peakRipple({ ...dc, output: { ...dc.output, switchingKHz: 8 } }) < original * .56);
  const resistive = switchedCurrents({ ...dc, circuit: { ...dc.circuit, statorResistance: 500 } }, 0, .002);
  const reference = switchedCurrents(dc, 0, .002);
  const energy = trace => trace.times.slice(1).reduce((sum, time, index) => {
    const a = trace.values.U[index] - 1.47, b = trace.values.U[index + 1] - 1.47;
    return sum + (a * a + b * b) * (time - trace.times[index]) / 2;
  }, 0);
  assert.ok(energy(resistive) < energy(reference));
});

test('The ripple conserves the floating-star conductor sum in forward and reverse operation', () => {
  for (const frequency of [50, -50]) {
    const signal = input({ frequency });
    const trace = switchedCurrents(signal, -.0007, .002);
    for (let index = 0; index < trace.times.length; index++)
      assert.ok(Math.abs(trace.values.U[index] + trace.values.V[index] + trace.values.W[index]) < 1e-9);
  }
});

test('Every disconnected conductor stays at zero, including paired DC injection', () => {
  for (const open of ['U', 'V', 'W']) for (const mode of ['ac', 'dc']) {
    const connection = { ...connected, [open]: false };
    const current = { U: 1.5, V: 1.5, W: 1.5, [open]: 0 };
    const signal = input({ mode, connected: connection, current, voltage: mode === 'dc' ? 18 : 230 });
    const trace = switchedCurrents(signal, 0, .002);
    for (let index = 0; index < trace.times.length; index++) {
      assert.equal(trace.values[open][index], 0);
      assert.ok(Math.abs(trace.values.U[index] + trace.values.V[index] + trace.values.W[index]) < 1e-9);
    }
  }
});

test('Ideal resistance remains finite and has exactly zero mean triangular ripple', () => {
  const signal = input({ mode: 'dc', voltage: 18, current: { U: 1.47, V: .735, W: .735 } }, { statorResistance: 0 });
  const trace = switchedCurrents(signal, 0, .00025);
  assert.ok(trace.values.U.every(Number.isFinite));
  assert.ok(Math.abs(rippleMean(signal, trace, 'U', 0, .00025)) < 1e-10);
  const tinyResistance = switchedCurrents({ ...signal, circuit: { ...signal.circuit, statorResistance: 1e-9 } }, 0, .00025);
  assert.ok(Math.abs(rippleMean(signal, tinyResistance, 'U', 0, .00025)) < 1e-10);
  for (let index = 0; index < trace.times.length; index++) assert.ok(Math.abs(trace.values.U[index] - tinyResistance.values.U[index]) < 1e-9);
});

test('Detail integration does not mutate the snapshot or its effective circuit', () => {
  const signal = input();
  const original = structuredClone(signal);
  for (const object of [signal.output.current, signal.output.connected, signal.output, signal.circuit, signal]) Object.freeze(object);
  switchedCurrents(signal, .003, .002);
  assert.deepEqual(signal, original);
  const off = switchedCurrents(input({ mode: 'off' }), 0, .002);
  assert.deepEqual(off.values, { U: [0, 0], V: [0, 0], W: [0, 0] });
  assert.throws(() => switchedCurrents(input({}, { leakageInductance: 0 }), 0, .002));
});
