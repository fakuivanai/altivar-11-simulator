import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PhysicalPlant, PLANT_ASSUMPTIONS } from '../../physical-plant.ts';
import { circuitParameters } from '../../motor-circuit.ts';
import { createScopeHistory } from '../../scope-history.ts';

const h = .0001;
function config() {
  return {
    parameters: {},
    motor: { powerKW: .37, voltage: 230, frequency: 50, current: 2.1, speedRPM: 1420, poles: 4, cosPhi: .8, inertia: .002 },
    motorElectrical: { mode: 'estimated' },
    mechanical: { torque: 0, friction: 0, inertia: 0 },
    inputs: { powered: true, supplyV: 230, LI1: false, LI2: false, LI3: false, LI4: false,
      analogType: '5V', analogPosition: 100, outputConnections: { U: true, V: true, W: true },
      shaftHeld: false, shortCircuit: false, brakeModule: true, ambient: 25, ventilation: 1 },
  };
}
const off = { mode: 'off', frequency: 0, voltage: 0, currentLimit: 10000, injectionCurrent: 1.5, running: false, fault: null };
const ac = (frequency = 50, voltage = 230) => ({ ...off, mode: 'ac', frequency, voltage, running: true });
const dc = { ...off, mode: 'dc' };
function run(p, c, command, seconds) {
  for (let n = 0; n < Math.round(seconds / .005); n++) p.advance(.005, command, c, n * .005);
}
function charged(c = config()) {
  const p = new PhysicalPlant(c);
  run(p, c, off, .25);
  return p;
}
function totalMotorEnergy(p, c) {
  return p.instantaneous.magneticEnergy + .5 * (c.motor.inertia + c.mechanical.inertia) * p.omega ** 2;
}
function energyStep(p, c, command, externalWork = 0) {
  const before = totalMotorEnergy(p, c), num = p.numericalLoss, switching = p.switchingLoss, brake = p.brakeHeat;
  p.advance(h, command, c, 0);
  const residual = totalMotorEnergy(p, c) - before - (p.inputPower - p.windingLoss) * h
    + p.numericalLoss - num + p.switchingLoss - switching + p.brakeHeat - brake + externalWork;
  assert.ok(Math.abs(residual) < 2e-8 * Math.max(1, Math.abs(before), Math.abs(p.inputPower * h)), `coupled energy defect ${residual}`);
}

test('Finite precharge precedes excitation and cannot create a motor state from an empty bus', () => {
  const c = config(), p = new PhysicalPlant(c);
  c.inputs.powered = false;
  p.advance(.005, ac(), c, 0);
  assert.equal(p.dcLink.energy, 0);
  assert.equal(totalMotorEnergy(p, c), 0);
  c.inputs.powered = true;
  p.advance(.005, off, c, .005);
  assert.ok(p.dcLink.voltage > 0 && p.dcLink.voltage < 230 * Math.SQRT2);
  assert.equal(p.dcLink.precharging, true);
  run(p, c, off, .25);
  assert.equal(p.dcLink.precharging, false);
  assert.ok(p.dcLink.voltage > 300 && p.dcLink.voltage < 326);
});

test('Electrical conversion work and mechanical kinetic energy balance at every coupled step', () => {
  const c = config(), p = charged(c);
  for (const command of [ac(), ac(-50, 180), dc, off])
    for (let n = 0; n < 250; n++) energyStep(p, c, command);
  assert.ok(p.numericalLoss >= 0 && p.switchingLoss > 0);
  assert.equal(Object.hasOwn(PLANT_ASSUMPTIONS, 'inverterResistance'), false);
  assert.equal(Object.hasOwn(PLANT_ASSUMPTIONS, 'maximumOmega'), false);
});

test('Tiny inertia uses coupled midpoint motion rather than an explicit kinetic-energy source', () => {
  const c = config();
  c.motor.inertia = .0001;
  c.motorElectrical = { mode: 'manual', parameters: { Rs: .001, Rr: .001, Lls: 1e-6, Llr: 1e-6, Lm: .01 } };
  const p = charged(c);
  for (let n = 0; n < 150; n++) energyStep(p, c, ac(100, 230));
  assert.ok(Number.isFinite(p.omega) && Number.isFinite(p.current));
});

