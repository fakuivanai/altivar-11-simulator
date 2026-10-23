import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { VFDDrive } from '../../engine.ts';
import { initialConfig, parseConfiguration } from '../../configuration.ts';
import { circuitParameters, estimateMotorCircuit } from '../../motor-circuit.ts';

const STEP = VFDDrive.FIXED_STEP;
const close = (actual, expected, tolerance = 1e-9) =>
  assert(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);

function configuration() {
  const config = initialConfig();
  config.inputs.analogPosition = 100;
  config.mechanical.torque = 0.2;
  // These tests isolate electrical/mechanical transients from optional load timers.
  config.parameters['FUn.tOL'] = 0;
  config.parameters['FUn.tUL'] = 0;
  return config;
}

function driveInMode(mode) {
  const config = configuration();
  config.parameters['FUn.AdC.ACt'] = mode === 'dc' ? 'Ct' : 'nO';
  const drive = new VFDDrive(config);
  drive.advance(0.3);
  if (mode !== 'dc') {
    drive.setInputs({ LI1: true });
    drive.advance(1);
    if (mode === 'coasting') {
      drive.inhibitCommands();
      drive.advance(STEP);
    }
  }
  assert.equal(drive.state.outputMode, mode === 'coasting' ? 'off' : mode);
  assert.equal(drive.state.fault, null);
  return drive;
}

function assertFinite(value, path = 'state') {
  if (typeof value === 'number') assert(Number.isFinite(value), path + ' must remain finite');
  else if (value && typeof value === 'object')
    for (const [key, child] of Object.entries(value)) assertFinite(child, path + '.' + key);
}

function changeConfiguration(drive, update) {
  const candidate = structuredClone(drive.config);
  update(candidate);
  drive.setConfig(candidate);
}

function assertContinuousConfigurationChange(drive, update) {
  const before = drive.snapshot();
  update(drive);
  const after = drive.snapshot();
  for (const key of ['omega', 'angle', 'dcBus', 'motorThermal', 'actualMotorThermal',
    'statorFluxAlpha', 'statorFluxBeta', 'rotorFluxAlpha', 'rotorFluxBeta', 'magneticEnergy'])
    assert.equal(after[key], before[key], key + ' must not reset when bench inputs change');
}

for (const reference of [50, 100]) {
  test('The default bench runs for 30 seconds at ' + reference + '% reference with factory load timers', () => {
    const config = initialConfig();
    config.inputs.analogPosition = reference;
    const drive = new VFDDrive(config);
    drive.advance(0.3);
    drive.setInputs({ LI1: true });
    const underload = VFDDrive.DRIVE_CURRENT * config.parameters['FUn.LUL'] / 100;
    const overload = VFDDrive.DRIVE_CURRENT * config.parameters['FUn.LOC'] / 100;
    assert.equal(config.parameters['FUn.LUL'], 60);
    assert.equal(config.parameters['FUn.tUL'], 5);
    for (let halfSecond = 0; halfSecond < 60; halfSecond++) {
      drive.advance(0.5);
      assert.equal(drive.state.fault, null);
      if (halfSecond >= 12) {
        assert(drive.state.referenceReached);
        assert(drive.state.current > underload);
        assert(drive.state.current < overload);
      }
    }
    assert(drive.state.running && drive.state.rpm > 0);
    assert(!drive.state.currentLimited);
  });
}

test('An 8 ms fake-clock frame stops work and retains every pending fixed step', () => {
  const drive = new VFDDrive(configuration());
  let clock = 0;
  const result = drive.advanceBudget(1, 8, () => clock++);
  assert(Number.isInteger(result.steps) && result.steps > 0 && result.steps <= 8);
  close(drive.state.time, result.steps * STEP);
  close(result.backlog, 1 - result.steps * STEP);
  assert(result.backlog > 0.9);
  // Clock reads cost 1 ms each. The scheduler must leave at the 8 ms boundary.
  assert(clock <= 10);
});

test('Budgeted backlog drains to the exact unlimited-advance snapshot', () => {
  const config = configuration();
  const budgeted = new VFDDrive(config);
  const exact = new VFDDrive(config);
  budgeted.setInputs({ LI1: true });
  exact.setInputs({ LI1: true });
  let clock = 0;
  const first = budgeted.advanceBudget(1, 8, () => clock++);
  const last = budgeted.advanceBudget(0, 8, () => 0);
  assert.equal(first.steps + last.steps, Math.round(1 / STEP));
  close(last.backlog, 0);
  exact.advance(1);
  assert.deepEqual(budgeted.snapshot(), exact.snapshot());
});

