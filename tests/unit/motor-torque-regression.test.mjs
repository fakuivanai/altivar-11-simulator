import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateMotorCircuit, steadyStateMotor } from '../../motor-circuit.ts';
import { InductionMotorDynamics } from '../../motor-dynamics.ts';

const plate = { powerKW: .37, voltage: 230, frequency: 50, current: 2.1,
  speedRPM: 1420, poles: 4, cosPhi: .8, inertia: .002 };
const estimate = estimateMotorCircuit(plate), circuit = estimate.circuit;
const ratedTorque = 1000 * plate.powerKW / (plate.speedRPM * Math.PI / 30);
const ratedInput = Math.sqrt(3) * plate.voltage * plate.current * plate.cosPhi;
const ratedSlipHz = plate.frequency - plate.speedRPM * plate.poles / 120;

function settledPoint(direction, slipMultiple) {
  const frequency = direction * plate.frequency;
  const omega = (frequency - direction * slipMultiple * ratedSlipHz) * 4 * Math.PI / plate.poles;
  const excitation = { mode: 'ac', frequency, voltage: plate.voltage };
  const expected = steadyStateMotor(circuit, plate.voltage, frequency, omega);
  const motor = new InductionMotorDynamics(circuit);
  motor.advance(4, { omega, excitation });
  const before = motor.readings.magneticEnergy;
  const period = 1 / plate.frequency;
  const actual = motor.advance(period, { omega, excitation });
  const conversion = (actual.inputPower - actual.torque * omega
    - actual.statorCopperLoss - actual.rotorCopperLoss) * period;
  const energyResidual = actual.magneticEnergy - before - conversion
    + actual.switchingLoss + actual.numericalLoss;
  assert(Math.abs(energyResidual) < 2e-8 * Math.max(1, before, Math.abs(actual.inputPower * period)));
  assert(actual.statorCopperLoss >= 0 && actual.rotorCopperLoss >= 0);
  return { actual, expected };
}

// Exercise the stable branch, beyond breakdown, deep slip and locked rotor.
// The independent complex T-circuit is the reference, not a prescribed current
// or an empirical symmetric torque curve. Positive Rs makes generation asymmetric.
const slips = [...Array.from({ length: 40 }, (_, index) => (index + 1) / 10), 6, 8, 12, 18.75];
for (const [name, slipSign] of [['motoring', 1], ['generating', -1]]) {
  test('Settled ' + name + ' torque, current and power agree with the independent T-circuit', context => {
    const worst = { torque: 0, current: 0, inputPower: 0 };
    for (const direction of [1, -1]) for (const multiple of slips) {
      const { actual, expected } = settledPoint(direction, slipSign * multiple);
      assert(actual.torque * expected.torque > 0, 'Torque direction follows physical slip');
      for (const [key, rated] of [['torque', ratedTorque], ['current', plate.current], ['inputPower', ratedInput]]) {
        const value = key === 'current' ? actual.currentRms : actual[key];
        const error = Math.abs(value - expected[key]) / Math.max(rated, Math.abs(expected[key]));
        // Fixed 100 us midpoint sampling leaves a small discretization error.
        assert(error < .005, key + ' differs from the phasor result at slip ' + slipSign * multiple);
        worst[key] = Math.max(worst[key], error);
      }
    }
    context.diagnostic('Maximum normalized torque/current/power errors: ' + JSON.stringify(worst));
  });
}

test('The synchronous torque residual converges quadratically to zero with step refinement', context => {
  let maximum = 0;
  for (const direction of [1, -1]) {
    const { actual, expected } = settledPoint(direction, 0);
    assert(Math.abs(expected.torque) < 1e-12);
    const motor = new InductionMotorDynamics(circuit);
    const input = { omega: direction * 2 * Math.PI * plate.frequency / circuit.polePairs,
      excitation: { mode: 'ac', frequency: direction * plate.frequency, voltage: plate.voltage } };
    for (let n = 0; n < 80000; n++) motor.advance(.00005, input);
    let fineTorque = 0;
    for (let n = 0; n < 400; n++) fineTorque += motor.advance(.00005, input).torque / 400;
    const coarseError = Math.abs(actual.torque), fineError = Math.abs(fineTorque);
    maximum = Math.max(maximum, coarseError / ratedTorque);
    assert(coarseError < .003 * ratedTorque, '100 us residual exceeds 0.3% of rated torque');
    assert(fineError < .001 * ratedTorque, '50 us residual exceeds 0.1% of rated torque');
    assert(fineError < .3 * coarseError, 'Halving the midpoint step must reduce its torque residual about fourfold');
  }
  context.diagnostic('Maximum 100 us synchronous residual fraction of rated torque: ' + maximum);
});
