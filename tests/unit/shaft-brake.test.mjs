import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stepShaftBrake, SHAFT_BRAKE_TORQUE_MULTIPLE } from '../../shaft-brake.ts';

const defaults = { omega: 100, appliedTorque: 0, inertia: 0.1, ratedTorque: 2, engaged: true };
const close = (actual, expected, tolerance = 1e-10) =>
  assert(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);

function checkWork(input, dt, result) {
  const kineticChange = 0.5 * input.inertia * (result.omega ** 2 - input.omega ** 2);
  close(kineticChange, input.appliedTorque * result.angleDelta - result.dissipatedEnergy, 1e-8);
  close(input.inertia * (result.omega - input.omega) / dt, input.appliedTorque + result.reactionTorque);
  assert(result.dissipatedEnergy >= 0);
  assert(Math.abs(result.reactionTorque) <= SHAFT_BRAKE_TORQUE_MULTIPLE * input.ratedTorque + 1e-10);
}

test('Engaging a rotating shaft takes finite time and dissipates its kinetic energy mechanically', () => {
  let input = { ...defaults };
  const first = stepShaftBrake(input, 0.005);
  assert(first.omega > 99 && first.omega < 100);
  assert.equal(first.locked, false);
  checkWork(input, 0.005, first);
  let heat = first.dissipatedEnergy;
  let elapsed = 0.005;
  input.omega = first.omega;
  while (input.omega !== 0 && elapsed < 2) {
    const result = stepShaftBrake(input, 0.005);
    checkWork(input, 0.005, result);
    input.omega = result.omega;
    heat += result.dissipatedEnergy;
    elapsed += 0.005;
  }
  close(elapsed, 100 * 0.1 / 6, 0.005);
  assert.equal(input.omega, 0);
  close(heat, 0.5 * 0.1 * 100 ** 2, 1e-8);
});

test('Static holding begins at zero and balances only bounded applied torque', () => {
  for (const appliedTorque of [-6, -2, 0, 2, 6]) {
    const input = { ...defaults, omega: 0, appliedTorque };
    const result = stepShaftBrake(input, 0.005);
    assert.equal(result.omega, 0);
    close(result.reactionTorque, -appliedTorque);
    assert.equal(result.angleDelta, 0);
    assert.equal(result.dissipatedEnergy, 0);
    assert.equal(result.locked, true);
  }
});

test('A motor or load above the holding capacity moves the shaft instead of receiving infinite reaction', () => {
  for (const appliedTorque of [-8, 8]) {
    const input = { ...defaults, omega: 0, appliedTorque };
    const result = stepShaftBrake(input, 0.1);
    close(result.omega, Math.sign(appliedTorque) * 2);
    close(result.reactionTorque, -Math.sign(appliedTorque) * 6);
    assert.equal(result.locked, false);
    checkWork(input, 0.1, result);
  }
});

test('The zero crossing uses only its required stopping time and holds during the rest of a step', () => {
  const input = { ...defaults, omega: 0.1, appliedTorque: 2 };
  const result = stepShaftBrake(input, 0.1);
  assert.equal(result.omega, 0);
  assert.equal(result.locked, true);
  assert(result.reactionTorque > -6 && result.reactionTorque < -2);
  close(result.angleDelta, 0.000125);
  checkWork(input, 0.1, result);
});

test('A passive brake cannot reverse the shaft at its zero crossing', () => {
  for (const omega of [-0.1, 0.1]) {
    const input = { ...defaults, omega };
    const result = stepShaftBrake(input, 1);
    assert.equal(result.omega, 0);
    assert.equal(result.locked, true);
    checkWork(input, 1, result);
  }
});

test('An opposing torque above capacity can drive a real reversal after the rotor stops', () => {
  const input = { ...defaults, omega: 1, appliedTorque: -8 };
  const result = stepShaftBrake(input, 0.1);
  assert(result.omega < 0);
  assert.equal(result.locked, false);
  checkWork(input, 0.1, result);
  const mirrored = stepShaftBrake({ ...input, omega: -1, appliedTorque: 8 }, 0.1);
  close(mirrored.omega, -result.omega);
  close(mirrored.reactionTorque, -result.reactionTorque);
  close(mirrored.angleDelta, -result.angleDelta);
  close(mirrored.dissipatedEnergy, result.dissipatedEnergy);
});

test('Releasing a stationary brake permits subsequent motor acceleration', () => {
  const held = stepShaftBrake({ ...defaults, omega: 0, appliedTorque: 2 }, 1);
  const input = { ...defaults, omega: held.omega, appliedTorque: 2, engaged: false };
  const released = stepShaftBrake(input, 0.1);
  close(released.omega, 2);
  assert.equal(released.reactionTorque, 0);
  assert.equal(released.dissipatedEnergy, 0);
  assert.equal(released.locked, false);
  checkWork(input, 0.1, released);
});

test('More inertia or less brake torque increases physical stopping time', () => {
  const stopTime = input => {
    let elapsed = 0;
    while (input.omega !== 0 && elapsed < 10) {
      input = { ...input, omega: stepShaftBrake(input, 0.005).omega };
      elapsed += 0.005;
    }
    return elapsed;
  };
  const standard = stopTime({ ...defaults });
  close(stopTime({ ...defaults, inertia: 0.2 }), 2 * standard, 0.01);
  close(stopTime({ ...defaults, ratedTorque: 1 }), 2 * standard, 0.01);
});

test('Partitioning time preserves speed, angle and brake heat through a stop', () => {
  const input = { ...defaults, omega: 1, appliedTorque: 2 };
  const whole = stepShaftBrake(input, 0.1);
  let omega = input.omega, angle = 0, heat = 0;
  for (let n = 0; n < 100; n++) {
    const result = stepShaftBrake({ ...input, omega }, 0.001);
    omega = result.omega;
    angle += result.angleDelta;
    heat += result.dissipatedEnergy;
  }
  close(omega, whole.omega);
  close(angle, whole.angleDelta);
  close(heat, whole.dissipatedEnergy);
});

test('Small inertias and fast shafts stay finite with bounded reaction and nonnegative brake heat', () => {
  for (const omega of [-4000, 4000]) {
    for (const appliedTorque of [-100, 0, 100]) {
      const input = { ...defaults, omega, appliedTorque, inertia: 0.0001 };
      const result = stepShaftBrake(input, 0.005);
      for (const value of Object.values(result))
        if (typeof value === 'number') assert(Number.isFinite(value));
      checkWork(input, 0.005, result);
    }
  }
});

test('A zero-duration observation cannot reset speed, while invalid inertia/time is rejected', () => {
  const result = stepShaftBrake(defaults, 0);
  assert.equal(result.omega, defaults.omega);
  assert.equal(result.dissipatedEnergy, 0);
  assert.equal(result.locked, false);
  for (const dt of [-1, NaN, Infinity, 601]) assert.throws(() => stepShaftBrake(defaults, dt), RangeError);
  assert.throws(() => stepShaftBrake({ ...defaults, inertia: 0 }, 0.005), RangeError);
  assert.throws(() => stepShaftBrake({ ...defaults, appliedTorque: NaN }, 0.005), RangeError);
});