test('Fractional elapsed time remains pending across frames without changing the integration step', () => {
  const drive = new VFDDrive(configuration());
  const first = drive.advanceBudget(STEP * 0.4, 8, () => 0);
  assert.equal(first.steps, 0);
  close(first.backlog, STEP * 0.4);
  assert.equal(drive.state.time, 0);
  const second = drive.advanceBudget(STEP * 0.6, 8, () => 0);
  assert.equal(second.steps, 1);
  close(second.backlog, 0);
  close(drive.state.time, STEP);
});

test('Backlog survives a second elapsed-time contribution and exact advance can finish it', () => {
  const config = configuration();
  const budgeted = new VFDDrive(config);
  const exact = new VFDDrive(config);
  let clock = 0;
  const first = budgeted.advanceBudget(0.4, 8, () => clock++);
  clock = 0;
  const second = budgeted.advanceBudget(0.6, 8, () => clock++);
  close(second.backlog + (first.steps + second.steps) * STEP, 1);
  budgeted.advance(0);
  exact.advance(1);
  assert.deepEqual(budgeted.snapshot(), exact.snapshot());
});

test('One simulated second fits its CPU allowance, independently of host scheduling delays', context => {
  const drive = new VFDDrive(configuration());
  drive.advance(0.3);
  drive.setInputs({ LI1: true });
  const cpu = process.cpuUsage();
  const wall = performance.now();
  drive.advance(1);
  const wallMs = performance.now() - wall;
  const elapsed = process.cpuUsage(cpu);
  const cpuMs = (elapsed.user + elapsed.system) / 1000;
  context.diagnostic(`Simulated 1 s: CPU ${cpuMs.toFixed(1)} ms; wall ${wallMs.toFixed(1)} ms`);
  assert(cpuMs < 500, `CPU allowance exceeded: ${cpuMs.toFixed(1)}ms`);
  close(drive.state.time, 1.3);
  assertFinite(drive.snapshot());
});

const benchSteps = [
  ['resisting/driving load torque', drive => changeConfiguration(drive, c => c.mechanical.torque = 20),
    drive => changeConfiguration(drive, c => c.mechanical.torque = -20)],
  ['friction limits', drive => changeConfiguration(drive, c => c.mechanical.friction = 0.2),
    drive => changeConfiguration(drive, c => c.mechanical.friction = 0)],
  ['attached inertia limits', drive => changeConfiguration(drive, c => c.mechanical.inertia = 2),
    drive => changeConfiguration(drive, c => c.mechanical.inertia = 0)],
  ['normal supply steps', drive => drive.setInputs({ supplyV: 200 }),
    drive => drive.setInputs({ supplyV: 260 })],
  ['analog reference limits', drive => drive.setInputs({ analogPosition: 0 }),
    drive => drive.setInputs({ analogPosition: 100 })],
  ['one open conductor and reconnection', drive => drive.setInputs({ outputConnections: { U: false, V: true, W: true } }),
    drive => drive.setInputs({ outputConnections: { U: true, V: true, W: true } })],
  ['all output conductors open and reconnect', drive => drive.setInputs({ outputConnections: { U: false, V: false, W: false } }),
    drive => drive.setInputs({ outputConnections: { U: true, V: true, W: true } })],
  ['shaft hold and release', drive => drive.setInputs({ shaftHeld: true }),
    drive => drive.setInputs({ shaftHeld: false })],
  ['ambient and ventilation limits', drive => drive.setInputs({ ambient: 60, ventilation: 0 }),
    drive => drive.setInputs({ ambient: 0, ventilation: 1 })],
  ['run/direction command changes', drive => drive.setInputs({ LI1: false, LI2: true }),
    drive => drive.setInputs({ LI1: true, LI2: false })],
];

for (const mode of ['ac', 'dc', 'coasting']) {
  for (const [name, ...changes] of benchSteps) {
    test(`${mode}: abrupt ${name} preserve finite continuous physical state`, () => {
      const drive = driveInMode(mode);
      for (const update of changes) {
        assertContinuousConfigurationChange(drive, update);
        drive.advance(STEP);
        const state = drive.snapshot();
        assertFinite(state);
        assert(state.dcBus >= 0);
        assert(!['InF', 'CFF', 'CrF', 'PHF'].includes(state.fault), 'A numerical/configuration fault cannot replace a physical input transient');
        if (state.fault !== null)
          assert.equal(state.fault, 'ObF', 'Only genuine regeneration may cross a protection threshold in this short interval');
        assert.notEqual(Math.abs(state.omega), 4000, 'No arbitrary speed ceiling may replace mechanical integration');
      }
    });
  }
}

