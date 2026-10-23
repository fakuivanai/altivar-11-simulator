// Original checks for the relative slider scales of the mechanical load.
const assert = require('node:assert/strict');
const { torqueScale, frictionScale, inertiaScale, ratedTorque, ratedSpeed, startTime } = require('./scales.cjs');
const motor = { powerKW: .37, voltage: 230, frequency: 50, current: 2.1, speedRPM: 1420, poles: 4, cosPhi: .8, inertia: .002 };
const big = { ...motor, powerKW: 2.2, speedRPM: 2850, inertia: .004 };
let passed = 0;
function check(name, body) { body(); passed += 1; console.log('PASS ' + name); }

check('rated torque follows the nameplate', () => {
  assert.ok(Math.abs(ratedTorque(motor) - 2.488) < .001);
  assert.ok(Math.abs(ratedSpeed(motor) - 148.7) < .1);
});
check('torque slider is a percentage of rated torque and keeps the sign', () => {
  const scale = torqueScale(motor);
  assert.equal(scale.fromPosition(0), 0);
  assert.ok(Math.abs(scale.fromPosition(100) - ratedTorque(motor)) < .01);
  assert.ok(scale.fromPosition(-50) < 0);
  assert.ok(Math.abs(scale.toPosition(1.2) - 48.2) < .1, 'the factory load is about half of Tn');
  assert.ok(scale.fromPosition(200) <= 20 && scale.fromPosition(-100) >= -20);
});
check('friction slider gives the braking torque at rated speed', () => {
  for (const m of [motor, big]) {
    const scale = frictionScale(m), b = scale.fromPosition(50);
    assert.ok(Math.abs(b * ratedSpeed(m) - .5 * ratedTorque(m)) < .01);
    assert.ok(Math.abs(scale.toPosition(b) - 50) < .1);
  }
  assert.ok(frictionScale(motor).fromPosition(100) <= .2);
});
check('inertia slider is logarithmic in motor inertias, with zero at the left', () => {
  const scale = inertiaScale(motor);
  assert.equal(scale.fromPosition(0), 0);
  assert.equal(scale.toPosition(0), 0);
  const one = scale.fromPosition(scale.ticks[1][0]);
  assert.ok(Math.abs(one - motor.inertia) / motor.inertia < .03, 'the 1x tick is the motor inertia');
  for (const position of [1, 20, 50, 80, 100]) {
    const value = scale.fromPosition(position);
    assert.ok(value > 0 && value <= 2);
    assert.ok(Math.abs(scale.toPosition(value) - position) < .5, 'round trip at ' + position);
  }
  const factory = scale.toPosition(.008);
  assert.ok(factory > 30 && factory < 50, 'the factory load sits mid-travel: ' + factory);
});
check('start time grows with the added inertia', () => {
  assert.ok(startTime(motor, 0) < startTime(motor, .008));
  assert.ok(Math.abs(startTime(motor, .008) - .598) < .01);
});
check('nameplate extremes preserve useful travel up to each stored limit', () => {
  const slow = { ...motor, powerKW: 3, speedRPM: 50, inertia: 2 };
  const torque = torqueScale(slow), friction = frictionScale(slow), inertia = inertiaScale(slow);
  assert.ok(torque.max < 200 && torque.min > -100);
  assert.equal(torque.fromPosition(torque.max), 20);
  assert.ok(friction.max < 100);
  assert.equal(friction.fromPosition(friction.max), .2);
  assert.equal(inertia.fromPosition(100), 2);
  assert.ok(inertia.fromPosition(80) < inertia.fromPosition(90));
  for (const position of [20, 50, 80, 100]) {
    assert.ok(Math.abs(inertia.toPosition(inertia.fromPosition(position)) - position) < .5);
  }
});
console.log(passed + ' scale cases passed.');
