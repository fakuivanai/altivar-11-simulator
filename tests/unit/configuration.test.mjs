import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as cfg from '../../configuration.ts';
const copy = value => JSON.parse(JSON.stringify(value));
function rejected(mutator) {
  const previous = cfg.initialConfig();
  const before = JSON.stringify(previous);
  const candidate = copy(previous);
  mutator(candidate);
  const result = cfg.parseConfiguration(JSON.stringify(candidate));
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, 'string');
  assert.equal(JSON.stringify(previous), before, 'A failed candidate must not change existing state.');
}
test('The reviewed catalog retains 74 drive fields and 8 read-only monitors', () => {
  assert.equal(cfg.CATALOG.filter(item => !item.readonly).length, 74);
  assert.equal(cfg.CATALOG.filter(item => item.readonly).length, 8);
  assert.deepEqual(cfg.PARAMETER_IDS.slice().sort(), Object.keys(cfg.defaults()).sort());
});
test('Complete round trip retains hidden values, inputs and internal backup', () => {
  const initial = cfg.initialConfig();
  initial.parameters['FUn.LC2.CL2'] = 1.45;
  initial.parameters['AIt.CrL'] = 2.5;
  initial.inputs.LI4 = true;
  initial.inputs.analogPosition = 27.5;
  initial.inputs.outputConnections.V = false;
  initial.inputs.shaftHeld = true;
  initial.inputModes.LI3 = 'button';
  initial.driveMemory.backupParameters.ACC = 12.4;
  const result = cfg.parseConfiguration(JSON.stringify(initial));
  assert(result.ok);
  assert.deepEqual(result.value, initial);
  assert.equal(result.value.parameters['FUn.LC2.LI'], 'nO');
  assert.equal(result.value.parameters['AIt.ACt'], '5U');
});
test('Malformed JSON and oversized input are errors as values', () => {
  assert.equal(cfg.parseConfiguration('{').ok, false);
  assert.equal(cfg.parseConfiguration(' '.repeat(262145)).ok, false);
  assert.equal(cfg.parseConfiguration('null').ok, false);
  assert.equal(cfg.parseConfiguration('[]').ok, false);
});
test('Identifiers, complete fields and monitor separation reject incompatible imports', () => {
  rejected(c => {
    c.version = 2;
  });
  rejected(c => {
    c.model = 'ATV11HU09M2A';
  });
  rejected(c => {
    delete c.parameters['FUn.HSP.HS4'];
  });
  rejected(c => {
    c.parameters['SUP.FrH'] = 10;
  });
  rejected(c => {
    c.unexpected = true;
  });
});
test('Numbers and switch states are never coerced', () => {
  rejected(c => {
    c.parameters['drC.nCr'] = '2.1';
  });
  rejected(c => {
    c.inputs.LI1 = 'false';
  });
  rejected(c => {
    c.parameters.ACC = 3.05;
  });
  rejected(c => {
    c.inputs.analogPosition = 101;
  });
  rejected(c => {
    c.parameters['FUn.LC2.CL2'] = 4;
  });
});
test('Physical inputs require exactly three phase switches and a shaft state', () => {
  const initial = cfg.initialConfig();
  assert.deepEqual(initial.inputs.outputConnections, {
    U: true,
    V: true,
    W: true
  });
  assert.equal(initial.inputs.shaftHeld, false);
  assert.equal(Object.hasOwn(initial.inputs, 'motorConnected'), false);
  rejected(c => {
    c.inputs.motorConnected = true;
  });
  rejected(c => {
    delete c.inputs.outputConnections;
  });
  rejected(c => {
    c.inputs.outputConnections = null;
  });
  rejected(c => {
    c.inputs.outputConnections = [true, true, true];
  });
  rejected(c => {
    delete c.inputs.outputConnections.U;
  });
  rejected(c => {
    c.inputs.outputConnections.N = true;
  });
  rejected(c => {
    c.inputs.outputConnections.W = 'false';
  });
  rejected(c => {
    c.inputs.shaftHeld = 1;
  });
  const disconnected = cfg.initialConfig();
  disconnected.inputs.outputConnections = {
    U: false,
    V: false,
    W: false
  };
  assert(cfg.validateConfig(disconnected).ok, 'A disconnected motor is a valid physical scenario.');
});
test('Hidden dependent values must remain consistent', () => {
  rejected(c => {
    c.parameters['AIt.CrL'] = c.parameters['AIt.CrH'];
  });
  rejected(c => {
    c.parameters.HSP = 40;
  });
  rejected(c => {
    c.parameters.LSP = 10;
    c.parameters['FUn.HSP.HS4'] = 5;
  });
  rejected(c => {
    c.parameters['FUn.HSP.LIb'] = 'LI4';
  });
  rejected(c => {
    c.parameters['FUn.PI.Pr4'] = 'LI4';
  });
});
test('PI assignments and monitoring construct one valid composite state', () => {
  rejected(c => {
    c.parameters['FUn.PI.PIF'] = 'AI1';
  });
  rejected(c => {
    c.driveMemory.monitor = 'rPF';
  });
  const c = cfg.initialConfig();
  c.parameters['FUn.PI.PIF'] = 'AI1';
  c.parameters['FUn.rrS'] = 'nO';
  c.parameters['FUn.PS2.LIA'] = 'LI1';
  c.driveMemory.monitor = 'rPF';
  const result = cfg.validateConfig(c);
  assert(result.ok);
  assert.equal(cfg.visible('SUP.rPF', result.value.parameters), true);
  assert.equal(cfg.visible('FUn.PI.Pr4', result.value.parameters), false);
});
test('Automatic restart, flying restart and switching frequency dependencies are enforced', () => {
  rejected(c => {
    c.parameters['FUn.Atr'] = 'YES';
  });
  rejected(c => {
    c.parameters['FUn.FLr'] = 'YES';
  });
  rejected(c => {
    c.parameters['FUn.SFt.ACt'] = 'HF';
  });
  rejected(c => {
    c.parameters['FUn.tCC.tCt'] = 'LEL';
    c.parameters['FUn.FLr'] = 'YES';
    c.parameters['FUn.AdC.ACt'] = 'Ct';
  });
  const c = cfg.initialConfig();
  c.parameters['FUn.tCC.tCt'] = 'PFO';
  c.parameters['FUn.Atr'] = 'YES';
  c.parameters['FUn.FLr'] = 'YES';
  c.parameters['FUn.SFt.ACt'] = 'HF';
  c.parameters['FUn.SFt.SFr'] = 12;
  assert(cfg.validateConfig(c).ok);
});
test('Actual motor physics, input modes and backup configuration are validated', () => {
  rejected(c => {
    c.motor.speedRPM = 1500;
  });
  rejected(c => {
    c.motor.poles = 3;
  });
  rejected(c => {
    c.mechanical.inertia = -1;
  });
  rejected(c => {
    c.inputModes.LI1 = 'toggle';
  });
  rejected(c => {
    c.driveMemory.backupParameters['SUP.COd'] = 1;
  });
  rejected(c => {
    c.driveMemory.backupParameters['FUn.SCS'] = 'YES';
  });
});
test('A validated result does not alias the caller or another initial configuration', () => {
  const candidate = cfg.initialConfig();
  const result = cfg.validateConfig(candidate);
  assert(result.ok);
  candidate.motor.current = 8;
  candidate.parameters.ACC = 99;
  candidate.driveMemory.backupParameters.ACC = 88;
  candidate.inputs.outputConnections.U = false;
  assert.equal(result.value.motor.current, 2.1);
  assert.equal(result.value.parameters.ACC, 3);
  assert.equal(result.value.driveMemory.backupParameters.ACC, 3);
  assert.equal(result.value.inputs.outputConnections.U, true);
  result.value.inputs.outputConnections.V = false;
  assert.equal(candidate.inputs.outputConnections.V, true);
  assert.deepEqual(cfg.initialConfig().inputs.outputConnections, {
    U: true,
    V: true,
    W: true
  });
  assert.equal(cfg.initialConfig().parameters.ACC, 3);
});
test('Configuration actions cannot remain pending in an imported file', () => {
  rejected(c => {
    c.parameters['FUn.SCS'] = 'YES';
  });
  rejected(c => {
    c.parameters['FUn.FCS'] = 'InI';
  });
  rejected(c => {
    c.parameters['SUP.COd'] = 1;
  });
  const c = cfg.initialConfig();
  c.parameters['SUP.COd'] = 999;
  assert(cfg.parseConfiguration(JSON.stringify(c)).ok);
});
