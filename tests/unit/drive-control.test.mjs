import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CurrentLimiter, DCInjectionController } from '../../drive-control.ts';

const close = (actual, expected, tolerance = 1e-8) =>
  assert(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);

// Exact constant-voltage solution, independent of the PI implementation.
function rlStep(current, voltage, resistance, inductance, dt, inducedVoltage = 0) {
  const steady = (voltage - inducedVoltage) / resistance;
  return current + (steady - current) * -Math.expm1(-resistance * dt / inductance);
}

function runLimiter({ dt = 0.0001, seconds = 0.3, limit = 3.15,
  resistance = 10, inductance = 0.2, unlimitedMultiple = 6, current = 0,
  controller = new CurrentLimiter() } = {}) {
  const voltage = limit * resistance * unlimitedMultiple;
  const samples = [];
  for (let n = 0; n < Math.round(seconds / dt); n++) {
    const factor = controller.step(dt, Math.abs(current), limit);
    current = rlStep(current, voltage * factor, resistance, inductance, dt);
    samples.push({ current, factor, time: (n + 1) * dt });
  }
  return { controller, current, samples };
}

const dcCircuit = { measuredCurrent: 0, targetCurrent: 1.47, statorResistance: 4,
  returns: 2, loopInductance: 0.03, maxVoltage: 325 };

function runInjection({ input = dcCircuit, dt = 0.0001, seconds = 0.3,
  resistance = input.statorResistance * (1 + 1 / input.returns),
  inducedVoltage = 0, current = 0, controller = new DCInjectionController() } = {}) {
  const samples = [];
  for (let n = 0; n < Math.round(seconds / dt); n++) {
    const voltage = controller.step(dt, { ...input, measuredCurrent: current });
    current = rlStep(current, voltage, resistance, input.loopInductance, dt, inducedVoltage);
    samples.push({ current, voltage });
  }
  return { controller, current, samples };
}

test('The AC limiter passes unrestricted demand below CLI and retains its bounded voltage output', () => {
  const limiter = new CurrentLimiter();
  assert.equal(limiter.factor, 1);
  for (let n = 0; n < 1000; n++) assert.equal(limiter.step(0.0001, 1, 3.15), 1);
  const limited = limiter.step(0.0001, 4, 3.15);
  assert(limited > 0 && limited < 1);
  assert.equal(limiter.factor, limited);
});

test('A real RL current transient exceeds CLI briefly and returns without algebraic current clipping', () => {
  for (const limit of [1.05, 3.15]) {
    const { current, samples } = runLimiter({ limit });
    assert(Math.max(...samples.map(s => s.current)) > limit * 1.1);
    assert(samples.some(s => s.factor > 0 && s.factor < 1));
    const aboveOCF = samples.filter(s => s.current > limit * 1.15).length * 0.0001;
    assert(aboveOCF < 0.08);
    assert(samples.filter(s => s.time >= 0.08).every(s => s.current < limit * 1.15));
    close(current, limit, limit * 0.0001);
    close(samples.at(-1).factor, 1 / 6, 0.0001);
  }
});

test('AC limiting is stable for fast/slow RL loads and electrical sampling steps', () => {
  for (const dt of [0.00005, 0.0001, 0.0005, 0.001]) {
    for (const inductance of [0.05, 0.2]) {
      const result = runLimiter({ dt, inductance, unlimitedMultiple: 4 });
      close(result.current, 3.15, 0.00315);
      const tail = result.samples.slice(-Math.round(0.05 / dt));
      assert(tail.every(s => Math.abs(s.current - 3.15) < 0.01));
      assert(result.samples.every(s => Number.isFinite(s.current) && s.factor >= 0 && s.factor <= 1));
    }
  }
  const fast = runLimiter({ inductance: 0.0005, unlimitedMultiple: 6 });
  close(fast.current, 3.15, 0.00315);
});