test('A finite shaft brake allows travel after engagement and holds only after stopping', () => {
  const drive = driveInMode('ac');
  const before = drive.snapshot();
  assert(Math.abs(before.omega) > 10);
  drive.setInputs({ shaftHeld: true });
  drive.advance(STEP);
  assert(Math.abs(drive.state.omega) > 0);
  assert.notEqual(drive.state.angle, before.angle);
  const rated = drive.config.motor.powerKW * 1000 / (drive.config.motor.speedRPM * Math.PI / 30);
  assert(Math.abs(drive.state.shaftReactionTorque) <= 3 * rated + 1e-9);
  drive.advance(1);
  assert.equal(drive.state.omega, 0);
  const heldAngle = drive.state.angle;
  drive.advance(0.1);
  assert.equal(drive.state.angle, heldAngle);
});

test('Allowed unpowered driving torque follows inertia beyond an arbitrary numerical speed ceiling', () => {
  const config = configuration();
  config.inputs.powered = false;
  config.motor.inertia = 0.0001;
  config.mechanical = { torque: -20, friction: 0, inertia: 0 };
  const drive = new VFDDrive(config);
  drive.advance(0.025);
  close(drive.state.omega, 20 / 0.0001 * 0.025, 1e-6);
  assert(drive.state.omega > 4000);
  assert.equal(drive.state.fault, null);
  assert.equal(drive.state.current, 0);
  assert.equal(drive.state.outputMode, 'off');
  assertFinite(drive.snapshot());
});

test('Out-of-range mains voltage produces the corresponding physical line fault', () => {
  for (const [supplyV, fault] of [[0, 'USF'], [350, 'OSF']]) {
    const drive = driveInMode('ac');
    drive.setInputs({ supplyV });
    drive.advance(0.3);
    assert.equal(drive.state.fault, fault);
    assertFinite(drive.snapshot());
    assert.equal(drive.state.outputMode, 'off');
  }
});

test('Running nameplate/circuit changes reject atomically while bench mechanical inputs remain adjustable', () => {
  const drive = driveInMode('ac');
  const original = drive.config;
  const before = drive.snapshot();
  const changes = [
    c => c.motor.voltage = 240,
    c => c.motor.inertia *= 2,
    c => {
      const parameters = circuitParameters(estimateMotorCircuit(c.motor).circuit);
      parameters.Rs *= 1.1;
      c.motorElectrical = { mode: 'manual', parameters };
    },
  ];
  for (const update of changes) {
    const candidate = structuredClone(original);
    update(candidate);
    assert.throws(() => drive.setConfig(candidate), RangeError);
    assert.strictEqual(drive.config, original);
    assert.deepEqual(drive.snapshot(), before);
  }
  changeConfiguration(drive, c => c.mechanical.inertia = 0.1);
  assert.equal(drive.config.mechanical.inertia, 0.1);
});

test('An inactive output with a moving rotor still rejects motor reconfiguration', () => {
  const drive = driveInMode('coasting');
  assert(Math.abs(drive.state.omega) > 1);
  const before = drive.snapshot();
  const original = drive.config;
  const candidate = structuredClone(original);
  candidate.motor.voltage = 240;
  assert.throws(() => drive.setConfig(candidate), RangeError);
  assert.strictEqual(drive.config, original);
  assert.deepEqual(drive.snapshot(), before);
});

test('Stopped legacy configuration imports estimate their circuit and can update the motor', () => {
  const legacy = configuration();
  delete legacy.motorElectrical;
  legacy.motor.voltage = 240;
  const parsed = parseConfiguration(JSON.stringify(legacy));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value.motorElectrical, { mode: 'estimated' });
  const drive = new VFDDrive(configuration());
  drive.setConfig(parsed.value);
  assert.equal(drive.config.motor.voltage, 240);
  assert.deepEqual(drive.config.motorElectrical, { mode: 'estimated' });
  assert.equal(drive.state.omega, 0);
  assert.equal(drive.state.outputMode, 'off');
  drive.advance(0.3);
  assertFinite(drive.snapshot());
});
