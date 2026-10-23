import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateMotorCircuit, makeMotorCircuit, circuitParameters, steadyStateMotor, breakdownSlip, MOTOR_CIRCUIT_RANGES } from '../../motor-circuit.ts';
import { InductionMotorDynamics, MAX_ELECTRICAL_STEP } from '../../motor-dynamics.ts';

const plate = { powerKW: .37, voltage: 230, frequency: 50, current: 2.1, speedRPM: 1420, poles: 4, cosPhi: .8, inertia: .002 };
const estimate = estimateMotorCircuit(plate), circuit = estimate.circuit;
const ratedOmega = plate.speedRPM * Math.PI / 30;
const ac = (frequency = 50, voltage = 230, connected) => ({ mode: 'ac', frequency, voltage, connected });
const dc = (voltages, connected) => ({ mode: 'dc', voltages, connected });
const relative = (actual, expected, tolerance, label = '') => assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(Math.abs(expected), 1e-12), `${label}: ${actual} versus ${expected}`);
function settle(omega, excitation, seconds = 4, c = circuit) {
  const motor = new InductionMotorDynamics(c);
  motor.advance(seconds, { omega, excitation });
  motor.advance(.0001, { omega, excitation });
  return motor;
}
function balanceStep(motor, h, omega, excitation) {
  const before = motor.readings.magneticEnergy;
  const r = motor.advance(h, { omega, excitation });
  const supplied = (r.inputPower - r.torque * omega - r.statorCopperLoss - r.rotorCopperLoss) * h;
  const residual = r.magneticEnergy - before - supplied + r.switchingLoss + r.numericalLoss;
  assert.ok(Math.abs(residual) < 2e-8 * Math.max(1, Math.abs(before), Math.abs(supplied)), `energy residual ${residual}`);
  assert.ok(r.statorCopperLoss >= 0 && r.rotorCopperLoss >= 0 && r.switchingLoss >= 0 && r.numericalLoss >= 0);
  return r;
}

test('The estimate fits torque/no-load/breakdown without hiding incompatible current targets', () => {
  const { fits } = estimate;
  relative(fits.ratedTorque.achieved, 370 / ratedOmega, 1e-10);
  relative(fits.noLoadCurrent.achieved, .35 * 2.1, 1e-10);
  relative(fits.breakdownSlip.achieved, 4 * (1 - 1420 / 1500), 1e-10);
  assert.ok(fits.lockedCurrent.achieved < .5 * fits.lockedCurrent.target);
  assert.ok(fits.ratedCurrent.relativeError < -.2);
  assert.ok(estimate.warnings.some(text => /not simultaneously fitted/.test(text)));
  // Numbers from the independent steady T-circuit, not a target-current scale.
  relative(estimate.rated.current, 1.3948920224, 1e-9);
  relative(estimate.rated.powerFactor, .73656834369, 1e-9);
  const atBreak = steadyStateMotor(circuit, 230, 50, 2 * Math.PI * 50 * (1 - breakdownSlip(circuit, 50)) / 2);
  const below = steadyStateMotor(circuit, 230, 50, 2 * Math.PI * 50 * (1 - .8 * breakdownSlip(circuit, 50)) / 2);
  const above = steadyStateMotor(circuit, 230, 50, 2 * Math.PI * 50 * (1 - 1.2 * breakdownSlip(circuit, 50)) / 2);
  assert.ok(atBreak.torque > below.torque && atBreak.torque > above.torque);
});

test('Circuit parameters stay positive definite and foreign objects do not own the circuit', () => {
  const p = circuitParameters(circuit), c = makeMotorCircuit(p, 2);
  p.Rs = 100;
  assert.equal(c.statorResistance, circuit.statorResistance);
  assert.ok(Object.isFrozen(c));
  assert.ok(c.leakageInductance > 0 && c.rotorInductance > 0);
  for (const key of Object.keys(MOTOR_CIRCUIT_RANGES)) {
    assert.throws(() => makeMotorCircuit({ ...circuitParameters(circuit), [key]: 0 }, 2), RangeError);
    assert.throws(() => makeMotorCircuit({ ...circuitParameters(circuit), [key]: NaN }, 2), RangeError);
  }
  assert.throws(() => makeMotorCircuit(circuitParameters(circuit), 0), RangeError);
});

