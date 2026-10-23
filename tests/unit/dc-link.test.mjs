import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DCLink, DC_LINK_DEFAULTS } from '../../dc-link.ts';

const supply = { powered: true, supplyV: 230, electricalPower: 0, brakeModule: false };
const isolated = { ...supply, powered: false, supplyV: 0 };
const close = (actual, expected, tolerance = 1e-8) =>
  assert(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);

function advance(link, seconds, input = supply, step = 0.005) {
  const count = Math.round(seconds / step);
  for (let n = 0; n < count; n++) link.step(step, input);
  return link;
}

function accountedEnergy(before, result) {
  return before + result.rectifierEnergy + result.regeneratedEnergy -
    result.loadEnergy - result.brakeEnergy - result.bleedEnergy;
}

test('A single-phase source charges through finite precharge instead of assigning its peak voltage', () => {
  const link = new DCLink();
  assert.equal(link.energy, 0);
  assert.equal(link.precharging, true);
  const first = link.step(0.005, supply);
  assert(first.voltage > 0 && first.voltage < 100);
  assert(first.sourceLossEnergy > first.energy);
  assert.equal(first.precharging, true);
  advance(link, 0.5);
  assert.equal(link.precharging, false);
  assert(link.voltage > 320 && link.voltage < 230 * Math.SQRT2);
});

test('Precharge limits inrush relative to the same finite source without its series resistor', () => {
  const limited = new DCLink();
  const direct = new DCLink(0, { prechargeResistance: 0, prechargeSeconds: 0, prechargeFraction: 0 });
  const slow = limited.step(0.01, supply);
  const fast = direct.step(0.01, supply);
  assert(slow.voltage < fast.voltage / 2);
  assert(fast.voltage < supply.supplyV * Math.SQRT2);
  close(slow.energy, accountedEnergy(0, slow));
  close(fast.energy, accountedEnergy(0, fast));
});

test('Loaded 50 Hz full-wave rectification produces repeating 100 Hz ripple', () => {
  const link = advance(new DCLink(), 1);
  const input = { ...supply, electricalPower: 350 };
  advance(link, 1, input);
  const voltages = [];
  for (let n = 0; n < 2000; n++) voltages.push(link.step(0.0001, input).voltage);
  assert(Math.max(...voltages) - Math.min(...voltages) > 8);
  const amplitude = frequency => {
    let real = 0, imaginary = 0;
    voltages.forEach((v, n) => {
      const angle = 2 * Math.PI * frequency * n * 0.0001;
      real += v * Math.cos(angle);
      imaginary += v * Math.sin(angle);
    });
    return Math.hypot(real, imaginary) / voltages.length;
  };
  assert(amplitude(100) > 2);
  assert(amplitude(100) > 100 * amplitude(50));
  const periodError = voltages.slice(100).map((v, n) => Math.abs(v - voltages[n]));
  assert(Math.max(...periodError) < 0.001);
});

test('More capacitance reduces loaded line ripple rather than synthesizing a fixed bus voltage', () => {
  const ripple = capacitance => {
    const link = advance(new DCLink(0, { capacitance }), 1);
    const input = { ...supply, electricalPower: 300 };
    advance(link, 1, input);
    const samples = Array.from({ length: 200 }, () => link.step(0.0001, input).voltage);
    return Math.max(...samples) - Math.min(...samples);
  };
  assert(ripple(0.0012) < 0.65 * ripple(0.0006));
});

test('Every operating step balances rectifier input, regeneration, demand and resistor heat', () => {
  const link = new DCLink();
  const cases = [
    { ...supply },
    { ...supply, electricalPower: 500 },
    { ...supply, electricalPower: -900 },
    { ...supply, electricalPower: -900, brakeModule: true },
    { ...isolated, electricalPower: 500, brakeModule: true },
    { ...isolated },
  ];
  for (const input of cases) {
    for (let n = 0; n < 100; n++) {
      const before = link.energy;
      const result = link.step(0.005, input);
      close(result.energy, accountedEnergy(before, result));
      close(result.energy, 0.5 * DC_LINK_DEFAULTS.capacitance * result.voltage ** 2);
      close(result.loadEnergy + result.unservedEnergy, Math.max(0, input.electricalPower) * 0.005);
      for (const value of Object.values(result))
        if (typeof value === 'number') assert(Number.isFinite(value) && value >= 0);
    }
  }
});

test('Isolated regeneration follows capacitor energy and can exceed the external overvoltage threshold', () => {
  const link = new DCLink(320, { bleedResistance: null });
  const before = link.energy;
  const result = link.step(0.2, { ...isolated, electricalPower: -500 });
  close(result.energy, before + 100);
  close(result.voltage, Math.sqrt(320 ** 2 + 2 * 100 / DC_LINK_DEFAULTS.capacitance));
  assert(result.voltage > 415);
  assert.equal(result.rectifierEnergy, 0);
  assert.equal(result.brakeEnergy, 0);
});

