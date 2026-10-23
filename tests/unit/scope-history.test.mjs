import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createScopeHistory, scopeTrace } from '../../scope-history.ts';

function sample(time, change = {}) {
  return {
    time, voltage: { U: 10, V: -5, W: -5 }, current: { U: 1, V: -.5, W: -.5 },
    torque: 1, rpm: 1000, flux: .4, dcBus: 325, running: false, fault: null,
    loadTorque: 1, ...change,
  };
}

test('The rolling history is bounded by physical time and sampling interval', () => {
  const history = createScopeHistory({ duration: 1, sampleInterval: .1 });
  for (let index = 0; index <= 400; index++) history.push(sample(index / 100));
  const saved = history.samples();
  assert.ok(saved.length <= 11);
  assert.ok(saved[0].time >= 3 - 1e-10);
  assert.equal(saved.at(-1).time, 4);
  for (let index = 1; index < saved.length; index++) assert.ok(saved[index].time - saved[index - 1].time >= .1 - 1e-10);
});

test('A start acquisition retains its pre-trigger history and freezes after its post window', () => {
  const history = createScopeHistory({ duration: 2, sampleInterval: .1 });
  for (let index = 0; index <= 10; index++) history.push(sample(index / 10));
  history.arm('start', { before: .3, after: .4 });
  assert.equal(history.status(), 'armed');
  assert.equal(history.trigger(), 'start');
  history.push(sample(1.1, { running: true }));
  assert.equal(history.status(), 'capturing');
  assert.equal(history.capture().triggerTime, 1.1);
  assert.ok(Math.abs(history.capture().samples[0].time - .8) < 1e-10);
  for (let index = 12; index <= 15; index++) history.push(sample(index / 10, { running: true, torque: index }));
  assert.equal(history.status(), 'complete');
  const capture = history.capture();
  assert.equal(capture.samples.at(-1).time, 1.5);
  history.push(sample(3, { torque: 99 }));
  assert.deepEqual(history.capture(), capture);
  history.resume();
  assert.equal(history.status(), 'live');
  assert.equal(history.capture(), null);
  assert.equal(history.trigger(), null);
  assert.equal(history.samples().at(-1).torque, 99);
});

test('Load edges are detected before decimation and include the actual edge sample', () => {
  const history = createScopeHistory({ duration: 1, sampleInterval: .1 });
  history.push(sample(0));
  history.arm('load', { before: .1, after: .1 });
  history.push(sample(.01, { loadTorque: 2, torque: -.8 }));
  assert.equal(history.status(), 'capturing');
  assert.equal(history.capture().triggerTime, .01);
  assert.equal(history.capture().samples.at(-1).torque, -.8);
  history.push(sample(.2, { loadTorque: 2 }));
  assert.equal(history.status(), 'complete');
});

test('A fault capture triggers once on the fault edge and records signed currents', () => {
  const history = createScopeHistory({ duration: 1, sampleInterval: .01 });
  history.push(sample(0, { running: true }));
  history.arm('fault', { before: .1, after: 0 });
  history.push(sample(.01, { running: false, fault: 'SCF', current: { U: -2, V: .8, W: 1.2 } }));
  const capture = history.capture();
  assert.equal(history.status(), 'complete');
  assert.equal(capture.trigger, 'fault');
  assert.equal(capture.samples.at(-1).current.U, -2);
  history.push(sample(.02, { fault: 'OCF' }));
  assert.deepEqual(history.capture(), capture);
});

test('Stored records own their vectors and returned arrays do not modify the recorder', () => {
  const history = createScopeHistory();
  const value = sample(0);
  history.push(value);
  value.current.U = 99;
  value.voltage.U = 99;
  const saved = history.samples();
  assert.equal(saved[0].current.U, 1);
  assert.equal(saved[0].voltage.U, 10);
  assert.throws(() => { saved[0].current.U = 99; }, TypeError);
  saved.pop();
  assert.equal(history.samples().length, 1);
});

test('Restarting physical time clears old history and an armed capture', () => {
  const history = createScopeHistory();
  history.push(sample(5));
  history.arm('start');
  history.push(sample(0));
  assert.equal(history.status(), 'live');
  assert.deepEqual(history.samples().map(value => value.time), [0]);
});

test('Extrema downsampling retains narrow transients, endpoints and time order', () => {
  const samples = Array.from({ length: 20001 }, (_, index) => sample(index * .0005, { torque: index === 4333 ? 50 : index === 15001 ? -40 : 0 }));
  const trace = scopeTrace(samples, value => value.torque);
  assert.ok(trace.length <= 1000);
  assert.equal(trace[0].time, 0);
  assert.equal(trace.at(-1).time, 10);
  assert.ok(trace.some(point => point.value === 50));
  assert.ok(trace.some(point => point.value === -40));
  for (let index = 1; index < trace.length; index++) assert.ok(trace[index].time > trace[index - 1].time);
});

test('Invalid windows fail at the recorder boundary', () => {
  assert.throws(() => createScopeHistory({ sampleInterval: 0 }));
  const history = createScopeHistory({ duration: 1 });
  assert.throws(() => history.arm('start', { before: 2, after: 1 }));
  assert.throws(() => history.arm('start', { before: 0, after: 0 }));
  assert.throws(() => history.push(sample(NaN)));
});