test('Independent MIT example agrees between flux integration and the equivalent T-circuit', () => {
  // Kirtley MIT6.685 notes10 p.2:230V60Hz,3pole pairs, Rs.06,Rr.055,
  // Xls.34,Xlr.33,Xm10.6 ohm. Reactances are converted to inductances here.
  const w = 2 * Math.PI * 60;
  const c = makeMotorCircuit({ Rs: .06, Rr: .055, Lls: .34 / w, Llr: .33 / w, Lm: 10.6 / w }, 3);
  const omega = .95 * w / 3, expected = steadyStateMotor(c, 230, 60, omega);
  const m = settle(omega, ac(60), 3, c);
  relative(m.readings.currentRms, expected.current, .004, 'MIT current');
  relative(m.readings.torque, expected.torque, .004, 'MIT torque');
  relative(m.readings.inputPower, expected.inputPower, .004, 'MIT input power');
});

test('Rated forward and reverse motoring retain the same power and opposite torque', () => {
  const forward = settle(ratedOmega, ac()).readings;
  const reverse = settle(-ratedOmega, ac(-50)).readings;
  relative(forward.torque, 370 / ratedOmega, .002);
  relative(forward.currentRms, estimate.rated.current, .002);
  relative(forward.inputPower, estimate.rated.inputPower, .002);
  relative(reverse.torque, -forward.torque, 1e-10);
  relative(reverse.currentRms, forward.currentRms, 1e-10);
  relative(reverse.inputPower, forward.inputPower, 1e-10);
  assert.ok(forward.inputPower > forward.torque * ratedOmega);
  const apparent = Math.sqrt(3) * plate.voltage * forward.currentRms;
  relative(Math.hypot(forward.inputPower, forward.reactivePower), apparent, .0002, 'P/Q apparent power');
  relative(reverse.reactivePower, -forward.reactivePower, 1e-10, 'reverse reactive convention');
});

test('Generating exports stator electrical power while plugging imports it', () => {
  for (const sign of [1, -1]) {
    const omega = sign * 165;
    const generated = settle(omega, ac(sign * 50)).readings;
    assert.ok(generated.torque * omega < 0 && generated.inputPower < 0);
    const plugged = settle(omega, ac(-sign * 50)).readings;
    assert.ok(plugged.torque * omega < 0 && plugged.inputPower > 0);
  }
});

test('DC standstill obeys line resistances, zero net current and zero torque', () => {
  const m = settle(0, dc({ U: 12, V: 0, W: 0 }));
  const r = m.readings, i = 8 / circuit.statorResistance;
  relative(r.phaseCurrent.U, i, .0001);
  relative(r.phaseCurrent.V, -i / 2, .0001);
  relative(r.phaseCurrent.W, -i / 2, .0001);
  assert.ok(Math.abs(r.torque) < 1e-10);
  relative(r.inputPower, r.statorCopperLoss, .0001);
  assert.ok(r.rotorCopperLoss < 1e-6);
});

test('DC at nonzero rotor speed brakes naturally and consumes electrical power', () => {
  for (const omega of [ratedOmega, -ratedOmega]) {
    const r = settle(omega, dc({ U: 12, V: 0, W: 0 })).readings;
    assert.ok(r.torque * omega < -1);
    assert.ok(r.inputPower > 0 && r.rotorCopperLoss > 0);
    relative(r.inputPower - r.torque * omega, r.statorCopperLoss + r.rotorCopperLoss, .0001);
  }
});

test('A voltage/frequency reversal keeps flux continuous and builds current over time', () => {
  const m = settle(ratedOmega, ac());
  const before = m.snapshot();
  const switched = m.advance(0, { omega: ratedOmega, excitation: ac(-50, 100) });
  assert.deepEqual(switched.statorFlux, before.statorFlux);
  assert.deepEqual(switched.rotorFlux, before.rotorFlux);
  assert.deepEqual(switched.phaseCurrent, before.phaseCurrent);
  const next = m.advance(.0001, { omega: ratedOmega, excitation: ac(-50, 100) });
  assert.ok(Math.hypot(next.rotorFlux.alpha - before.rotorFlux.alpha, next.rotorFlux.beta - before.rotorFlux.beta) < .05);
  assert.notDeepEqual(next.phaseCurrent, before.phaseCurrent);
  // Retained history is a copy even though advance/readings are borrowed views.
  assert.notDeepEqual(before.phaseCurrent, next.phaseCurrent);
});

