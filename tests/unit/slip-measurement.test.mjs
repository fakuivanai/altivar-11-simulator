import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VFDDrive, CONTROL_MODEL } from '../../engine.ts';
import { initialConfig } from '../../configuration.ts';

test('Slip compensation filters its estimate while retaining physical bus torque ripple', () => {
  const config = initialConfig();
  config.inputs.analogPosition = 100;
  config.parameters['FUn.tOL'] = config.parameters['FUn.tUL'] = 0;
  const drive = new VFDDrive(config);
  drive.advance(.3);
  drive.setInputs({ LI1: true });
  drive.advance(6);
  assert(drive.state.rpm > 1400 && drive.state.fault === null);
  const loaded = structuredClone(drive.config);
  loaded.mechanical.torque = 2.1;
  drive.setConfig(loaded);
  drive.advance(6);
  const torque = [];
  for (let sample = 0; sample < 200; sample++) {
    drive.advance(.005);
    assert.equal(drive.state.fault, null);
    assert.equal(drive.state.currentLimited, false);
    assert.equal(drive.state.referenceReached, true, '100 Hz torque ripple must not chatter the reached output');
    torque.push(drive.state.torque);
  }
  assert.equal(CONTROL_MODEL.torqueMeasurementSeconds, .02);
  assert(Math.max(...torque) - Math.min(...torque) > .05,
    'The drive estimate filter must not erase the physical torque ripple');
});
