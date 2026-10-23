import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VFDDrive } from '../../engine.ts';
import { initialConfig } from '../../configuration.ts';
function driveInMode(mode) {
  const config = initialConfig();
  if (mode === 'dc') config.parameters['FUn.AdC.ACt'] = 'Ct';
  const drive = new VFDDrive(config);
  if (mode === 'ac') drive.setInputs({
    LI1: true
  });
  if (mode !== 'off') drive.advance(.4);
  return drive;
}
test('Configuration is deeply frozen and keeps its identity between updates', () => {
  const drive = new VFDDrive(initialConfig());
  const installed = drive.config;
  const levels = [installed, installed.parameters, installed.motor, installed.mechanical, installed.inputs, installed.inputs.outputConnections];
  for (const level of levels) assert.equal(Object.isFrozen(level), true);
  drive.snapshot();
  assert.strictEqual(drive.config, installed);
  drive.advance(.1);
  assert.strictEqual(drive.config, installed);
});
test('Nested public configuration mutations are rejected without changing physical state', () => {
  const drive = driveInMode('ac');
  const before = drive.snapshot();
  const attempts = [() => {
    drive.config.parameters.ACC = 20;
  }, () => {
    drive.config.motor.current = 20;
  }, () => {
    drive.config.mechanical.torque = 20;
  }, () => {
    drive.config.inputs.powered = false;
  }, () => {
    drive.config.inputs.outputConnections.U = false;
  }, () => {
    drive.config = initialConfig();
  }];
  for (const attempt of attempts) assert.throws(attempt, TypeError);
  assert.deepEqual(drive.snapshot(), before);
});
test('Constructor and setConfig copy foreign values and preserve earlier frozen versions', () => {
  const original = initialConfig();
  const drive = new VFDDrive(original);
  original.motor.current = 10;
  original.parameters.ACC = 20;
  original.inputs.outputConnections.U = false;
  assert.equal(drive.config.motor.current, 2.1);
  assert.equal(drive.config.parameters.ACC, 3);
  assert.equal(drive.config.inputs.outputConnections.U, true);
  const previous = drive.config;
  const next = structuredClone(previous);
  next.parameters.ACC = 4;
  next.motor.current = 2.4;
  next.inputs.outputConnections.V = false;
  drive.setConfig(next);
  assert.notStrictEqual(drive.config, previous);
  assert.equal(drive.config.parameters.ACC, 4);
  assert.equal(drive.config.motor.current, 2.4);
  assert.equal(drive.config.inputs.outputConnections.V, false);
  assert.equal(previous.parameters.ACC, 3);
  assert.equal(previous.motor.current, 2.1);
  assert.equal(previous.inputs.outputConnections.V, true);
  next.parameters.ACC = 30;
  next.motor.current = 15;
  next.inputs.outputConnections.V = true;
  assert.equal(drive.config.parameters.ACC, 4);
  assert.equal(drive.config.motor.current, 2.4);
  assert.equal(drive.config.inputs.outputConnections.V, false);
});
test('setInputs replaces its frozen version and copies the supplied connection record', () => {
  const drive = new VFDDrive(initialConfig());
  const previous = drive.config;
  const connections = {
    U: false,
    V: true,
    W: true
  };
  drive.setInputs({
    LI1: true,
    outputConnections: connections
  });
  const installed = drive.config;
  assert.notStrictEqual(installed, previous);
  assert.equal(installed.inputs.LI1, true);
  assert.deepEqual(installed.inputs.outputConnections, {
    U: false,
    V: true,
    W: true
  });
  assert.equal(Object.isFrozen(installed.inputs.outputConnections), true);
  assert.equal(previous.inputs.LI1, false);
  assert.equal(previous.inputs.outputConnections.U, true);
  connections.V = false;
  assert.equal(drive.config.inputs.outputConnections.V, true);
  drive.advance(.1);
  assert.strictEqual(drive.config, installed);
});
for (const mode of ['off', 'ac', 'dc']) {
  test(`${mode} electrical output snapshots cannot mutate later model snapshots`, () => {
    const drive = driveInMode(mode);
    const exposed = drive.snapshot();
    const expected = structuredClone(exposed);
    assert.equal(exposed.output.mode, mode);
    assert.equal(exposed.outputMode, exposed.output.mode);
    exposed.output.connected.U = false;
    if (mode !== 'off') {
      exposed.output.current.U = 100;
      exposed.output.voltage = 10000;
    }
    if (mode === 'ac') {
      assert.equal(typeof exposed.output.frequency, 'number');
      assert.equal(typeof exposed.output.currentLag, 'number');
      assert.equal('topology' in exposed.output, false);
      exposed.output.frequency = -1000;
      exposed.output.currentLag = 20;
    } else if (mode === 'dc') {
      assert.equal('frequency' in exposed.output, false);
      assert.equal('currentLag' in exposed.output, false);
      assert.deepEqual(exposed.output.topology, {
        source: 'U',
        returns: ['V', 'W']
      });
      exposed.output.topology.source = 'W';
      exposed.output.topology.returns.pop();
    } else {
      assert.equal('current' in exposed.output, false);
      assert.equal('voltage' in exposed.output, false);
      assert.equal('frequency' in exposed.output, false);
      assert.equal('currentLag' in exposed.output, false);
    }
    exposed.output.mode = mode === 'off' ? 'ac' : 'off';
    assert.deepEqual(drive.snapshot(), expected);
  });
}
test('DC injection topology follows the connected pair without sharing mutable arrays', () => {
  const drive = driveInMode('dc');
  drive.setInputs({
    outputConnections: {
      U: false,
      V: true,
      W: true
    }
  });
  drive.advance(.005);
  const output = drive.snapshot().output;
  assert.equal(output.mode, 'dc');
  assert.deepEqual(output.topology, {
    source: 'V',
    returns: ['W']
  });
  assert.equal(output.current.U, 0);
  assert.equal(output.current.V, output.current.W);
  output.topology.returns.push('U');
  assert.deepEqual(drive.snapshot().output.topology, {
    source: 'V',
    returns: ['W']
  });
});
