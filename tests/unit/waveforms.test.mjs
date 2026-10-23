// Original checks for the synthesized scope waveforms and the engine's current lag.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as W from '../../waveforms.ts';
import { VFDDrive as Engine } from '../../engine.ts';
import CATALOG from '../../catalog-final.json' with { type: 'json' };
const base = {
  mode: 'ac',
  frequency: 50,
  voltage: 230,
  dcBus: 325,
  switchingKHz: 4,
  current: {
    U: 1.5,
    V: 1.5,
    W: 1.5
  },
  currentLag: 0.8,
  connected: {
    U: true,
    V: true,
    W: true
  }
};
const input = change => ({ ...base, ...change });
function average(steps, from, to) {
  let sum = 0;
  for (let k = 0; k < steps.values.length; k++) {
    const a = Math.max(steps.edges[k], from),
      b = Math.min(steps.edges[k + 1], to);
    if (b > a) sum += steps.values[k] * (b - a);
  }
  return sum / (to - from);
}
test('Line voltage takes only 0 and plus or minus the bus voltage', () => {
  const steps = W.lineVoltage(base, 0, 0.04);
  assert.ok(steps.values.length > 300, 'about two pulses per carrier period over two periods');
  for (const value of steps.values) assert.ok([0, 325, -325].some(level => Math.abs(Math.abs(value) - level) < 1e-9 && Math.sign(value) === Math.sign(value)), 'level ' + value);
  for (let k = 1; k < steps.edges.length; k++) assert.ok(steps.edges[k] > steps.edges[k - 1]);
});
test('Each carrier period averages to the fundamental, up to full output voltage', () => {
  for (const voltage of [40, 120, 230]) {
    const signal = input({
        voltage
      }),
      period = 1 / 4000;
    for (const k of [3, 17, 41, 66]) {
      const from = k * period,
        to = from + period;
      const expected = W.lineFundamental(signal, from + period / 2);
      assert.ok(Math.abs(average(W.lineVoltage(signal, from, period), from, to) - expected) < 0.04 * Math.SQRT2 * voltage + 2, `${voltage} V at period ${k}`);
    }
  }
});
test('Pulse width follows V/f: a lower voltage gives narrower pulses', () => {
  const onTime = signal => {
    const s = W.lineVoltage(signal, 0, 0.02);
    let t = 0;
    for (let k = 0; k < s.values.length; k++) if (s.values[k] !== 0) t += s.edges[k + 1] - s.edges[k];
    return t;
  };
  assert.ok(onTime(input({
    voltage: 46,
    frequency: 10
  })) < onTime(base) / 2);
});
test('Phase voltage to the star point is the six-step staircase, averaging to the phase fundamental', () => {
  const steps = W.outputVoltage(base, 'phase', 0, 0.02);
  const levels = new Set(steps.values.map(v => Math.round(3 * v / 325)));
  for (const level of levels) assert.ok([-2, -1, 0, 1, 2].includes(level), 'level ' + level);
  assert.ok(levels.has(2) && levels.has(-2) && levels.has(1), 'reaches 1/3 and 2/3 of the bus');
  const period = 1 / 4000;
  for (const k of [5, 23, 50]) {
    const from = k * period,
      mid = from + period / 2;
    const expected = Math.SQRT2 * 230 / Math.sqrt(3) * Math.sin(W.angleAt(base, mid));
    assert.ok(Math.abs(average(W.outputVoltage(base, 'phase', from, period), from, from + period) - expected) < 8, 'period ' + k);
    assert.ok(Math.abs(W.averageVoltage(base, 'phase', mid) - expected) < 8);
  }
});
test('Pole voltage swings between the bus rails; the star point follows an open conductor', () => {
  const pole = W.outputVoltage(base, 'pole', 0, 0.02);
  for (const v of pole.values) assert.ok(v === 0 || Math.abs(v - 325) < 1e-9, 'pole level ' + v);
  assert.ok(Math.abs(W.averageVoltage(base, 'pole', 0.005) - 325 / 2) > 50, 'the pole mean carries Vdc/2 plus the modulation');
  const openW = input({
    connected: {
      U: true,
      V: true,
      W: false
    }
  });
  for (const v of W.outputVoltage(openW, 'phase', 0, 0.02).values) assert.ok([0, 1, -1].includes(Math.round(2 * v / 325)), 'half-bus levels');
  assert.equal(W.outputVoltage(input({
    connected: {
      U: false,
      V: true,
      W: true
    }
  }), 'phase', 0, 0.02), null);
  assert.ok(W.outputVoltage(input({
    connected: {
      U: false,
      V: true,
      W: true
    }
  }), 'line', 0, 0.02) !== null);
});
test('Three-phase currents are balanced and sum to zero', () => {
  for (const t of [0, 0.003, 0.011, 0.017]) {
    const i = W.phaseCurrents(base, t);
    assert.ok(Math.abs(i.U + i.V + i.W) < 1e-9);
  }
  const peak = Math.max(...Array.from({
    length: 400
  }, (_, k) => W.phaseCurrents(base, k / 20000).U));
  assert.ok(Math.abs(peak - 1.5 * Math.SQRT2) < 0.01);
});
test('An open conductor carries nothing and the other two share one line current', () => {
  for (const open of ['U', 'V', 'W']) {
    const current = {
        U: 1.8,
        V: 1.8,
        W: 1.8,
        [open]: 0
      },
      connected = {
        U: true,
        V: true,
        W: true,
        [open]: false
      };
    for (const t of [0.002, 0.007, 0.013]) {
      const i = W.phaseCurrents(input({
        current,
        connected
      }), t);
      assert.equal(i[open], 0);
      const [a, b] = ['U', 'V', 'W'].filter(p => p !== open);
      assert.ok(Math.abs(i[a] + i[b]) < 1e-9);
    }
  }
});
test('Average power follows the sign of cos(lag): regeneration returns energy', () => {
  const power = signal => {
    let sum = 0;
    for (let k = 0; k < 2000; k++) {
      const t = k / 2000 / 50,
        i = W.phaseCurrents(signal, t),
        a = W.angleAt(signal, t),
        peak = Math.SQRT2 * signal.voltage / Math.sqrt(3);
      sum += peak * (Math.sin(a) * i.U + Math.sin(a - 2 * Math.PI / 3) * i.V + Math.sin(a + 2 * Math.PI / 3) * i.W);
    }
    return sum / 2000;
  };
  assert.ok(power(input({
    currentLag: 0.6
  })) > 0);
  assert.ok(power(input({
    currentLag: 2.4
  })) < 0);
  assert.ok(Math.abs(power(input({
    currentLag: 0.6
  })) - Math.sqrt(3) * 230 * 1.5 * Math.cos(0.6)) < 2);
});
test('Reverse rotation reverses the phase sequence', () => {
  // Which phase peaks next after U: V in forward rotation, W in reverse.
  const nextPeak = signal => {
    const peakTime = phase => {
      let best = 0,
        bestValue = -Infinity;
      for (let k = 0; k < 2000; k++) {
        const t = k / 2000 / 50,
          v = W.phaseCurrents(signal, t)[phase];
        if (v > bestValue) {
          bestValue = v;
          best = t;
        }
      }
      return best;
    };
    const u = peakTime('U'),
      after = t => ((t - u) % 0.02 + 0.02) % 0.02;
    return after(peakTime('V')) < after(peakTime('W')) ? 'V' : 'W';
  };
  assert.equal(nextPeak(base), 'V');
  assert.equal(nextPeak(input({
    frequency: -50
  })), 'W');
});
test('DC injection gives constant currents that sum to zero and no output when off', () => {
  const dc = input({
    mode: 'dc',
    frequency: 0,
    voltage: 18,
    current: {
      U: 1.47,
      V: 0.735,
      W: 0.735
    }
  });
  const a = W.phaseCurrents(dc, 0),
    b = W.phaseCurrents(dc, 0.013);
  assert.deepEqual(a, b);
  assert.ok(Math.abs(a.U + a.V + a.W) < 1e-12 && a.U > 0);
  assert.ok(Math.abs(average(W.lineVoltage(dc, 0, 0.01), 0, 0.01) - 18) < 1);
  const off = input({
    mode: 'off'
  });
  assert.deepEqual(W.phaseCurrents(off, 0.003), {
    U: 0,
    V: 0,
    W: 0
  });
  assert.deepEqual(W.lineVoltage(off, 0, 0.01).values, [0]);
});
test('Windows: two periods, or a zoom centred on the chosen angle', () => {
  assert.ok(Math.abs(W.scopeWindow(base, false).length - 0.04) < 1e-12);
  const zoom = W.scopeWindow(base, {
    angle: Math.PI,
    length: 0.002
  });
  assert.ok(Math.abs(zoom.start + zoom.length / 2 - 0.01) < 1e-12);
  assert.ok(W.scopeWindow(input({
    frequency: 0.1
  }), false).length <= 2 / W.MIN_SCOPE_FREQUENCY);
  assert.equal(W.niceLimit(3.1, 1), 5);
  assert.equal(W.niceLimit(0.2, 1), 1);
  assert.equal(W.niceLimit(325, 100), 500);
});
function config(change) {
  const c = {
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
  change(c);
  return c;
}
test('Engine: motoring current lags less than 90 degrees, more load means smaller lag', () => {
  const light = new Engine(config(c => {
    c.mechanical.torque = 0.4;
    c.parameters['FUn.tUL'] = 0;
  }));
  const loaded = new Engine(config(c => {
    c.mechanical.torque = 2.2;
    c.parameters['FUn.tOL'] = 0;
  }));
  for (const e of [light, loaded]) {
    e.setInputs({
      LI1: true
    });
    e.advance(6);
    assert.equal(e.state.outputMode, 'ac');
  }
  assert.ok(loaded.state.currentLag < light.state.currentLag && light.state.currentLag < Math.PI / 2);
  assert.ok(Math.abs(Math.cos(loaded.state.currentLag) - 0.8) < 0.15, 'near rated load the displacement is near the nameplate cos phi: ' + Math.cos(loaded.state.currentLag));
});
test('Engine: braking a large inertia makes the current lag more than 90 degrees', () => {
  const e = new Engine(config(c => {
    c.mechanical.inertia = .05;
    c.mechanical.torque = 0;
    c.parameters['FUn.tUL'] = 0;
    c.parameters['FUn.brA'] = 'nO';
    c.inputs.brakeModule = true;
  }));
  e.setInputs({
    LI1: true
  });
  e.advance(8);
  e.setInputs({
    LI1: false
  });
  e.advance(0.6);
  assert.ok(e.state.running && e.state.regenerativePower > 0);
  assert.ok(e.state.currentLag > Math.PI / 2, 'lag ' + e.state.currentLag);
});
test('Engine: DC injection and idle output modes', () => {
  const e = new Engine(config(c => {
    c.parameters['FUn.tUL'] = 0;
  }));
  assert.equal(e.state.outputMode, 'off');
  e.setInputs({
    LI1: true
  });
  e.advance(6);
  e.setInputs({
    LI1: false
  });
  let seen = false;
  for (let n = 0; n < 1400; n++) {
    e.advance(.005);
    if (e.state.outputMode === 'dc') seen = true;
  }
  assert.ok(seen);
});
function fromEngine(engine) {
  const r = engine.state;
  return { mode: r.outputMode, frequency: r.frequency, voltage: r.voltage, dcBus: r.dcBus,
    switchingKHz: r.switchingFrequency, current: { U: r.phaseCurrentU, V: r.phaseCurrentV, W: r.phaseCurrentW },
    currentLag: r.currentLag, connected: engine.config.inputs.outputConnections };
}
test('Forward and reverse motoring consume energy with the same displacement factor', () => {
  const states = [];
  for (const command of ['LI1', 'LI2']) {
    const e = new Engine(config(() => {}));
    e.setInputs({
      [command]: true
    });
    e.advance(6);
    const r = e.state;
    assert.ok(r.torque * r.omega > 200 && r.regenerativePower === 0);
    assert.ok(r.currentLag > 0 && r.currentLag < Math.PI / 2);
    states.push(r);
  }
  assert.ok(Math.abs(states[0].currentLag - states[1].currentLag) < 1e-8);
});
test('Current lags in physical time and consumes active power in both phase sequences', () => {
  for (const frequency of [50, -50]) {
    const signal = input({
      frequency,
      voltage: 180,
      currentLag: 0.8
    });
    let active = 0,
      reactive = 0;
    const n = 4000,
      dt = 1e-7;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / (n * Math.abs(frequency));
      const v = W.averageVoltage(signal, 'phase', t),
        i = W.phaseCurrents(signal, t).U;
      const derivative = (W.averageVoltage(signal, 'phase', t + dt) - W.averageVoltage(signal, 'phase', t - dt)) / (2 * dt);
      active += v * i / n;
      reactive -= derivative * i / (n * 2 * Math.PI * Math.abs(frequency));
    }
    assert.ok(active > 0 && reactive > 0, JSON.stringify({
      frequency,
      active,
      reactive
    }));
    assert.ok(Math.abs(3 * active - Math.sqrt(3) * 180 * 1.5 * Math.cos(0.8)) < 1e-6);
  }
});
test('Reverse braking regenerates while its current still has inductive lag', () => {
  const e = new Engine(config(c => {
    c.mechanical.inertia = .05;
    c.mechanical.torque = 0;
    c.parameters['FUn.tUL'] = 0;
    c.parameters['FUn.brA'] = 'nO';
    c.inputs.brakeModule = true;
  }));
  e.setInputs({
    LI2: true
  });
  e.advance(8);
  e.setInputs({
    LI2: false
  });
  e.advance(.6);
  assert.ok(e.state.frequency < 0 && e.state.torque > 0 && e.state.regenerativePower > 0);
  assert.ok(e.state.currentLag > Math.PI / 2);
});
test('DC meters and traces agree for every connected injection pair', () => {
  for (const open of [null, 'U', 'V', 'W']) {
    const e = new Engine(config(c => {
      c.parameters['FUn.AdC.ACt'] = 'Ct';
      if (open) c.inputs.outputConnections[open] = false;
    }));
    e.advance(1);
    const signal = fromEngine(e),
      currents = W.phaseCurrents(signal, 0),
      d = W.duties(signal, 0);
    const connected = W.PHASES.filter(p => signal.connected[p]);
    assert.equal(signal.mode, 'dc');
    assert.ok(Math.abs(W.lineFundamental(signal, 0) - average(W.lineVoltage(signal, 0, .01), 0, .01)) < 1e-9);
    assert.ok(Math.abs(Object.values(currents).reduce((a, b) => a + b, 0)) < 1e-12);
    for (const phase of W.PHASES) assert.ok(Math.abs(Math.abs(currents[phase]) - signal.current[phase]) < 1e-12);
    assert.ok(Math.abs(Math.hypot(...Object.values(currents)) / Math.sqrt(3) - e.state.LCr) < 1e-12);
    assert.ok(Math.abs(currents[connected[0]] - e.config.parameters['FUn.AdC.SdC']) < 1e-9);
    for (const sink of connected.slice(1)) assert.ok(Math.abs((d[connected[0]] - d[sink]) * signal.dcBus - signal.voltage) < 1e-9);
  }
});
test('No closed DC motor circuit carries no current', () => {
  for (const connected of [{
    U: false,
    V: false,
    W: false
  }, {
    U: true,
    V: false,
    W: false
  }]) {
    const e = new Engine(config(c => {
      c.parameters['FUn.AdC.ACt'] = 'Ct';
      c.inputs.outputConnections = connected;
    }));
    e.advance(.2);
    assert.deepEqual(W.phaseCurrents(fromEngine(e), .001), {
      U: 0,
      V: 0,
      W: 0
    });
  }
});
test('DC injection dissipates rotor energy without charging the bus', () => {
  const e = new Engine(config(c => {
    c.parameters.dEC = 0;
    c.parameters['FUn.AdC.tdC'] = 5;
    c.parameters['FUn.tUL'] = 0;
    c.mechanical.inertia = .05;
  }));
  e.setInputs({
    LI1: true
  });
  e.advance(12);
  e.setInputs({
    LI1: false
  });
  const before = e.state.dcBus;
  let dc = false;
  for (let n = 0; n < 200; n++) {
    e.advance(.005);
    if (e.state.outputMode === 'dc') {
      dc = true;
      assert.equal(e.state.regenerativePower, 0);
    }
    assert.equal(e.state.fault, null);
    assert.ok(e.state.dcBus <= before + 1e-8);
  }
  assert.ok(dc && e.state.rpm > 0);
});
test('Inhibition and faults immediately clear the exported output mode', () => {
  const e = new Engine(config(() => {}));
  e.setInputs({
    LI1: true
  });
  e.advance(6);
  e.inhibitCommands();
  assert.equal(e.state.outputMode, 'off');
  const f = new Engine(config(c => {
    c.inputs.shortCircuit = true;
  }));
  f.setInputs({
    LI1: true
  });
  f.advance(.005);
  assert.equal(f.state.fault, 'SCF');
  assert.equal(f.state.outputMode, 'off');
});
test('Reverse zoom centers the selected signed electrical angle', () => {
  const signal = input({
    frequency: -50
  });
  const zoom = W.scopeWindow(signal, {
    angle: Math.PI / 3,
    length: .002
  });
  assert.ok(Math.abs(W.angleAt(signal, zoom.start + zoom.length / 2) - Math.PI / 3) < 1e-12);
});
test('Opposite rotor and AC field directions consume power during plugging', () => {
  const e = new Engine(config(c => {
    c.mechanical.inertia = .1;
    c.mechanical.torque = 0;
    c.inputs.brakeModule = true;
    c.parameters['FUn.tUL'] = 0;
    c.parameters['FUn.brA'] = 'nO';
    c.parameters.ACC = 0;
    c.parameters.dEC = 0;
  }));
  e.setInputs({
    LI1: true
  });
  e.advance(12);
  e.setInputs({
    LI1: false,
    LI2: true
  });
  let plugging = false;
  for (let n = 0; n < 200; n++) {
    e.advance(.005);
    const r = e.state;
    if (r.outputMode === 'ac' && r.frequency < -1 && r.rpm > 1000 && r.torque < 0) {
      plugging = true;
      assert.equal(r.regenerativePower, 0);
      assert.ok(r.currentLag < Math.PI / 2);
      break;
    }
  }
  assert.ok(plugging);
});