test('A diode bridge cannot export regenerative energy to the supply', () => {
  const link = new DCLink(500, { bleedResistance: null });
  const before = link.energy;
  const result = link.step(0.1, { ...supply, electricalPower: -200 });
  assert.equal(result.rectifierEnergy, 0);
  assert.equal(result.sourceLossEnergy, 0);
  close(result.energy, before + 20);
});

test('Electrical demand drains stored energy below 230 V and reports demand an empty bus cannot supply', () => {
  const link = new DCLink(300, { bleedResistance: null });
  const before = link.energy;
  const result = link.step(0.2, { ...isolated, electricalPower: 1000 });
  assert.equal(result.voltage, 0);
  close(result.loadEnergy, before);
  close(result.unservedEnergy, 200 - before);
  assert.equal(result.regeneratedEnergy, 0);
});

test('Supply loss opens precharge bypass but preserves capacitor energy', () => {
  const link = advance(new DCLink(0, { bleedResistance: null }), 0.5);
  const before = link.energy;
  const off = link.step(0.005, isolated);
  assert.equal(off.precharging, true);
  assert.equal(off.energy, before);
  link.step(0.005, supply);
  assert.equal(link.precharging, true);
  advance(link, 0.2);
  assert.equal(link.precharging, false);
});

test('The passive bleeder dissipates capacitor energy with its RC time constant', () => {
  const link = new DCLink(300);
  const before = link.energy;
  const result = link.step(0.4, isolated);
  const expectedVoltage = 300 * Math.exp(-0.4 / (DC_LINK_DEFAULTS.capacitance * DC_LINK_DEFAULTS.bleedResistance));
  close(result.voltage, expectedVoltage);
  close(result.bleedEnergy, before - result.energy);
});

test('An optional finite braking resistor dissipates regenerative power around its switching band', () => {
  const input = { ...isolated, electricalPower: -1000, brakeModule: true };
  const link = advance(new DCLink(320), 1, input);
  const samples = [];
  let heat = 0;
  for (let n = 0; n < 2000; n++) {
    const result = link.step(0.0001, input);
    samples.push(result.voltage);
    heat += result.brakeEnergy;
  }
  assert(Math.min(...samples) >= 349.9);
  assert(Math.max(...samples) <= 360.5);
  assert(heat > 190 && heat < 210);
});

test('An overloaded braking resistor permits overvoltage instead of imposing an artificial clamp', () => {
  const link = new DCLink(350);
  const result = link.step(0.1, { ...isolated, electricalPower: -4000, brakeModule: true });
  assert(result.voltage > 415);
  assert(result.brakeEnergy > 0);
  close(result.energy, accountedEnergy(0.5 * DC_LINK_DEFAULTS.capacitance * 350 ** 2, result));
});

test('A disconnected brake module does not consume capacitor energy', () => {
  const link = new DCLink(400, { bleedResistance: null });
  const result = link.step(0.2, isolated);
  assert.equal(result.voltage, 400);
  assert.equal(result.brakeEnergy, 0);
  const withBrake = link.step(0.2, { ...isolated, brakeModule: true });
  close(withBrake.voltage, DC_LINK_DEFAULTS.brakeOffVoltage);
  assert(withBrake.brakeEnergy > 0);
});

test('Fixed input and elapsed time give deterministic results across the engine integration step', () => {
  const a = new DCLink();
  const b = new DCLink();
  const input = { ...supply, electricalPower: 200 };
  advance(a, 0.5, input, 0.005);
  advance(b, 0.5, input, 0.0001);
  close(a.voltage, b.voltage, 1e-7);
  close(a.energy, b.energy, 1e-7);
  assert.equal(a.precharging, b.precharging);
});

test('Extreme allowed teaching values stay finite without creating energy on an absent line', () => {
  for (const voltage of [0, 10, 600]) {
    const link = new DCLink(0, { capacitance: 0.00005, sourceResistance: 0.1 });
    const result = link.step(0.2, { ...supply, supplyV: voltage, electricalPower: 3000 });
    assert(Number.isFinite(result.voltage));
    assert(result.voltage >= 0 && result.voltage <= voltage * Math.SQRT2);
    close(result.energy, accountedEnergy(0, result));
    if (voltage === 0) assert.equal(result.loadEnergy, 0);
  }
});

test('Reset and invalid calls keep a defined physical state', () => {
  const link = new DCLink(200);
  const before = link.step(0, supply);
  assert.equal(before.voltage, 200);
  assert.equal(before.rectifierEnergy, 0);
  for (const dt of [-1, NaN, Infinity, 601]) assert.throws(() => link.step(dt, supply), RangeError);
  assert.throws(() => link.step(0.005, { ...supply, electricalPower: NaN }), RangeError);
  assert.throws(() => link.step(0.005, { ...supply, supplyV: -1 }), RangeError);
  assert.throws(() => new DCLink(0, { capacitance: 0 }), RangeError);
  assert.throws(() => new DCLink(0, { sourceResistance: 0 }), RangeError);
  assert.throws(() => new DCLink(0, { brakeOnVoltage: 300 }), RangeError);
  assert.throws(() => link.reset(-1), RangeError);
  link.reset(100);
  assert.equal(link.voltage, 100);
  assert.equal(link.precharging, true);
});