test('Opening conductors preserves rotor flux and accounts for lost stator leakage energy', () => {
  const m = settle(ratedOmega, ac());
  const before = m.snapshot();
  const after = m.advance(0, { omega: ratedOmega, excitation: ac(50, 230, { U: false, V: true, W: true }) });
  assert.deepEqual(after.rotorFlux, before.rotorFlux);
  assert.ok(Math.abs(after.phaseCurrent.U) < 1e-12);
  relative(before.magneticEnergy - after.magneticEnergy, after.switchingLoss, 1e-10);
  assert.ok(after.switchingLoss > 0);
  balanceStep(m, .0001, ratedOmega, ac(50, 230, { U: false, V: true, W: true }));
});

test('Single phasing has no starting torque and carries equal/opposite line currents', () => {
  for (const open of ['U', 'V', 'W']) {
    const connected = { U: true, V: true, W: true, [open]: false };
    const r = settle(0, ac(50, 230, connected)).readings;
    assert.ok(Math.abs(r.phaseCurrent[open]) < 1e-12);
    assert.ok(Math.abs(r.phaseCurrent.U + r.phaseCurrent.V + r.phaseCurrent.W) < 1e-12);
    assert.ok(Math.abs(r.torque) < 1e-9);
    assert.ok(r.currentRms > 0);
    const moving = settle(ratedOmega, ac(50, 230, connected));
    let mean = 0;
    for (let n = 0; n < 200; n++) mean += moving.advance(.0001, { omega: ratedOmega, excitation: ac(50, 230, connected) }).torque / 200;
    assert.ok(mean > 0 && mean < 370 / ratedOmega, `running single-phase torque ${mean}`);
  }
});

test('DC through the remaining pair uses the actual series resistance', () => {
  const r = settle(0, dc({ U: 0, V: 12, W: 0 }, { U: false, V: true, W: true })).readings;
  assert.equal(r.phaseCurrent.U, 0);
  relative(r.phaseCurrent.V, 12 / (2 * circuit.statorResistance), .0001);
  relative(r.phaseCurrent.W, -r.phaseCurrent.V, 1e-12);
});

test('Off or a single connected conductor retains decaying rotor flux without stator current', () => {
  for (const excitation of [{ mode: 'off' }, ac(50, 230, { U: true, V: false, W: false })]) {
    const m = settle(ratedOmega, ac()), before = m.snapshot();
    const r = m.advance(.0001, { omega: ratedOmega, excitation });
    assert.ok(Math.hypot(r.rotorFlux.alpha, r.rotorFlux.beta) > .99 * Math.hypot(before.rotorFlux.alpha, before.rotorFlux.beta));
    assert.ok(r.currentMagnitude < 1e-12);
    assert.ok(Math.abs(r.torque) < 1e-10);
    const energy = r.magneticEnergy;
    m.advance(.1, { omega: ratedOmega, excitation });
    assert.ok(m.readings.magneticEnergy < energy * .2);
  }
});

test('The electrical/mechanical energy identity holds through AC, DC, regeneration and opening', () => {
  const m = new InductionMotorDynamics(circuit);
  for (const [omega, excitation] of [[ratedOmega, ac()], [165, ac()], [-ratedOmega, ac(-50)],
    [ratedOmega, dc({ U: 10, V: 0, W: 0 })], [ratedOmega, ac(50, 230, { U: false, V: true, W: true })],
    [ratedOmega, { mode: 'off' }]])
    for (let n = 0; n < 300; n++) balanceStep(m, .0001, omega, excitation);
});

test('Resistive stiffness and extreme positive circuits stay passive and finite', () => {
  for (const p of [
    { Rs: 1000, Rr: 1000, Lls: 1e-6, Llr: 1e-6, Lm: 1e-5 },
    { Rs: .001, Rr: 1000, Lls: 1e-6, Llr: 1e-6, Lm: 100 },
    { Rs: 1000, Rr: .001, Lls: 10, Llr: 10, Lm: 100 },
    { Rs: .001, Rr: .001, Lls: 1e-6, Llr: 1e-6, Lm: 100 },
  ]) {
    const m = new InductionMotorDynamics(makeMotorCircuit(p, 6));
    for (let n = 0; n < 200; n++) {
      const r = balanceStep(m, .0001, 2000, ac(200, 500));
      for (const value of [r.torque, r.inputPower, r.magneticEnergy, r.currentMagnitude]) assert.ok(Number.isFinite(value));
    }
    let energy = m.readings.magneticEnergy;
    for (let n = 0; n < 100; n++) {
      const r = balanceStep(m, .0001, 0, { mode: 'off' });
      assert.ok(r.magneticEnergy <= energy * (1 + 1e-12) + 1e-12);
      energy = r.magneticEnergy;
    }
  }
});