test('A passive load stops within a step and holds without artificial reversal or overrun', () => {
  const c = config(), p = new PhysicalPlant(c);
  c.inputs.powered = false;
  c.mechanical.torque = 2;
  p.omega = .03; // exact stop at J*omega/T = 30 us, inside the 100 us step.
  const before = .5 * c.motor.inertia * p.omega ** 2;
  p.advance(h, off, c, 0);
  assert.equal(p.omega, 0);
  assert.ok(Math.abs(c.mechanical.torque * p.angle - before) < 1e-15);
  const stoppedAngle = p.angle;
  p.advance(.005, off, c, h);
  assert.equal(p.angle, stoppedAngle);
  assert.equal(p.omega, 0);
  assert.equal(p.brakeHeat, 0); // The external load absorbed that work.
});

test('Finite shaft braking dissipates precisely the kinetic energy and preserves stopping angle', () => {
  const c = config(), p = new PhysicalPlant(c);
  c.inputs.powered = false; c.inputs.shaftHeld = true;
  p.omega = .03;
  const before = .5 * c.motor.inertia * p.omega ** 2;
  energyStep(p, c, off);
  assert.equal(p.omega, 0);
  assert.ok(Math.abs(p.brakeHeat - before) < 1e-15);
  assert.ok(p.angle > 0 && p.angle < .03 * h / 2);
  assert.ok(p.shaftReactionTorque < 0);
});

test('Viscous friction is passive even at the largest friction and smallest inertia', () => {
  const c = config(), p = new PhysicalPlant(c);
  c.inputs.powered = false; c.motor.inertia = .0001; c.mechanical.friction = .2;
  p.omega = 100;
  let energy = totalMotorEnergy(p, c);
  for (let n = 0; n < 100; n++) {
    const previousAngle = p.angle;
    p.advance(h, off, c, n * h);
    const displacement = p.angle - previousAngle;
    const next = totalMotorEnergy(p, c);
    assert.ok(Math.abs(next - energy + c.mechanical.friction * displacement ** 2 / h) < 1e-10);
    assert.ok(p.omega >= 0 && next <= energy);
    energy = next;
  }
});

test('Steady forward/reverse motoring and load steps derive speed, torque and phase lag from the circuit', () => {
  const c = config(); c.motor.inertia = .002; c.mechanical.inertia = .008;
  const p = charged(c);
  run(p, c, ac(), 1.5);
  const unloadedLag = p.currentLag, unloadedSpeed = p.omega;
  assert.ok(unloadedSpeed > 150 && unloadedSpeed < 158);
  c.mechanical.torque = 2;
  run(p, c, ac(), 1);
  assert.ok(p.omega < unloadedSpeed && p.omega > 140);
  assert.ok(p.torque > 1.95 && p.torque < 2.05);
  assert.ok(p.currentLag < unloadedLag && p.currentLag > 0);
  const reverseConfig = config(); reverseConfig.mechanical.inertia = .008;
  const reverse = charged(reverseConfig); run(reverse, reverseConfig, ac(-50), 1.5);
  reverseConfig.mechanical.torque = 2; run(reverse, reverseConfig, ac(-50), 1);
  assert.ok(reverse.omega < -140 && reverse.torque < -1.9 && reverse.inputPower > 0);
});

test('Natural DC braking, generating and plugging have distinct physical power signs', () => {
  const c = config(), p = charged(c);
  run(p, c, ac(), .6);
  const speed = p.omega;
  run(p, c, dc, .1);
  assert.ok(p.omega > 0 && p.omega < speed && p.torque < 0 && p.inputPower > 0);
  // A negative load is an external driving torque, allowing steady regeneration.
  const generatorConfig = config(); generatorConfig.mechanical.torque = -2;
  const generator = charged(generatorConfig); generator.omega = 170;
  run(generator, generatorConfig, ac(), .5);
  assert.ok(generator.omega > 157 && generator.inputPower < 0 && generator.regenerativePower > 0);
  const plug = charged(c); plug.omega = 150;
  run(plug, c, ac(-50), .03);
  assert.ok(plug.torque < 0 && plug.inputPower > 0);
});

