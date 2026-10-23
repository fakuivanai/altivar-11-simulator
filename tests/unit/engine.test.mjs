import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VFDDrive as Engine } from '../../engine.ts';
import CATALOG from '../../catalog-final.json' with { type: 'json' };
const clone = x => JSON.parse(JSON.stringify(x));
function config() {
  return {
    parameters: Object.fromEntries(CATALOG.filter(x => !x.readonly).map(x => [x.id, x.default])),
    motor: {
      powerKW: .37,
      voltage: 230,
      frequency: 50,
      current: 2.1,
      speedRPM: 1420,
      poles: 4,
      cosPhi: .8,
      inertia: .002
    },
    mechanical: {
      torque: 1.2,
      friction: .002,
      inertia: .008
    },
    inputs: {
      powered: true,
      supplyV: 230,
      LI1: false,
      LI2: false,
      LI3: false,
      LI4: false,
      analogType: '5V',
      analogPosition: 100,
      outputConnections: {
        U: true,
        V: true,
        W: true
      },
      shaftHeld: false,
      shortCircuit: false,
      brakeModule: false,
      ambient: 25,
      ventilation: 1
    }
  };
}
function setup(mutator = () => {}) {
  const c = config();
  mutator(c);
  return new Engine(c);
}
function start(e, time = 6) {
  e.setInputs({
    LI1: true
  });
  e.advance(time);
  return e.state;
}
function finiteState(e) {
  for (const [k, v] of Object.entries(e.state)) if (typeof v === 'number') assert(Number.isFinite(v), k + ' must remain finite');
}
test('Factory run, forward/reverse and read-only monitors', () => {
  const e = setup();
  start(e);
  assert(e.state.rpm > 1400);
  assert.equal(e.state.fault, null);
  assert(e.state.current > 1.26);
  const monitor = e.monitors();
  assert(monitor.rFr > 50);
  assert.equal(monitor.LCr, e.state.LCr);
  e.setInputs({
    LI1: false
  });
  e.advance(5);
  assert(Math.abs(e.state.rpm) < 1);
  e.setInputs({
    LI2: true
  });
  e.advance(6);
  assert(e.state.rpm < -1400);
});
test('Fixed step is independent of render cadence', () => {
  const a = setup(),
    b = setup();
  a.setInputs({
    LI1: true
  });
  b.setInputs({
    LI1: true
  });
  a.advance(10);
  for (let j = 0; j < 300; j++) b.advance(1 / 30);
  assert.deepEqual(a.snapshot(), b.snapshot());
});
test('Safe reset inhibits already asserted commands even with Atr', () => {
  const e = setup(c => {
    c.inputs.LI1 = true;
    c.parameters['FUn.Atr'] = 'YES';
    c.parameters['FUn.tCC.tCt'] = 'LEL';
  });
  e.advance(5);
  assert.equal(e.state.rpm, 0);
  assert.equal(e.state.running, false);
  e.setInputs({
    LI1: false
  });
  e.advance(.01);
  e.setInputs({
    LI1: true
  });
  e.advance(6);
  assert(e.state.rpm > 1400);
});
test('Two-wire priority and 3-wire latch/stop', () => {
  const e = setup(c => c.parameters['FUn.tCC.tCt'] = 'PFO');
  e.setInputs({
    LI1: true,
    LI2: true
  });
  e.advance(6);
  assert(e.state.rpm > 0);
  const f = setup(c => {
    c.parameters['FUn.tCC.ACt'] = '3C';
    c.parameters['FUn.rrS'] = 'LI3';
    c.parameters['FUn.PS2.LIA'] = 'LI4';
    c.parameters['FUn.PS2.LIb'] = 'nO';
  });
  f.setInputs({
    LI1: true,
    LI2: true
  });
  f.advance(.1);
  f.setInputs({
    LI2: false
  });
  f.advance(6);
  assert(f.state.rpm > 1400);
  f.setInputs({
    LI1: false
  });
  f.advance(5);
  assert(Math.abs(f.state.rpm) < 1);
});
test('Preset speeds and selected high speeds override analog reference', () => {
  const e = setup(c => c.parameters['FUn.tUL'] = 0);
  e.setInputs({
    LI1: true,
    LI3: true
  });
  e.advance(6);
  assert.equal(e.state.reference, 10);
  e.setInputs({
    LI3: false,
    LI4: true
  });
  e.advance(4);
  assert.equal(e.state.reference, 25);
  e.setInputs({
    LI3: true
  });
  e.advance(4);
  assert.equal(e.state.reference, 50);
  const f = setup(c => {
    c.parameters['FUn.HSP.LIA'] = 'LI3';
    c.parameters['FUn.HSP.HS2'] = 80;
    c.parameters['FUn.PS2.LIA'] = 'nO';
    c.parameters['FUn.PS2.LIb'] = 'nO';
  });
  f.setInputs({
    LI1: true,
    LI3: true
  });
  f.advance(.01);
  assert.equal(f.state.activeHighSpeed, 80);
  assert.equal(f.state.reference, 80);
});
test('Analog voltage/current/custom scales', () => {
  const e = setup(c => {
    c.parameters['AIt.ACt'] = '10U';
    c.inputs.analogPosition = 50;
  });
  assert.equal(e.analog().normalized, .25);
  e.setInputs({
    analogType: '10V'
  });
  assert.equal(e.analog().normalized, .5);
  const f = setup(c => {
    c.parameters['AIt.ACt'] = '4A';
    c.inputs.analogType = '20mA';
    c.inputs.analogPosition = 60;
  });
  assert.equal(f.analog().normalized, .5);
  const g = setup(c => {
    c.parameters['AIt.ACt'] = 'CUS';
    c.parameters['AIt.CrL'] = 2;
    c.parameters['AIt.CrH'] = 18;
    c.inputs.analogType = '20mA';
    c.inputs.analogPosition = 50;
  });
  assert.equal(g.analog().normalized, .5);
});
test('Ramp selection and current limit selection change operation', () => {
  const a = setup(),
    b = setup(c => c.parameters.ACC = 10);
  start(a, 2);
  start(b, 2);
  assert(a.state.rpm > b.state.rpm * 2);
  const c = setup(c => {
    c.parameters['FUn.rP2.LI'] = 'LI3';
    c.parameters['FUn.rP2.AC2'] = 12;
    c.parameters['FUn.PS2.LIA'] = 'nO';
    c.parameters['FUn.PS2.LIb'] = 'nO';
    c.inputs.LI3 = true;
  });
  start(c, 2);
  assert(c.state.rpm < b.state.rpm);
  const d = setup(c => {
    c.parameters['FUn.LC2.LI'] = 'LI3';
    c.parameters['FUn.LC2.CL2'] = 1.05;
    c.inputs.LI3 = true;
    c.parameters['FUn.PS2.LIA'] = 'nO';
    c.parameters['FUn.PS2.LIb'] = 'nO';
  });
  start(d, 4);
  assert(d.state.currentLimited);
  assert(d.state.rpm < a.state.rpm / 2);
  assert(Math.abs(d.state.current - 1.05) < .01);
});
test('Actual motor is separate from programmed motor current and voltage', () => {
  const a = setup(),
    b = setup(c => c.parameters['drC.nCr'] = .7);
  start(a);
  start(b);
  assert.equal(b.config.motor.current, 2.1);
  assert(Math.abs(a.state.rpm - b.state.rpm) > 20);
  const d = setup(c => c.parameters['drC.UnS'] = 100);
  start(d);
  assert.equal(d.config.motor.voltage, 230);
  assert(d.state.rpm < a.state.rpm / 2);
});
test('Attached inertia, friction and mechanical load affect current/speed', () => {
  const a = setup(),
    b = setup(c => c.mechanical.inertia = .2);
  start(a, 3);
  start(b, 3);
  assert(b.state.rpm < a.state.rpm / 2);
  assert(b.state.current > a.state.current);
  const f = setup(c => {
    c.mechanical.friction = .006;
    c.parameters['FUn.tOL'] = 0;
  });
  start(f);
  const l = setup(c => {
    c.mechanical.torque = 2.2;
    c.parameters['FUn.tOL'] = 0;
  });
  start(l);
  const nominal = setup();
  start(nominal);
  assert(f.state.current > nominal.state.current);
  assert(l.state.current > nominal.state.current);
});
test('Current overload/underload timers, hysteresis and reset', () => {
  const a = setup(c => c.mechanical.torque = 2.3);
  start(a, 12);
  assert.equal(a.state.fault, 'OLC');
  updateConfig(a, candidate => candidate.mechanical.torque = 1.2);
  assert(a.resetFault());
  a.setInputs({
    LI1: false
  });
  a.advance(.01);
  start(a);
  assert.equal(a.state.fault, null);
  const u = setup(c => c.mechanical.torque = .1);
  start(u, 12);
  assert.equal(u.state.fault, 'ULF');
  const d = setup(c => {
    c.mechanical.torque = .1;
    c.parameters['FUn.tUL'] = 0;
  });
  start(d, 12);
  assert.equal(d.state.fault, null);
});
test('I-squared thermal overload needs cooling before reset', () => {
  const e = setup(c => {
    c.mechanical.torque = 3;
    c.parameters['FUn.tOL'] = 0;
    c.parameters['FUn.tUL'] = 0;
  });
  e.setInputs({
    LI1: true
  });
  while (!e.state.fault && e.state.time < 80) e.advance(.005);
  assert.equal(e.state.fault, 'OLF');
  assert(!e.resetFault());
  updateConfig(e, candidate => candidate.mechanical.torque = 1.2);
  e.advance(30);
  assert(e.state.motorThermal < 100);
  assert(e.resetFault());
  assert.equal(e.state.fault, null);
});
test('Short circuit requires power cycle, fault relay opens', () => {
  const e = setup(c => c.inputs.shortCircuit = true);
  start(e, .1);
  assert.equal(e.state.fault, 'SCF');
  assert.equal(e.state.relay, false);
  e.setInputs({
    shortCircuit: false
  });
  assert.equal(e.resetFault(), false);
  e.setInputs({
    powered: false,
    LI1: false
  });
  e.advance(.5);
  e.setInputs({
    powered: true
  });
  e.advance(.05);
  assert.equal(e.state.fault, null);
  assert(e.state.relay);
});
test('Line faults and low voltage automatic clearing', () => {
  const e = setup(c => c.inputs.supplyV = 300);
  e.advance(.05);
  assert.equal(e.state.fault, 'OSF');
  e.setInputs({
    supplyV: 230
  });
  assert(e.resetFault());
  const u = setup(c => c.inputs.supplyV = 150);
  u.advance(.05);
  assert.equal(u.state.fault, 'USF');
  u.setInputs({
    supplyV: 230
  });
  u.advance(.05);
  assert.equal(u.state.fault, null);
});
// Isolate AC regeneration; DC injection dissipates in the motor.
test('Braking bus overvoltage versus adaptation/brake module', () => {
  function brake(adapt, module) {
    const e = setup(c => {
      c.mechanical.inertia = .05;
      c.parameters.dEC = .2;
      c.parameters['FUn.AdC.ACt'] = 'nO';
      c.parameters['FUn.brA'] = adapt;
      c.inputs.brakeModule = module;
    });
    start(e, 8);
    e.setInputs({
      LI1: false
    });
    e.advance(2);
    return e;
  }
  assert.equal(brake('nO', false).state.fault, 'ObF');
  assert.equal(brake('YES', false).state.fault, null);
  assert.equal(brake('nO', true).state.fault, null);
});
test('Freewheel stop and catch-on-fly resume a moving motor', () => {
  const e = setup(c => {
    c.parameters['FUn.nSt'] = 'LI4';
    c.parameters['FUn.tCC.tCt'] = 'LEL';
    c.parameters['FUn.FLr'] = 'YES';
    c.parameters['FUn.PS2.LIb'] = 'nO';
    c.inputs.LI4 = true;
    c.mechanical.inertia = .1;
  });
  start(e, 12);
  assert(e.state.rpm > 1000);
  e.setInputs({
    LI4: false
  });
  e.advance(.1);
  assert.equal(e.state.status, 'nSt');
  assert(e.state.rpm > 1000);
  e.setInputs({
    LI4: true
  });
  e.advance(.01);
  assert(e.state.rampFrequency > 30);
  assert(e.state.running);
});
test('PI references, binary order, inversion, scale and manual transfer', () => {
  const e = setup(c => {
    c.parameters['FUn.PI.PIF'] = 'AI1';
    c.parameters['FUn.rrS'] = 'nO';
    c.parameters['FUn.PS2.LIA'] = 'LI1';
    c.parameters['FUn.PI.rPI'] = 80;
    c.inputs.analogPosition = 20;
    c.parameters['FUn.PI.rIG'] = 0;
    c.parameters['FUn.PI.Pr2'] = 'LI3';
    c.parameters['FUn.PI.Pr4'] = 'LI4';
  });
  e.setInputs({
    LI1: true
  });
  e.advance(.01);
  assert.equal(e.state.piReference, 80);
  assert.equal(e.state.reference, 30);
  e.setInputs({
    LI3: true,
    LI4: true
  });
  e.advance(.01);
  assert.equal(e.state.piReference, 60);
  e.setInputs({
    LI3: false
  });
  e.advance(.01);
  assert.equal(e.state.piReference, 90);
  const c = clone(e.config);
  c.parameters['FUn.PI.PIC'] = 'YES';
  e.setConfig(c);
  e.advance(.01);
  assert.equal(e.state.reference, 0);
  c.parameters['FUn.PI.PAU'] = 'LI2';
  e.setConfig(c);
  e.advance(.01);
  assert.equal(e.state.reference, 50);
  assert.equal(e.state.piActive, false);
});
test('DO threshold and analog assignments plus DC injection', () => {
  const e = setup(c => c.parameters['FUn.dO.ACt'] = 'FtA');
  start(e);
  assert.equal(e.state.DOType, 'logic');
  assert.equal(e.state.DO, 1);
  const c = clone(e.config);
  c.parameters['FUn.dO.ACt'] = 'OCr';
  e.setConfig(c);
  e.advance(.01);
  assert(Math.abs(e.state.DO - e.state.current / 4.2) < 1e-8);
  e.setInputs({
    LI1: false
  });
  let seen = false;
  for (let n = 0; n < 1400; n++) {
    e.advance(.005);
    if (e.state.status === 'dcb') seen = true;
  }
  assert(seen);
});
test('Automatic restart holds relay and restarts after load is corrected', () => {
  const e = setup(c => {
    c.parameters['FUn.tCC.tCt'] = 'LEL';
    c.parameters['FUn.Atr'] = 'YES';
    c.mechanical.torque = 2.3;
  });
  start(e, 12);
  assert.equal(e.state.fault, 'OLC');
  assert(e.state.relay);
  updateConfig(e, candidate => candidate.mechanical.torque = 1.2);
  e.advance(10);
  assert.equal(e.state.fault, null);
  assert(e.state.rpm > 1000);
});
test('Small inertia and extreme allowed loads remain finite', () => {
  for (const inertia of [.0001, .002, 1]) {
    const e = setup(c => {
      c.motor.inertia = inertia;
      c.mechanical.inertia = 0;
      c.mechanical.torque = 0;
      c.mechanical.friction = 0;
      c.parameters['FUn.tUL'] = 0;
    });
    start(e, 20);
    finiteState(e);
    assert(Math.abs(e.state.rpm) < 5000);
  }
  const e = setup(c => {
    c.mechanical.torque = -20;
    c.mechanical.inertia = .001;
    c.parameters['FUn.tOL'] = 0;
    c.parameters['FUn.tUL'] = 0;
  });
  start(e, 30);
  finiteState(e);
  assert.equal(e.state.fault, 'SOF');
});
test('Low-speed timeout begins after the ramp reaches LSP', () => {
  const e = setup(c => {
    c.parameters.LSP = 10;
    c.parameters.ACC = 20;
    c.parameters['FUn.tLS'] = 1;
    c.inputs.analogPosition = 0;
    c.parameters['FUn.tUL'] = 0;
  });
  start(e, 3);
  assert(e.state.running);
  assert(!e.lowSpeedSleeping);
  e.advance(6);
  assert(e.lowSpeedSleeping);
  e.setInputs({
    analogPosition: 100
  });
  e.advance(.01);
  assert(!e.lowSpeedSleeping);
  assert(e.state.running);
});
test('Load fault timers continue inside the hysteresis band', () => {
  const e = setup(c => c.mechanical.torque = 2.3);
  start(e, 7);
  assert.equal(e.state.fault, null);
  assert(e.overloadTime > 1);
  updateConfig(e, candidate => candidate.mechanical.torque = 1.7);
  e.advance(3);
  assert.equal(e.state.fault, 'OLC');
  const u = setup(c => c.mechanical.torque = .1);
  start(u, 7);
  assert.equal(u.state.fault, null);
  updateConfig(u, candidate => candidate.mechanical.torque = 1.2);
  u.advance(3);
  assert.equal(u.state.fault, 'ULF');
});
test('PI operational output is low when faulted or powered off', () => {
  const e = setup(c => {
    c.parameters['FUn.PI.PIF'] = 'AI1';
    c.parameters['FUn.rrS'] = 'nO';
    c.parameters['FUn.PS2.LIA'] = 'LI1';
    c.parameters['FUn.PI.rPI'] = 80;
    c.inputs.analogPosition = 20;
    c.parameters['FUn.dO.ACt'] = 'PI';
  });
  start(e, 1);
  assert.equal(e.state.DO, 1);
  e.setInputs({
    shortCircuit: true
  });
  e.advance(.01);
  assert.equal(e.state.fault, 'SCF');
  assert.equal(e.state.DO, 0);
  e.setInputs({
    powered: false
  });
  e.advance(.01);
  assert.equal(e.state.DO, 0);
});
test('Zero ramp time is an immediate demand without numerical instability', () => {
  const e = setup(c => {
    c.parameters.ACC = 0;
    c.parameters['FUn.tOL'] = 0;
    c.parameters['FUn.tUL'] = 0;
  });
  start(e, .005);
  assert.equal(e.state.rampFrequency, 50);
  e.advance(5);
  finiteState(e);
});
test('Control inhibit preserves moving rotor, heat and latched faults', () => {
  const e = setup();
  start(e, 6);
  e.setInputs({
    LI1: false
  });
  e.advance(.05);
  const before = e.snapshot();
  e.inhibitCommands();
  assert.equal(e.state.omega, before.omega);
  assert.equal(e.state.angle, before.angle);
  assert.equal(e.state.motorThermal, before.motorThermal);
  assert.equal(e.state.driveThermal, before.driveThermal);
  assert.equal(e.state.time, before.time);
  const f = setup(c => c.inputs.shortCircuit = true);
  start(f, .02);
  assert.equal(f.state.fault, 'SCF');
  f.inhibitCommands();
  assert.equal(f.state.fault, 'SCF');
  f.setConfig(clone(f.config), {
    resetControl: true
  });
  assert.equal(f.state.fault, 'SCF');
});
test('Regenerative overvoltage cannot reset while its bus cause remains', () => {
  const e = setup(c => {
    c.mechanical.inertia = .05;
    c.parameters.dEC = .2;
    c.parameters['FUn.AdC.ACt'] = 'nO';
    c.parameters['FUn.brA'] = 'nO';
  });
  start(e, 8);
  e.setInputs({
    LI1: false
  });
  while (!e.state.fault && e.state.time < 12) e.advance(.005);
  assert.equal(e.state.fault, 'ObF');
  assert(e.state.dcBus > 415);
  assert.equal(e.resetFault(), false);
  e.advance(.2);
  assert(e.state.dcBus <= 415);
  assert(e.resetFault());
});
test('Missing required parameters fail instead of acquiring defaults', () => {
  const c = config();
  delete c.parameters['FUn.rrS'];
  assert.throws(() => new Engine(c), /Missing required drive parameter: FUn.rrS/);
});
function rmsPhaseCurrent(s) {
  return Math.hypot(s.phaseCurrentU, s.phaseCurrentV, s.phaseCurrentW) / Math.sqrt(3);
}
test('Zero or one output wire has no closed motor circuit', () => {
  for (const wires of [{
    U: false,
    V: false,
    W: false
  }, {
    U: true,
    V: false,
    W: false
  }, {
    U: false,
    V: true,
    W: false
  }, {
    U: false,
    V: false,
    W: true
  }]) {
    const e = setup(c => {
      c.inputs.outputConnections = wires;
      c.parameters['FUn.tUL'] = 0;
    });
    start(e, 10);
    assert.equal(e.state.current, 0);
    assert.equal(e.state.torque, 0);
    assert.equal(e.state.rpm, 0);
    assert.equal(rmsPhaseCurrent(e.state), 0);
    assert.equal(e.state.fault, null);
    assert(e.state.voltage > 0, 'The enabled drive still energizes its output terminals');
  }
  const e = setup();
  start(e, 6);
  e.setInputs({
    outputConnections: {
      U: true,
      V: false,
      W: false
    }
  });
  e.advance(.005);
  assert.equal(e.state.current, 0);
  assert.equal(e.state.torque, 0);
  assert(e.state.rpm > 1000, 'The disconnected rotor coasts');
});
test('An open motor circuit coasts with only mechanical friction', () => {
  for (const wires of [{
    U: false,
    V: false,
    W: false
  }, {
    U: true,
    V: false,
    W: false
  }]) {
    const a = setup(c => {
      c.motor.inertia = .0001;
      c.mechanical.inertia = 0;
      c.mechanical.torque = 0;
      c.mechanical.friction = .002;
      c.parameters['FUn.tOL'] = 0;
      c.parameters['FUn.tUL'] = 0;
    });
    const b = new Engine(a.config);
    start(a, 10);
    start(b, 10);
    a.setInputs({
      outputConnections: wires
    });
    b.setInputs({
      powered: false
    });
    a.advance(.05);
    b.advance(.05);
    assert.equal(a.state.rpm, b.state.rpm);
    assert.equal(a.state.angle, b.state.angle);
    assert.equal(a.state.current, 0);
    assert.equal(a.state.torque, 0);
  }
});
test('A shorting bridge trips only when an output is energized', () => {
  const e = setup(c => c.inputs.shortCircuit = true);
  e.advance(1);
  assert.equal(e.state.fault, null);
  assert.equal(e.state.current, 0);
  assert.equal(e.state.voltage, 0);
  e.setInputs({
    LI1: true
  });
  e.advance(.005);
  assert.equal(e.state.fault, 'SCF');
  const dc = setup(c => {
    c.inputs.shortCircuit = true;
    c.parameters['FUn.AdC.ACt'] = 'Ct';
  });
  dc.advance(.005);
  assert.equal(dc.state.fault, 'SCF');
  assert.equal(dc.state.current, 0);
  assert.equal(dc.state.voltage, 0);
});
test('One open wire has no starting torque and can recover after reconnection', () => {
  for (const open of ['U', 'V', 'W']) {
    const e = setup(c => c.inputs.outputConnections[open] = false);
    start(e, 6);
    assert.equal(e.state.rpm, 0);
    assert.equal(e.state.torque, 0);
    assert(e.state.currentLimited);
    assert(e.state.current > 0);
    assert.equal(e.state.fault, null);
    assert(Math.abs(e.state.currentImbalance - 100) < 1e-9);
    assert(Math.abs(rmsPhaseCurrent(e.state) - e.state.LCr) < 1e-12);
    for (const line of ['U', 'V', 'W']) assert(e.state['phaseCurrent' + line] <= e.state.activeCurrentLimit + 1e-12);
    assert.equal(e.state['phaseCurrent' + open], 0);
    e.setInputs({
      outputConnections: {
        U: true,
        V: true,
        W: true
      }
    });
    e.advance(8);
    assert(e.state.rpm > 1400);
    assert.equal(e.state.fault, null);
    assert(!e.state.currentLimited);
  }
});
test('An open wire can stall a heavier running load without an invented phase fault', () => {
  const e = setup(c => {
    c.parameters['FUn.tOL'] = 0;
    c.parameters['FUn.tUL'] = 0;
  });
  start(e, 6);
  e.setInputs({
    outputConnections: {
      U: false,
      V: true,
      W: true
    }
  });
  e.advance(8);
  assert.equal(e.state.rpm, 0);
  assert.equal(e.state.torque, 0);
  assert(e.state.currentLimited);
  assert(e.state.current > 0);
  assert.equal(e.state.fault, null);
  finiteState(e);
});
test('An open motor circuit trips ULF only when its measured-current timer is enabled', () => {
  const e = setup(c => {
    c.inputs.outputConnections = {
      U: false,
      V: false,
      W: false
    };
    c.parameters['FUn.tUL'] = 1;
  });
  start(e, 2);
  assert.equal(e.state.fault, null);
  assert(!e.state.referenceReached);
  e.advance(6);
  assert.equal(e.state.fault, 'ULF');
});
test('A spinning motor with one open wire has reduced pulsating torque and more heating', () => {
  const e = setup(c => {
    c.mechanical.torque = .6;
    c.parameters['FUn.tOL'] = 0;
    c.parameters['FUn.tUL'] = 0;
  });
  start(e, 6);
  const healthy = e.snapshot();
  assert(Math.abs(healthy.currentImbalance) < 1e-9);
  assert.equal(healthy.phaseCurrentU, healthy.LCr);
  assert.equal(healthy.phaseCurrentV, healthy.LCr);
  assert.equal(healthy.phaseCurrentW, healthy.LCr);
  e.setInputs({
    outputConnections: {
      U: false,
      V: true,
      W: true
    }
  });
  e.advance(3);
  const torque = [];
  for (let n = 0; n < 100; n++) {
    e.advance(.005);
    torque.push(e.state.torque);
    finiteState(e);
  }
  assert(e.state.rpm > 900);
  assert(e.state.rpm < healthy.rpm - 50);
  assert(e.state.current > healthy.current);
  assert(e.state.actualMotorThermal > healthy.actualMotorThermal);
  assert(Math.max(...torque) - Math.min(...torque) > .1);
  assert.equal(e.state.phaseCurrentU, 0);
  assert(e.state.phaseCurrentV <= e.state.activeCurrentLimit + 1e-12);
  assert(e.state.phaseCurrentW <= e.state.activeCurrentLimit + 1e-12);
  assert.equal(e.state.fault, null);
});
test('The external shaft clamp holds angle, absorbs kinetic energy and permits release', () => {
  const e = setup();
  start(e, 6);
  const before = e.snapshot();
  e.setInputs({
    shaftHeld: true
  });
  e.advance(2);
  assert.equal(e.state.rpm, 0);
  assert.equal(e.state.angle, before.angle);
  assert(e.state.currentLimited);
  assert(Math.abs(e.state.current - e.state.activeCurrentLimit) < 1e-9);
  assert(Math.abs(e.state.torque + e.state.shaftReactionTorque - e.config.mechanical.torque) < 1e-9);
  assert.equal(e.state.regenerativePower, 0);
  assert.equal(e.state.fault, null);
  const heldHeat = e.state.motorThermal;
  e.setInputs({
    shaftHeld: false
  });
  e.advance(8);
  assert(e.state.rpm > 1400);
  assert(!e.state.currentLimited);
  assert.equal(e.state.shaftReactionTorque, 0);
  assert(e.state.motorThermal > heldHeat);
  assert.equal(e.state.fault, null);
});
test('A held shaft causes timed overload or thermal overload, without a fault checkbox', () => {
  const e = setup(c => c.parameters['FUn.tOL'] = 1);
  start(e, 6);
  e.setInputs({
    shaftHeld: true
  });
  e.advance(2);
  assert.equal(e.state.fault, 'OLC');
  assert.equal(e.resetFault(), false);
  e.setInputs({
    shaftHeld: false
  });
  assert(e.resetFault());
  const t = setup(c => {
    c.inputs.shaftHeld = true;
    c.parameters['FUn.tOL'] = 0;
    c.parameters['FUn.tUL'] = 0;
  });
  start(t, 5);
  assert.equal(t.state.fault, null);
  assert(t.state.currentLimited);
  assert(t.state.motorThermal > 0);
  while (!t.state.fault && t.state.time < 80) t.advance(.005);
  assert.equal(t.state.fault, 'OLF');
  assert.equal(t.resetFault(), false);
  t.setInputs({
    shaftHeld: false
  });
  t.advance(30);
  assert(t.state.motorThermal < 100);
  assert(t.resetFault());
});
test('Driving mechanical torque feeds the DC bus and the brake module absorbs it', () => {
  function driven(brakeModule) {
    const e = setup(c => {
      c.inputs.brakeModule = brakeModule;
      c.parameters['FUn.brA'] = 'nO';
      c.parameters['FUn.tOL'] = 0;
      c.parameters['FUn.tUL'] = 0;
    });
    start(e, 6);
    updateConfig(e, candidate => candidate.mechanical.torque = -3);
    return e;
  }
  const unbraked = driven(false);
  while (!unbraked.state.fault && unbraked.state.time < 12) unbraked.advance(.005);
  assert.equal(unbraked.state.fault, 'ObF');
  assert(unbraked.state.dcBus > 415);
  const braked = driven(true);
  braked.advance(6);
  assert.equal(braked.state.fault, null);
  assert(braked.state.regenerativePower > 100);
  assert(braked.state.dcBus < 415);
  assert(braked.state.rpm > 1500);
  finiteState(braked);
});
test('Physical fault dynamics remain independent of frame cadence', () => {
  const a = setup(c => {
    c.parameters['FUn.tOL'] = 0;
    c.parameters['FUn.tUL'] = 0;
  });
  const b = new Engine(a.config);
  start(a, 6);
  start(b, 6);
  a.setInputs({
    outputConnections: {
      U: true,
      V: false,
      W: true
    }
  });
  b.setInputs({
    outputConnections: {
      U: true,
      V: false,
      W: true
    }
  });
  a.advance(4);
  for (let n = 0; n < 120; n++) b.advance(1 / 30);
  assert.deepEqual(a.snapshot(), b.snapshot());
  a.setInputs({
    shaftHeld: true
  });
  b.setInputs({
    shaftHeld: true
  });
  a.advance(2);
  for (let n = 0; n < 60; n++) b.advance(1 / 30);
  assert.deepEqual(a.snapshot(), b.snapshot());
});
test('Wire configuration and derived diagnostic snapshots cannot alias engine state', () => {
  const c = config();
  const e = new Engine(c);
  c.inputs.outputConnections.U = false;
  assert(e.config.inputs.outputConnections.U);
  const wires = {
    U: false,
    V: true,
    W: true
  };
  e.setInputs({
    outputConnections: wires
  });
  wires.V = false;
  assert(e.config.inputs.outputConnections.V);
  const updated = config();
  e.setConfig(updated);
  updated.inputs.outputConnections.W = false;
  assert(e.config.inputs.outputConnections.W);
  start(e, 6);
  const readings = e.state;
  readings.phaseCurrentU = 1000;
  readings.current = 1000;
  assert(e.state.phaseCurrentU < 10);
  assert(e.state.current < 10);
  assert.deepEqual(e.state, e.snapshot());
});
test('Frequency-reference monitor remains visible while stopped', () => {
  const e = setup(c => c.inputs.analogPosition = 50);
  e.advance(.01);
  assert.equal(e.state.FrH, 25);
  assert.equal(e.monitors().FrH, 25);
  assert.equal(e.state.reference, 0);
  assert.equal(e.state.rFr, 0);
  assert.equal(e.state.running, false);
  e.setInputs({
    analogPosition: 80
  });
  e.advance(.01);
  assert.equal(e.state.FrH, 40);
  const pi = setup(c => {
    c.parameters['FUn.PI.PIF'] = 'AI1';
    c.parameters['FUn.rrS'] = 'nO';
    c.parameters['FUn.PS2.LIA'] = 'LI1';
    c.parameters['FUn.PI.rPI'] = 80;
    c.parameters['FUn.PI.rIG'] = 0;
    c.inputs.analogPosition = 20;
  });
  pi.advance(.01);
  assert.equal(pi.state.FrH, 30);
  assert.equal(pi.state.running, false);
});
test('Frequency DO full scale is HSP even with another selected high speed', () => {
  const e = setup(c => {
    c.parameters['FUn.HSP.LIA'] = 'LI3';
    c.parameters['FUn.HSP.HS2'] = 25;
    c.parameters['FUn.PS2.LIA'] = 'nO';
    c.parameters['FUn.PS2.LIb'] = 'nO';
    c.parameters['FUn.tUL'] = 0;
  });
  e.setInputs({
    LI1: true,
    LI3: true
  });
  e.advance(8);
  assert.equal(e.state.activeHighSpeed, 25);
  assert(e.state.rFr > 20 && e.state.rFr < 30);
  assert.equal(e.state.DO, e.state.rFr / e.config.parameters.HSP);
});
test('Automatic restart waits for the run order and freewheel permissive', () => {
  for (const missing of ['run', 'freewheel']) {
    const e = setup(c => {
      c.parameters['FUn.tCC.tCt'] = 'LEL';
      c.parameters['FUn.Atr'] = 'YES';
      c.parameters['FUn.nSt'] = 'LI4';
      c.parameters['FUn.PS2.LIb'] = 'nO';
      c.inputs.LI4 = true;
      c.mechanical.torque = 2.3;
    });
    e.setInputs({
      LI1: true
    });
    while (!e.state.fault && e.state.time < 20) e.advance(.005);
    assert.equal(e.state.fault, 'OLC');
    updateConfig(e, candidate => candidate.mechanical.torque = 1.2);
    e.setInputs(missing === 'run' ? {
      LI1: false
    } : {
      LI4: false
    });
    e.advance(10);
    assert.equal(e.state.fault, 'OLC');
    assert.equal(e.state.running, false);
    assert(e.state.relay);
    e.setInputs(missing === 'run' ? {
      LI1: true
    } : {
      LI4: true
    });
    e.advance(12);
    assert.equal(e.state.fault, null);
    assert(e.state.rpm > 1000);
  }
});
test('Automatic retry does not clear a fault while power is absent', () => {
  const e = setup(c => {
    c.parameters['FUn.tCC.tCt'] = 'LEL';
    c.parameters['FUn.Atr'] = 'YES';
    c.mechanical.torque = 2.3;
  });
  e.setInputs({
    LI1: true
  });
  while (!e.state.fault && e.state.time < 20) e.advance(.005);
  assert.equal(e.state.fault, 'OLC');
  updateConfig(e, candidate => candidate.mechanical.torque = 1.2);
  e.setInputs({
    powered: false
  });
  e.advance(2);
  assert.equal(e.state.fault, 'OLC');
  assert.equal(e.state.relay, false);
});
test('Automatic retries keep the documented spacing and six-minute lockout', () => {
  const e = setup(c => {
    c.parameters['FUn.tCC.tCt'] = 'LEL';
    c.parameters['FUn.Atr'] = 'YES';
    c.mechanical.torque = 2.3;
  });
  e.setInputs({
    LI1: true
  });
  while (!e.state.fault && e.state.time < 20) e.advance(.005);
  assert.equal(e.state.fault, 'OLC');
  assert.equal(e.autoAttempts, 0);
  e.advance(1.005);
  assert.equal(e.autoAttempts, 1);
  e.advance(4.99);
  assert.equal(e.autoAttempts, 1);
  e.advance(.01);
  assert.equal(e.autoAttempts, 2);
  e.advance(9.99);
  assert.equal(e.autoAttempts, 2);
  e.advance(.01);
  assert.equal(e.autoAttempts, 3);
  updateConfig(e, candidate => candidate.mechanical.torque = 1.2);
  e.setInputs({
    LI1: false
  });
  e.advance(344.01);
  assert.equal(e.state.fault, 'OLC');
  assert(e.autoAborted);
  assert.equal(e.state.relay, false);
  e.setInputs({
    LI1: true
  });
  e.advance(70);
  assert.equal(e.state.fault, 'OLC');
  e.setInputs({
    powered: false
  });
  e.advance(.5);
  e.setInputs({
    powered: true
  });
  e.advance(6);
  assert.equal(e.state.fault, null);
  assert(e.state.rpm > 1000);
});
test('PI wake requires positive correction after error inversion', () => {
  const e = setup(c => {
    c.parameters['FUn.PI.PIF'] = 'AI1';
    c.parameters['FUn.rrS'] = 'nO';
    c.parameters['FUn.PS2.LIA'] = 'LI1';
    c.parameters['FUn.PI.rPI'] = 80;
    c.parameters.LSP = 10;
    c.parameters['FUn.tLS'] = 1;
    c.parameters['FUn.PI.rSL'] = 50;
    c.inputs.analogPosition = 20;
    c.parameters['FUn.tOL'] = 0;
    c.parameters['FUn.tUL'] = 0;
  });
  start(e, 6);
  assert(e.piIntegral > .3);
  const next = clone(e.config);
  next.parameters['FUn.PI.rIG'] = 0;
  next.parameters['FUn.PI.rPI'] = 20;
  e.setConfig(next);
  e.setInputs({
    analogPosition: 100
  });
  e.advance(10);
  assert(e.lowSpeedSleeping);
  e.setInputs({
    analogPosition: 30
  });
  e.advance(.01);
  assert(e.state.FrH > e.config.parameters.LSP);
  assert(e.state.piError < 0);
  assert(e.lowSpeedSleeping, 'A negative speed correction cannot wake the sleeping PI');
  const inverted = clone(e.config);
  inverted.parameters['FUn.PI.PIC'] = 'YES';
  e.setConfig(inverted);
  e.advance(.01);
  assert(e.state.piError > 0);
  assert(!e.lowSpeedSleeping);
  assert(e.state.running);
});
test('Six-minute automatic-restart lockout rejects rSF until a power cycle', () => {
  const e = setup(c => {
    c.parameters['FUn.tCC.tCt'] = 'LEL';
    c.parameters['FUn.Atr'] = 'YES';
    c.parameters['FUn.rSF'] = 'LI3';
    c.parameters['FUn.PS2.LIA'] = 'nO';
    c.parameters['FUn.PS2.LIb'] = 'nO';
    c.mechanical.torque = 2.3;
  });
  e.setInputs({
    LI1: true
  });
  while (!e.state.fault && e.state.time < 20) e.advance(.005);
  assert.equal(e.state.fault, 'OLC');
  updateConfig(e, candidate => candidate.mechanical.torque = 1.2);
  e.setInputs({
    LI1: false
  });
  e.advance(360.1);
  assert(e.autoAborted);
  assert.equal(e.state.relay, false);
  assert.equal(e.resetFault(), false);
  assert.equal(e.resetFault(false, true), false);
  e.setInputs({
    LI3: true
  });
  e.advance(.005);
  assert.equal(e.state.fault, 'OLC');
  e.setInputs({
    LI3: false,
    LI1: true
  });
  e.advance(70);
  assert.equal(e.state.fault, 'OLC');
  e.setInputs({
    powered: false
  });
  e.advance(.5);
  e.setInputs({
    powered: true
  });
  e.advance(6);
  assert.equal(e.state.fault, null);
  assert(!e.autoAborted);
  assert(e.state.relay);
  assert(e.state.rpm > 1000);
});
test('A power cycle starts fresh retries while retaining a persistent fault cause', () => {
  const e = setup(c => {
    c.parameters['FUn.tCC.tCt'] = 'LEL';
    c.parameters['FUn.Atr'] = 'YES';
    c.mechanical.torque = 2.3;
  });
  e.setInputs({
    LI1: true
  });
  while (!e.state.fault && e.state.time < 20) e.advance(.005);
  assert.equal(e.state.fault, 'OLC');
  e.advance(360.1);
  assert(e.autoAborted);
  e.setInputs({
    powered: false
  });
  e.advance(.5);
  e.setInputs({
    powered: true
  });
  e.advance(.005);
  assert.equal(e.state.fault, 'OLC');
  assert(!e.autoAborted);
  assert.equal(e.autoAttempts, 0);
  assert(e.autoElapsed < .01);
  assert(e.state.relay);
  e.advance(1);
  assert.equal(e.autoAttempts, 1);
  assert.equal(e.state.fault, 'OLC');
  updateConfig(e, candidate => candidate.mechanical.torque = 1.2);
  e.advance(9);
  assert.equal(e.state.fault, null);
  assert(e.state.rpm > 1000);
});
test('A passive overload stops the running rotor without reversing it', () => {
  const e = setup(c => {
    c.parameters['FUn.tOL'] = 0;
    c.parameters['FUn.tUL'] = 0;
  });
  start(e, 6);
  updateConfig(e, candidate => candidate.mechanical.torque = 6);
  for (let n = 0; n < 1000; n++) {
    e.advance(.005);
    assert(e.state.rpm >= 0, 'Opposing load cannot propel a reversed rotor');
  }
  assert.equal(e.state.rpm, 0);
  assert(e.state.currentLimited);
  assert(e.state.current > 3);
});
test('A zero-ramp mechanically stalled motor reaches the current limit and heats', () => {
  const e = setup(c => {
    c.parameters.ACC = 0;
    c.parameters['FUn.tOL'] = 0;
    c.parameters['FUn.tUL'] = 0;
    c.mechanical.torque = 6;
  });
  start(e, 6);
  assert.equal(e.state.rpm, 0);
  assert(e.state.currentLimited);
  assert(e.state.current > 3);
  while (!e.state.fault && e.state.time < 80) e.advance(.005);
  assert.equal(e.state.fault, 'OLF');
});
function updateConfig(engine, mutator) {
  const candidate = structuredClone(engine.config);
  mutator(candidate);
  engine.setConfig(candidate);
}