test('Batching does not change flux trajectory and a smaller step converges to the T-circuit', () => {
  const a = new InductionMotorDynamics(circuit), b = new InductionMotorDynamics(circuit);
  a.advance(.005, { omega: ratedOmega, excitation: ac() });
  for (let n = 0; n < 50; n++) b.advance(.0001, { omega: ratedOmega, excitation: ac() });
  assert.deepEqual(a.readings.statorFlux, b.readings.statorFlux);
  assert.deepEqual(a.readings.rotorFlux, b.readings.rotorFlux);
  const coarse = settle(ratedOmega, ac()), fine = new InductionMotorDynamics(circuit);
  for (let n = 0; n < 80002; n++) fine.advance(.00005, { omega: ratedOmega, excitation: ac() });
  const target = estimate.rated.torque;
  assert.ok(Math.abs(fine.readings.torque - target) < .4 * Math.abs(coarse.readings.torque - target));
  assert.equal(MAX_ELECTRICAL_STEP, .0001);
});

test('Extreme supported nameplates produce valid circuits and report infeasible ratings', () => {
  for (const p of [{ ...plate, powerKW: 3, current: .1, voltage: 100, frequency: 40, speedRPM: 50, poles: 12 },
    { ...plate, powerKW: .05, current: 20, voltage: 500, frequency: 200, speedRPM: 11999, poles: 2 }]) {
    const e = estimateMotorCircuit(p);
    assert.ok(e.warnings.length > 0);
    for (const [key, value] of Object.entries(e.parameters)) assert.ok(value >= MOTOR_CIRCUIT_RANGES[key][0] && value <= MOTOR_CIRCUIT_RANGES[key][1]);
    const m = new InductionMotorDynamics(e.circuit);
    m.advance(.02, { omega: p.speedRPM * Math.PI / 30, excitation: ac(p.frequency, p.voltage) });
    assert.ok(Number.isFinite(m.readings.magneticEnergy));
  }
});


test('Checkpoint rollback is exact across voltage and topology trials and reuses output objects', () => {
  const m = settle(ratedOmega, ac()), saved = m.checkpoint(), before = m.snapshot();
  const borrowed = m.readings, phases = borrowed.phaseCurrent, flux = borrowed.rotorFlux;
  const input = { omega: ratedOmega, excitation: dc({ U: 0, V: 15, W: 0 }, { U: false, V: true, W: true }) };
  m.advance(.0001, input);
  const accepted = m.snapshot();
  assert.ok(accepted.switchingLoss > 0);
  assert.notDeepEqual(accepted, before);
  assert.strictEqual(m.restore(saved), borrowed);
  assert.strictEqual(m.readings.phaseCurrent, phases);
  assert.strictEqual(m.readings.rotorFlux, flux);
  assert.deepEqual(m.snapshot(), before);
  m.advance(.0001, input);
  assert.deepEqual(m.snapshot(), accepted);
  assert.strictEqual(m.checkpoint(saved), saved);
  m.advance(.001, { omega: -ratedOmega, excitation: ac(-50) });
  m.restore(saved);
  assert.deepEqual(m.snapshot(), accepted);
  const other = new InductionMotorDynamics(makeMotorCircuit(circuitParameters(circuit), 3));
  assert.throws(() => other.restore(saved), RangeError);
});

test('An exactly unenergized stopped motor advances its clock with zero borrowed readings', () => {
  const motor = new InductionMotorDynamics(circuit);
  const borrowed = motor.readings;
  assert.strictEqual(motor.advance(60, { omega: 0, excitation: { mode: 'off' } }), borrowed);
  assert.equal(borrowed.time, 60);
  for (const key of ['electricalAngle', 'torque', 'instantaneousTorque', 'currentMagnitude', 'currentRms',
    'inputPower', 'reactivePower', 'statorCopperLoss', 'rotorCopperLoss', 'magneticEnergy', 'switchingLoss', 'numericalLoss'])
    assert.equal(borrowed[key], 0, key);
  for (const values of [borrowed.phaseCurrent, borrowed.phaseVoltage, borrowed.statorFlux, borrowed.rotorFlux])
    assert(Object.values(values).every(value => value === 0));
  const saved = motor.checkpoint();
  motor.advance(.005, { omega: 0, excitation: { mode: 'off' } });
  assert.equal(motor.readings.time, 60.005);
  motor.restore(saved);
  assert.equal(motor.readings.time, 60);
  motor.advance(.0001, { omega: 0, excitation: ac() });
  assert(motor.readings.currentMagnitude > 0, 'The shortcut must not skip the first energized step');
});