test('Abrupt commands and conductor loss retain flux and sampled history owns no mutable motor buffers', () => {
  const c = config(), p = charged(c), history = createScopeHistory();
  p.setSampleListener(sample => history.push(sample));
  run(p, c, ac(), .2);
  const before = { ...p.instantaneous.rotorFlux };
  p.advance(h, ac(-80, 90), c, .2);
  assert.ok(Math.hypot(p.instantaneous.rotorFlux.alpha - before.alpha, p.instantaneous.rotorFlux.beta - before.beta) < .1);
  c.inputs.outputConnections.U = false;
  p.advance(.005, ac(-80, 90), c, .2001);
  assert.ok(Math.abs(p.instantaneous.phaseCurrent.U) < 1e-12);
  assert.ok(Number.isFinite(p.inputPower) && p.switchingLoss > 0);
  const sample = history.samples()[0], retained = structuredClone(sample);
  run(p, c, off, .05);
  assert.deepEqual(sample, retained);
  assert.equal(p.current, 0);
  assert.ok(p.instantaneous.magneticEnergy >= 0);
});

test('Bus feasibility reduces voltage for a low-resistance extreme without unserved energy', () => {
  const c = config(); c.inputs.powered = false;
  c.motorElectrical = { mode: 'manual', parameters: { Rs: .001, Rr: 1000, Lls: 1e-6, Llr: 1e-6, Lm: 1e-5 } };
  const p = new PhysicalPlant(c); p.dcLink.reset(100);
  const available = p.dcLink.energy;
  p.advance(.005, ac(200, 500), c, 0);
  assert.ok(p.dcLink.energy >= 0 && p.dcLink.energy < available);
  assert.ok(Number.isFinite(p.instantaneous.magneticEnergy) && p.voltage < 100 / Math.SQRT2);
});

test('Circuit replacement is owned, explicit and stopped-only; reset is deterministic', () => {
  const c = config(), p = charged(c), original = p.circuit;
  c.motorElectrical = { mode: 'manual', parameters: circuitParameters(original) };
  p.configureMotor(c);
  assert.notStrictEqual(p.circuit, original);
  c.motorElectrical.parameters.Rs *= 2;
  assert.equal(p.circuit.statorResistance, original.statorResistance);
  run(p, c, ac(), .01);
  assert.throws(() => p.configureMotor(c), RangeError);
  p.reset();
  assert.equal(p.omega, 0); assert.equal(p.dcLink.energy, 0);
  assert.equal(p.instantaneous.magneticEnergy, 0);
  p.configureMotor(c);
  assert.equal(p.circuit.statorResistance, 2 * original.statorResistance);
});


test('Capacitor plus motor/shaft energy closes against source, board, copper and dissipative ledgers', () => {
  const c = config(), p = charged(c);
  p.omega = 200;
  const original = p.dcLink.step.bind(p.dcLink);
  let link, demand;
  p.dcLink.step = (dt, input) => {
    demand = input.electricalPower;
    link = original(dt, input);
    return link;
  };
  let regenerated = 0;
  for (const command of [ac(), ac(-50), dc, off]) {
    for (let n = 0; n < 400; n++) {
      const before = totalMotorEnergy(p, c) + p.dcLink.energy;
      const numerical = p.numericalLoss, switching = p.switchingLoss;
      p.advance(h, command, c, 0);
      const board = (demand - p.inputPower) * h;
      const removed = p.windingLoss * h + board + link.bleedEnergy + link.brakeEnergy
        + p.numericalLoss - numerical + p.switchingLoss - switching;
      const residual = totalMotorEnergy(p, c) + p.dcLink.energy - before - link.rectifierEnergy + removed;
      assert.ok(Math.abs(residual) < 2e-8 * Math.max(1, Math.abs(before)), `whole-plant energy defect ${residual}`);
      assert.ok(Math.abs(link.unservedEnergy) < 1e-12);
      assert.ok(Math.abs(board) < 1e-12 || Math.abs(board - 5 * h) < 1e-12);
      regenerated += link.regeneratedEnergy;
    }
  }
  assert.ok(regenerated > 0, 'A generating interval must return actual electrical energy to the capacitor');
});
