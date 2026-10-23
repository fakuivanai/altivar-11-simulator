import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VFDDrive } from '../../engine.ts';
import { initialConfig } from '../../configuration.ts';

function config() {
  const c = initialConfig();
  c.inputs.analogPosition = 100;
  c.mechanical.torque = .8; // The revised nameplate estimate can start this load with factory UFr.
  // These regressions isolate frequency control from optional load alarms.
  c.parameters['FUn.tOL'] = c.parameters['FUn.tUL'] = 0;
  return c;
}
function started(c, direction = 1) {
  const drive = new VFDDrive(c);
  drive.advance(.3); // Retain factory standby DC injection/its initial flux.
  drive.setInputs(direction > 0 ? { LI1: true } : { LI2: true });
  drive.advance(6);
  return drive;
}

for (const direction of [1, -1]) {
  test(`Adapted stop completes from sequence ${direction} without a motoring frequency-filter tail`, () => {
    const drive = started(config(), direction);
    assert.ok(Math.abs(drive.state.rpm) > 1400);
    drive.setInputs({ LI1: false, LI2: false });
    let injected = false;
    for (let n = 0; n < 1000; n++) {
      drive.advance(.005);
      injected ||= drive.state.outputMode === 'dc';
    }
    assert.ok(Math.abs(drive.state.rpm) < 1);
    assert.equal(drive.state.fault, null);
    assert.equal(drive.state.running, false);
    assert.ok(injected, 'The completed AC ramp must permit the configured DC injection interval');
  });

  test(`Active brA demand tracks the rotor-following limit directly for sequence ${direction}`, () => {
    const c = config(); c.mechanical.torque = c.mechanical.friction = 0;
    c.mechanical.inertia = .02;
    c.parameters.dEC = .1;
    c.parameters['FUn.AdC.ACt'] = 'nO';
    const drive = started(c, direction);
    drive.setInputs({ LI1: false, LI2: false });
    let adapted = 0;
    const nominalSlip = c.motor.frequency - c.motor.speedRPM * c.motor.poles / 120;
    for (let n = 0; n < 50; n++) {
      const before = drive.state;
      const demand = direction * Math.max(0, Math.abs(before.rampFrequency) - c.parameters['drC.FrS'] / c.parameters.dEC * .005);
      const rotorHz = before.omega * c.motor.poles / (4 * Math.PI);
      const limit = rotorHz - direction * nominalSlip * .1 * Math.max(0, Math.min(1, (350 - before.dcBus) / 30));
      drive.advance(.005);
      if (before.running && rotorHz * demand >= 0 && Math.abs(rotorHz) > Math.abs(demand)) {
        const expected = direction > 0 ? Math.max(demand, limit) : Math.min(demand, limit);
        assert.ok(Math.abs(drive.state.frequency - expected) < 1e-9,
          'A second frequency-filter lag must not turn the active braking demand into positive slip');
        adapted++;
      }
      assert.equal(drive.state.fault, null);
    }
    assert.ok(adapted > 10, 'The fixture must actually exercise active braking adaptation');
  });
}

test('Current-limited frequency foldback recovers the original passive load after shaft release', () => {
  const c = config();
  c.mechanical.torque = 1.2;
  // The heavier release fixture needs full configured IR boost to supply its starting torque.
  c.parameters['drC.UFr'] = 100;
  const drive = started(c), before = drive.state;
  drive.setInputs({ shaftHeld: true });
  drive.advance(2.105);
  const held = drive.state;
  assert.equal(held.rpm, 0);
  assert.ok(held.currentLimited);
  assert.ok(held.frequency < .8 * before.frequency,
    'Freezing the old full-frequency demand leaves insufficient physical starting torque at CLI');
  drive.setInputs({ shaftHeld: false });
  drive.advance(8);
  assert.ok(drive.state.rpm > 1400);
  assert.equal(drive.state.currentLimited, false);
  assert.equal(drive.state.fault, null);
  assert.equal(drive.state.shaftReactionTorque, 0);
});

for (const phase of ['U', 'V', 'W']) {
  test(`Factory standby flux and open ${phase} recover after balanced reconnection`, () => {
    const c = config(); c.inputs.outputConnections[phase] = false;
    const drive = new VFDDrive(c);
    drive.advance(.3);
    drive.setInputs({ LI1: true });
    let limited = false;
    for (let n = 0; n < 1200; n++) {
      drive.advance(.005);
      limited ||= drive.state.currentLimited;
    }
    assert.equal(drive.state.rpm, 0);
    // Frequency foldback can remove the active voltage attenuation before reconnection.
    assert.ok(limited, 'The open-phase fixture must actually engage the physical current limiter');
    drive.setInputs({ outputConnections: { U: true, V: true, W: true } });
    drive.advance(8);
    assert.ok(drive.state.rpm > 1400);
    assert.equal(drive.state.currentLimited, false);
    assert.equal(drive.state.fault, null);
  });
}
