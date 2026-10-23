import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateMotorCircuit } from '../../motor-circuit.ts';
import { InductionMotorDynamics } from '../../motor-dynamics.ts';

// Frozen v1.0.0 classroom nameplate, not a measured motor identification.
const plate = { powerKW: .37, voltage: 230, frequency: 50, current: 2.1,
  speedRPM: 1420, poles: 4, cosPhi: .8, inertia: .002 };
const circuit = estimateMotorCircuit(plate).circuit;
const ratedTorque = 1000 * plate.powerKW / (plate.speedRPM * Math.PI / 30);
const ratedSlipHz = Math.max(.2, plate.frequency - plate.speedRPM * plate.poles / 120);
const excitation = direction => ({ mode: 'ac', frequency: direction * plate.frequency, voltage: plate.voltage });

// Adapted pre-current-limit balanced torque curve from v1.0.0 engine.ts,
// lines 521-522 and 549-551. At 50 Hz/230 V the legacy normalized flux is 1:
// https://github.com/fakuivanai/altivar-11-simulator/blob/bd3f2b256d58956fdffa437a91688c22f11c8999/engine.ts#L549-L551
// We compare the intrinsic curve, excluding the old independent current/torque
// clipping, ramp adaptation, imposed shaft hold and single-phase approximations.
function legacyTorque(frequency, omega) {
  const slip = frequency - omega * plate.poles / (4 * Math.PI);
  const breakdown = 4 * ratedSlipHz;
  return ratedTorque * (slip / ratedSlipHz) / (1 + (slip / breakdown) ** 2) * (1 + 1 / 16);
}
function settledTorque(direction, slipMultiple) {
  const frequency = direction * plate.frequency;
  const omega = (frequency - direction * slipMultiple * ratedSlipHz) * 4 * Math.PI / plate.poles;
  const motor = new InductionMotorDynamics(circuit);
  motor.advance(4, { omega, excitation: excitation(direction) });
  // Average one electrical period after settling; never include startup torque.
  const torque = motor.advance(1 / plate.frequency, { omega, excitation: excitation(direction) }).torque;
  return { actual: torque, expected: legacyTorque(frequency, omega) };
}

// Dense useful operating range through 4sn breakdown, plus deep-slip/stall
// points. Locked rotor is 18.75sn for this plate. Generating points mirror slips,
// including super-synchronous operation; both AC phase sequences are exercised.
const slips = [...Array.from({ length: 40 }, (_, index) => (index + 1) / 10), 6, 8, 12, 18.75];

for (const [name, slipSign, tolerance] of [['motoring', 1, .07], ['generating', -1, .18]]) {
  test(`Settled ${name} torque retains the v1.0.0 curve within its explicit physical-model tolerance`, context => {
    let worst = { error: 0, direction: 0, slip: 0 }, ratedError = 0;
    for (const direction of [1, -1]) for (const multiple of slips) {
      const slip = slipSign * multiple, { actual, expected } = settledTorque(direction, slip);
      const error = Math.abs((actual - expected) / expected);
      assert.ok(actual * expected > 0, `torque sign at sequence ${direction}, slip ${slip}sn`);
      assert.ok(error <= tolerance, `${name} at sequence ${direction}, slip ${slip}sn: ${actual} Nm versus legacy ${expected} Nm, deviation ${(100 * error).toFixed(3)}% exceeds ${(100 * tolerance).toFixed(0)}%`);
      if (error > worst.error) worst = { error, direction, slip };
      if (slipSign === 1 && multiple === 1) ratedError = Math.max(ratedError, error);
    }
    // Measured 100 us baseline: 5.939% motoring, 17.076% generating. The 7%/18%
    // bounds expose the intended mismatch rather than claiming curve identity.
    // Rs makes the physical generating/motoring branches asymmetric, whereas
    // the old reduced curve is odd. Current/PF/6In targets are not torque scales.
    context.diagnostic(`Maximum ${name} deviation ${(100 * worst.error).toFixed(4)}% at ${worst.slip}sn, sequence ${worst.direction}; allowed ${(100 * tolerance).toFixed(0)}%`);
    if (slipSign === 1) {
      assert.ok(ratedError < .002, 'Rated shaft torque must remain within 0.2%');
      context.diagnostic(`Rated torque deviation ${(100 * ratedError).toFixed(4)}%`);
    }
  });
}

test('Synchronous settled torque stays near zero without a singular relative-error assertion', context => {
  let maximum = 0;
  for (const direction of [1, -1]) {
    const { actual, expected } = settledTorque(direction, 0);
    assert.ok(Math.abs(expected) < 1e-12);
    maximum = Math.max(maximum, Math.abs(actual) / ratedTorque);
    // Fixed 100 us midpoint phase/rotation sampling leaves 0.172%Tn here. An
    // absolute rated-torque fraction is meaningful at a zero legacy torque.
    assert.ok(Math.abs(actual) < .002 * ratedTorque, `Synchronous torque ${actual} Nm exceeds 0.2% of rated torque`);
  }
  context.diagnostic(`Maximum synchronous residual ${(100 * maximum).toFixed(4)}% of rated torque; allowed 0.2%`);
});