test('The AC integral rejects prolonged saturation windup at both voltage bounds', () => {
  const limiter = new CurrentLimiter();
  for (let n = 0; n < 20000; n++) assert.equal(limiter.step(0.0001, 0, 3.15), 1);
  const fresh = new CurrentLimiter();
  close(limiter.step(0.0001, 4, 3.15), fresh.step(0.0001, 4, 3.15));
  for (let n = 0; n < 20000; n++) limiter.step(0.0001, 100, 3.15);
  assert.equal(limiter.factor, 0);
  assert(limiter.step(0.0001, 0, 3.15) > 0);
  for (let n = 0; n < 100; n++) limiter.step(0.0001, 0, 3.15);
  assert.equal(limiter.factor, 1);
});

test('AC feedback recovers full voltage after a load reduction without resetting the physical current', () => {
  const limited = runLimiter();
  let current = limited.current;
  for (let n = 0; n < 1000; n++) {
    const factor = limited.controller.step(0.0001, current, 3.15);
    current = rlStep(current, 10 * factor, 10, 0.2, 0.0001);
  }
  assert.equal(limited.controller.factor, 1);
  close(current, 1, 0.03);
});

test('Changing CLI keeps the active PI state, and a zero limit inhibits only voltage', () => {
  const limited = runLimiter();
  const before = limited.controller.factor;
  const after = limited.controller.step(0, limited.current, 6.3);
  assert(after > before && after < 1);
  assert.equal(limited.current > 3, true);
  assert.equal(limited.controller.step(0.0001, limited.current, 0), 0);
  limited.controller.reset();
  assert.equal(limited.controller.factor, 1);
});

test('AC voltage remains bounded for severe measured overloads and invalid feedback is rejected', () => {
  const limiter = new CurrentLimiter();
  for (const measured of [0, 0.00001, 1e3, 1e9]) {
    const factor = limiter.step(0.0001, measured, 1.05);
    assert(Number.isFinite(factor) && factor >= 0 && factor <= 1);
  }
  assert.throws(() => limiter.step(-0.01, 1, 3.15), RangeError);
  assert.throws(() => limiter.step(0.0001, -1, 3.15), RangeError);
  assert.throws(() => limiter.step(0.0001, 1, NaN), RangeError);
});

test('DC injection feedforward is the physical source and parallel-return winding resistance', () => {
  for (const returns of [1, 2]) {
    const controller = new DCInjectionController();
    const input = { ...dcCircuit, returns, measuredCurrent: dcCircuit.targetCurrent };
    const voltage = controller.step(0.0001, input);
    close(voltage, input.statorResistance * (1 + 1 / returns) * input.targetCurrent);
    assert.equal(controller.voltage, voltage);
  }
});

test('DC injection tracks SdC through a real RL transient using voltage rather than assigning current', () => {
  for (const returns of [1, 2]) {
    const result = runInjection({ input: { ...dcCircuit, returns } });
    assert(result.samples[0].current > 0 && result.samples[0].current < dcCircuit.targetCurrent);
    assert(Math.max(...result.samples.map(s => s.current)) < dcCircuit.targetCurrent * 1.16);
    close(result.current, dcCircuit.targetCurrent, 0.00001);
    const expected = dcCircuit.statorResistance * (1 + 1 / returns) * dcCircuit.targetCurrent;
    close(result.samples.at(-1).voltage, expected, 0.001);
  }
});

test('The DC integral removes induced-voltage and resistance-estimate errors', () => {
  for (const inducedVoltage of [-3, 5]) {
    const result = runInjection({ inducedVoltage });
    close(result.current, dcCircuit.targetCurrent, 0.0001);
    close(result.samples.at(-1).voltage, 6 * dcCircuit.targetCurrent + inducedVoltage, 0.001);
  }
  const mismatch = runInjection({ resistance: 8 });
  close(mismatch.current, dcCircuit.targetCurrent, 0.0001);
  close(mismatch.samples.at(-1).voltage, 8 * dcCircuit.targetCurrent, 0.001);
});

