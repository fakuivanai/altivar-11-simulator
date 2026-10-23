import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PhysicalPlant } from '../../physical-plant.ts';
import { initialConfig } from '../../configuration.ts';

// This uses the actual induction fluxes, free shaft and finite DC source.
// Frequency stays fixed throughout, so engine ramp/freeze logic cannot cause
// either the unstable amplitude-current loop or the recovery asserted here.
for (const open of ['U', 'V', 'W']) {
  test(`The physical AC current loop recovers after ${open} reconnection without a flux/shaft limit cycle`, () => {
    const config = initialConfig();
    config.mechanical.torque = .3;
    config.inputs.outputConnections[open] = false;
    const plant = new PhysicalPlant(config);
    const standby = { mode: 'off', frequency: 0, voltage: 0, currentLimit: 3.15,
      injectionCurrent: 0, running: false, fault: null };
    plant.advance(.25, standby, config, 0);
    const command = { ...standby, mode: 'ac', frequency: 50, voltage: 230, running: true };
    for (let n = 0; n < 400; n++) plant.advance(.005, command, config, .25 + n * .005);
    assert.equal(plant.omega, 0, 'Single-phase excitation has no starting torque');
    assert.ok(Math.abs(plant.instantaneous.phaseCurrent[open]) < 1e-12);
    config.inputs.outputConnections[open] = true;
    let minimum = Infinity, maximum = -Infinity, minTorque = Infinity, maxTorque = -Infinity;
    let torqueSum = 0, loadSum = 0;
    const torqueMeans = [], loadMeans = [];
    for (let n = 0; n < 1600; n++) {
      plant.advance(.005, command, config, 2.25 + n * .005);
      if (n >= 1500) {
        minimum = Math.min(minimum, plant.omega);
        maximum = Math.max(maximum, plant.omega);
        minTorque = Math.min(minTorque, plant.torque);
        maxTorque = Math.max(maxTorque, plant.torque);
        torqueSum += plant.torque;
        loadSum += config.mechanical.torque + config.mechanical.friction * plant.omega;
        if (n % 20 === 19) {
          torqueMeans.push(torqueSum / 20); loadMeans.push(loadSum / 20);
          torqueSum = loadSum = 0;
        }
      }
    }
    const rpm = plant.omega * 30 / Math.PI;
    assert.ok(rpm > 1400 && rpm < 1510, `Balanced excitation must recover speed: ${rpm}rpm`);
    assert.ok((maximum - minimum) * 30 / Math.PI < 1, 'No sustained shaft oscillation may replace recovery');
    // The finite full-wave DC source produces physical 100 Hz torque ripple.
    // Complete 100 ms windows separate that ripple from a slow controller limit cycle.
    assert.ok(Math.max(...torqueMeans) - Math.min(...torqueMeans) < .01,
      'No sustained cycle-mean torque/amplitude limit cycle');
    assert.ok(maxTorque - minTorque < .2, 'The source-synchronous torque ripple must remain bounded');
    assert.ok(Math.hypot(plant.instantaneous.rotorFlux.alpha, plant.instantaneous.rotorFlux.beta) < .7,
      'Reconnection must shed the large flux offset rather than pump it indefinitely');
    assert.ok(plant.current < command.currentLimit && !plant.currentLimited);
    assert.ok(Math.abs(torqueMeans.at(-1) - loadMeans.at(-1)) < .01,
      'Mean electromagnetic torque must balance the actual passive load');
  });
}