test('Signed DC feedback responds to reverse current with a positive recovery voltage', () => {
  const controller = new DCInjectionController();
  const normal = controller.step(0, dcCircuit);
  const reverse = controller.step(0, { ...dcCircuit, measuredCurrent: -2 });
  assert(reverse > normal);
  const result = runInjection({ current: -2 });
  close(result.current, dcCircuit.targetCurrent, 0.0001);
});

test('Unavailable DC voltage causes unmet current demand without winding the integral up', () => {
  const low = { ...dcCircuit, maxVoltage: 1 };
  const saturated = runInjection({ input: low, seconds: 2 });
  close(saturated.current, 1 / 6, 0.00001);
  assert(saturated.current < dcCircuit.targetCurrent);
  assert(saturated.samples.every(s => s.voltage <= 1));
  const recovered = saturated.controller.step(0.0001, { ...dcCircuit, measuredCurrent: saturated.current });
  const fresh = new DCInjectionController().step(0.0001, { ...dcCircuit, measuredCurrent: saturated.current });
  close(recovered, fresh);
});

test('Prolonged DC lower saturation cannot leave a negative hidden integral', () => {
  const controller = new DCInjectionController();
  for (let n = 0; n < 20000; n++)
    assert.equal(controller.step(0.0001, { ...dcCircuit, measuredCurrent: 100 }), 0);
  close(controller.step(0.0001, { ...dcCircuit, measuredCurrent: dcCircuit.targetCurrent }), 6 * dcCircuit.targetCurrent);
});

test('A DC setpoint change regulates the new physical current and zero SdC turns voltage off', () => {
  const first = runInjection();
  const second = runInjection({ input: { ...dcCircuit, targetCurrent: 0.5 },
    controller: first.controller, current: first.current });
  close(second.current, 0.5, 0.0001);
  assert.equal(second.controller.step(0.0001, { ...dcCircuit, targetCurrent: 0 }), 0);
  assert.equal(second.controller.voltage, 0);
  assert(first.current > 1);
  second.controller.reset();
  assert.equal(second.controller.voltage, 0);
});

test('DC regulation stays stable across RL component and sample-step extremes', () => {
  for (const dt of [0.00005, 0.0001, 0.001]) {
    for (const [statorResistance, loopInductance] of [[0.001, 0.000002], [4, 0.03], [1000, 0.000002]]) {
      const input = { ...dcCircuit, statorResistance, loopInductance,
        targetCurrent: 0.1, maxVoltage: 1000 };
      const result = runInjection({ input, dt, seconds: 0.5 });
      assert(result.samples.every(s => Number.isFinite(s.current) && s.voltage >= 0 && s.voltage <= input.maxVoltage));
      close(result.current, input.targetCurrent, 0.001);
      const tail = result.samples.slice(-Math.round(0.05 / dt));
      assert(tail.every(s => Math.abs(s.current - input.targetCurrent) < 0.001));
    }
  }
});

test('A physical induced voltage beyond actuator authority may retain excess current at zero command', () => {
  const result = runInjection({ inducedVoltage: -50 });
  assert.equal(result.samples.at(-1).voltage, 0);
  assert(result.current > dcCircuit.targetCurrent * 2);
});

test('DC bus collapse/reset gives bounded recovery and invalid topology/circuit input is rejected', () => {
  const controller = runInjection({ inducedVoltage: 5 }).controller;
  assert.equal(controller.step(0.0001, { ...dcCircuit, maxVoltage: 0 }), 0);
  const fresh = new DCInjectionController();
  close(controller.step(0.0001, dcCircuit), fresh.step(0.0001, dcCircuit));
  for (const patch of [{ returns: 0 }, { returns: 3 }, { loopInductance: 0 },
    { statorResistance: 0 }, { targetCurrent: -1 }, { measuredCurrent: NaN }, { maxVoltage: -1 }])
    assert.throws(() => controller.step(0.0001, { ...dcCircuit, ...patch }), RangeError);
  assert.throws(() => controller.step(-0.001, dcCircuit), RangeError);
});
