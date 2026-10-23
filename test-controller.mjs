// Original controller and study-aid contract checks against the manufacturer's
// panel instructions (Spanish pp.56,60,64-66; technical pp.102-103,119).
// The browser Solid runtime is bundled in memory. No browser or animation runs.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const built = await build({
  absWorkingDir: root, bundle: true, write: false, platform: 'node', format: 'cjs',
  conditions: ['browser'], define: { 'process.env.NODE_ENV': '"production"' },
  stdin: {
    contents: `import { createRoot } from 'solid-js';
      import { createSimulator } from './simulator';
      export { diagnosisLines, manualLink, PARAMETERS, FAULTS } from './guide-content';
      export function fixture() { return createRoot(dispose => ({sim: createSimulator(), dispose})); }`,
    resolveDir: root, loader: 'ts',
  },
});
assert.equal(built.outputFiles.length, 1);
const module = { exports: {} };
const pendingFrames = new Set();
let frameId = 0;
const listeners = new Map();
const saved = new Map(['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
Object.assign(globalThis, {
  window: {},
  document: { hidden: false, addEventListener(name, listener) { listeners.set(listener, name); }, removeEventListener(_name, listener) { listeners.delete(listener); } },
  requestAnimationFrame() { const id = ++frameId; pendingFrames.add(id); return id; },
  cancelAnimationFrame(id) { pendingFrames.delete(id); },
});
new Function('module', 'exports', built.outputFiles[0].text)(module, module.exports);
const { fixture, diagnosisLines, manualLink, PARAMETERS, FAULTS } = module.exports;
let count = 0;
const tests = [];
const test = (name, callback) => { tests.push([name, callback]); };
const change = (sim, section, key, value) => assert.equal(sim.commitExternal(section, key, value), true);
const text = sim => diagnosisLines(sim.state.config, sim.readings()).map(line => line[1]).join('\n');

try {
  test('keypad draft cancellation, save flash and first-boot bFr', sim => {
    sim.key(-1); assert.equal(sim.selected().id, 'bFr'); sim.enter(); sim.key(1);
    assert.equal(sim.panelSnapshot().draft, 60); sim.escapeKey();
    assert.equal(window.VFDSimulator.getConfig().parameters.bFr, 50);
    sim.enter(); sim.key(1); sim.enter(); assert.equal(sim.flashing(), true);
    const config = window.VFDSimulator.getConfig();
    assert.equal(config.parameters.bFr, 60); assert.equal(config.parameters['drC.FrS'], 60);
    assert.equal(config.driveMemory.firstBoot, false);
    assert.ok(!sim.items().some(item => item.code === 'bFr'));
    sim.navigate('bFr'); assert.deepEqual(sim.panelSnapshot().trail, ['FUn']);
    assert.equal(sim.selected().id, 'bFr');
    // bFr's primary catalog path is the root, but after first boot it must be
    // reachable through its FUn alias rather than pretending it is root-visible.
  });
  test('SUP preview is temporary; second ENT persists selection', sim => {
    sim.navigate('SUP.LCr'); sim.enter(); sim.key(1);
    assert.equal(sim.panelSnapshot().monitor, 'LCr');
    assert.equal(window.VFDSimulator.getConfig().driveMemory.monitor, 'FrH');
    sim.escapeKey(); change(sim, 'inputs', 'powered', false); window.VFDSimulator.advance(.5);
    change(sim, 'inputs', 'powered', true); assert.equal(sim.panelSnapshot().monitor, 'FrH');
    sim.navigate('SUP.LCr'); sim.enter(); sim.enter();
    assert.equal(window.VFDSimulator.getConfig().driveMemory.monitor, 'LCr');
    change(sim, 'inputs', 'powered', false); window.VFDSimulator.advance(.5); change(sim, 'inputs', 'powered', true);
    assert.equal(sim.panelSnapshot().monitor, 'LCr');
  });
  test('nCr keypad steps away from its fractional minimum into values that save and import', sim => {
    sim.navigate('drC.nCr'); sim.enter();
    sim.key(1); assert.equal(sim.panelSnapshot().draft, 2.11);
    sim.key(-1); assert.equal(sim.panelSnapshot().draft, 2.1);
    sim.escapeKey();
    assert.equal(window.VFDSimulator.saveParameter('drC.nCr', .53), true);
    sim.navigate('drC.nCr'); sim.enter(); sim.key(-1);
    assert.equal(sim.panelSnapshot().draft, .525);
    sim.enter(); assert.equal(window.VFDSimulator.getConfig().parameters['drC.nCr'], .525);
    sim.key(1); assert.equal(sim.panelSnapshot().draft, .53);
    sim.enter(); assert.equal(window.VFDSimulator.getConfig().parameters['drC.nCr'], .53);
    const exported = window.VFDSimulator.exportText();
    assert.equal(window.VFDSimulator.importText(exported).ok, true);
    assert.equal(window.VFDSimulator.getConfig().parameters['drC.nCr'], .53);
  });
  test('two-second tCC confirmation resets assignments and hides tCt', sim => {
    assert.equal(window.VFDSimulator.saveParameter('FUn.tCC.ACt', '3C', 1999), false);
    assert.equal(window.VFDSimulator.saveParameter('FUn.tCC.ACt', '3C', 2000), true);
    const p = window.VFDSimulator.getConfig().parameters;
    assert.equal(p['FUn.rrS'], 'LI3'); assert.equal(p['FUn.PS2.LIA'], 'LI4');
    assert.equal(p['FUn.PS2.LIb'], 'nO'); assert.equal(p['FUn.Atr'], 'nO');
    assert.equal(sim.canNavigate('FUn.tCC.tCt'), false);
    const before = sim.panelSnapshot(); sim.navigate('FUn.tCC.tCt');
    assert.deepEqual(sim.panelSnapshot(), before);
    assert.equal(window.VFDSimulator.saveParameter('FUn.tCC.tCt', 'LEL'), false);
  });
  test('short ENT on unchanged tCC preserves assignments and command state', sim => {
    for (const [id, value] of [
      ['FUn.rrS', 'LI4'], ['FUn.PS2.LIA', 'LI2'], ['FUn.PS2.LIb', 'LI3'],
      ['FUn.tCC.tCt', 'LEL'], ['FUn.Atr', 'YES'], ['FUn.FLr', 'YES'],
    ]) assert.equal(window.VFDSimulator.saveParameter(id, value), true);
    window.VFDSimulator.advance(.01);
    // LI2 is a preset input in the old mode and a run input in the new mode.
    // It is present before the next physical step, while the output is stopped.
    change(sim, 'inputs', 'LI2', true);
    const before = window.VFDSimulator.getConfig().parameters;
    const commandState = window.VFDSimulator.getState();
    sim.navigate('FUn.tCC.ACt'); sim.enter(); sim.enter(0);
    assert.deepEqual(window.VFDSimulator.getConfig().parameters, before);
    assert.deepEqual(window.VFDSimulator.getState(), commandState);
    assert.equal(sim.flashing(), true);
    // A real mode change still requires the documented hold and performs resets.
    assert.equal(window.VFDSimulator.saveParameter('FUn.tCC.ACt', '3C', 1999), false);
    assert.deepEqual(window.VFDSimulator.getConfig().parameters, before);
    assert.equal(window.VFDSimulator.saveParameter('FUn.tCC.ACt', '3C', 2000), true);
    const changed = window.VFDSimulator.getConfig().parameters;
    assert.equal(changed['FUn.rrS'], 'LI3'); assert.equal(changed['FUn.tCC.tCt'], 'trn');
    assert.equal(changed['FUn.Atr'], 'nO'); assert.equal(changed['FUn.PS2.LIA'], 'LI4');
    assert.equal(changed['FUn.PS2.LIb'], 'nO'); assert.equal(window.VFDSimulator.getState().armed, false);
  });
  test('unchanged bFr accepts first boot without overwriting custom motor settings', sim => {
    assert.equal(window.VFDSimulator.saveParameter('drC.FrS', 55), true);
    assert.equal(window.VFDSimulator.saveParameter('HSP', 100), true);
    const before = window.VFDSimulator.getConfig().parameters;
    assert.equal(window.VFDSimulator.getConfig().driveMemory.firstBoot, true);
    sim.navigate('bFr'); sim.enter(); sim.enter();
    assert.deepEqual(window.VFDSimulator.getConfig().parameters, before);
    assert.equal(window.VFDSimulator.getConfig().driveMemory.firstBoot, false);
    sim.escapeKey(); sim.navigate('bFr'); assert.deepEqual(sim.panelSnapshot().trail, ['FUn']);
    sim.enter(); sim.enter(); assert.deepEqual(window.VFDSimulator.getConfig().parameters, before);
    // Linked-default updates on a changed bFr are a documented model choice.
    assert.equal(window.VFDSimulator.saveParameter('bFr', 60), true);
    const changed = window.VFDSimulator.getConfig().parameters;
    for (const id of ['bFr', 'drC.FrS', 'HSP', 'FUn.dO.Ftd', 'FUn.HSP.HS2', 'FUn.HSP.HS3', 'FUn.HSP.HS4']) assert.equal(changed[id], 60);
  });
  test('unchanged SFt mode preserves SFr; a changed mode selects its valid default', sim => {
    assert.equal(window.VFDSimulator.saveParameter('FUn.SFt.SFr', 2), true);
    sim.navigate('FUn.SFt.ACt'); sim.enter(); sim.enter();
    assert.equal(window.VFDSimulator.getConfig().parameters['FUn.SFt.SFr'], 2);
    assert.equal(window.VFDSimulator.saveParameter('FUn.SFt.ACt', 'HF'), true);
    assert.equal(window.VFDSimulator.getConfig().parameters['FUn.SFt.SFr'], 12);
    assert.equal(window.VFDSimulator.saveParameter('FUn.SFt.SFr', 8), true);
    const commandState = window.VFDSimulator.getState();
    sim.navigate('FUn.SFt.ACt'); sim.enter(); sim.enter();
    assert.equal(window.VFDSimulator.getConfig().parameters['FUn.SFt.SFr'], 8);
    assert.deepEqual(window.VFDSimulator.getState(), commandState);
    assert.equal(window.VFDSimulator.saveParameter('FUn.SFt.ACt', 'LF'), true);
    assert.equal(window.VFDSimulator.getConfig().parameters['FUn.SFt.SFr'], 4);
  });
  test('COd restricts guide navigation and writes; wrong code stays locked', sim => {
    assert.equal(window.VFDSimulator.saveParameter('SUP.COd', 123), true);
    assert.equal(sim.canNavigate('ACC'), false); assert.equal(sim.canNavigate('SUP.LCr'), true);
    const before = sim.panelSnapshot(); sim.navigate('ACC'); assert.deepEqual(sim.panelSnapshot(), before);
    assert.equal(window.VFDSimulator.saveParameter('ACC', 4), false);
    assert.equal(window.VFDSimulator.saveParameter('SUP.COd', 124), false); assert.equal(sim.state.locked, true);
    assert.equal(window.VFDSimulator.saveParameter('SUP.COd', 123), true); assert.equal(sim.state.locked, false);
    assert.equal(window.VFDSimulator.saveParameter('ACC', 4), true);
    change(sim, 'inputs', 'powered', false); window.VFDSimulator.advance(.5); change(sim, 'inputs', 'powered', true);
    assert.equal(sim.state.locked, true);
  });
  test('COd unchanged numeric ENT stays unlocked; On/new code/power/OFF obey manual', sim => {
    assert.equal(window.VFDSimulator.saveParameter('SUP.COd', 123), true);
    assert.equal(sim.state.locked, true);
    assert.equal(window.VFDSimulator.saveParameter('SUP.COd', 123), true);
    assert.equal(sim.state.locked, false);
    sim.navigate('SUP.COd'); sim.enter(); assert.equal(sim.panelSnapshot().draft, 123);
    sim.enter(); assert.equal(sim.state.locked, false);
    assert.equal(window.VFDSimulator.getConfig().parameters['SUP.COd'], 123);
    assert.equal(window.VFDSimulator.saveParameter('SUP.COd', -1), true);
    assert.equal(sim.state.locked, true);
    assert.equal(window.VFDSimulator.saveParameter('SUP.COd', 123), true);
    assert.equal(window.VFDSimulator.saveParameter('SUP.COd', 456), true);
    assert.equal(sim.state.locked, true);
    assert.equal(window.VFDSimulator.getConfig().parameters['SUP.COd'], 456);
    assert.equal(window.VFDSimulator.saveParameter('SUP.COd', 456), true);
    change(sim, 'inputs', 'powered', false); window.VFDSimulator.advance(.5);
    change(sim, 'inputs', 'powered', true); assert.equal(sim.state.locked, true);
    assert.equal(window.VFDSimulator.saveParameter('SUP.COd', 456), true);
    assert.equal(window.VFDSimulator.saveParameter('SUP.COd', 0), true);
    assert.equal(sim.state.locked, false);
    change(sim, 'inputs', 'powered', false); window.VFDSimulator.advance(.5);
    change(sim, 'inputs', 'powered', true); assert.equal(sim.state.locked, false);
    assert.equal(window.VFDSimulator.getConfig().parameters['SUP.COd'], 0);
  });
  test('powered-off panel cannot write or use study shortcut', sim => {
    change(sim, 'inputs', 'powered', false);
    assert.equal(sim.canNavigate('ACC'), false); assert.equal(window.VFDSimulator.saveParameter('ACC', 4), false);
    sim.key(-1); sim.enter(); assert.equal(sim.panelSnapshot().editing, null);
  });
  test('running access permits ACC but rejects FrS and zero StA', sim => {
    change(sim, 'inputs', 'LI1', true); window.VFDSimulator.advance(.1);
    assert.equal(sim.readings().running, true);
    assert.equal(window.VFDSimulator.saveParameter('ACC', 4), true);
    assert.equal(window.VFDSimulator.saveParameter('drC.FrS', 60), false);
    assert.equal(window.VFDSimulator.saveParameter('drC.StA', 0), false);
  });
  test('SCS backup and held FCS restore parameters without changing the real motor', sim => {
    assert.equal(window.VFDSimulator.saveParameter('ACC', 4), true);
    assert.equal(window.VFDSimulator.saveParameter('FUn.SCS', 'YES'), true);
    assert.equal(window.VFDSimulator.saveParameter('ACC', 6), true);
    const motor = window.VFDSimulator.getConfig().motor;
    assert.equal(window.VFDSimulator.saveParameter('FUn.FCS', 'rEC', 1999), false);
    assert.equal(window.VFDSimulator.saveParameter('FUn.FCS', 'rEC', 2000), true);
    const config = window.VFDSimulator.getConfig();
    assert.equal(config.parameters.ACC, 4); assert.equal(config.parameters['FUn.FCS'], 'nO');
    assert.deepEqual(config.motor, motor);
  });
  test('hidden PI monitor cannot be entered until PI is enabled', sim => {
    assert.equal(sim.canNavigate('SUP.rPF'), false);
    const before = sim.panelSnapshot(); sim.navigate('SUP.rPF'); assert.deepEqual(sim.panelSnapshot(), before);
    assert.equal(window.VFDSimulator.saveParameter('FUn.PI.PIF', 'AI1'), true);
    assert.equal(sim.canNavigate('SUP.rPF'), true);
    assert.equal(window.VFDSimulator.getConfig().parameters['FUn.rrS'], 'nO');
  });
  test('direction explanation follows reverse priority and PFO', sim => {
    assert.equal(window.VFDSimulator.saveParameter('FUn.tCC.tCt', 'LEL'), true);
    change(sim, 'inputs', 'LI1', true); change(sim, 'inputs', 'LI2', true); window.VFDSimulator.advance(.1);
    assert.equal(sim.readings().direction, -1); assert.match(text(sim), /En marcha atrás/);
    change(sim, 'inputs', 'LI1', false); change(sim, 'inputs', 'LI2', false); window.VFDSimulator.advance(.1);
    // Reset via import creates a stopped fixture while preserving the programming.
    const config = window.VFDSimulator.getConfig(); config.parameters['FUn.tCC.tCt'] = 'PFO';
    assert.equal(window.VFDSimulator.importText(JSON.stringify(config)).ok, true); window.VFDSimulator.advance(.01);
    change(sim, 'inputs', 'LI1', true); change(sim, 'inputs', 'LI2', true); window.VFDSimulator.advance(.1);
    assert.equal(sim.readings().direction, 1); assert.match(text(sim), /En marcha adelante/);
  });
  test('three-wire reverse pulse remains described as reverse after release', sim => {
    assert.equal(window.VFDSimulator.saveParameter('FUn.tCC.ACt', '3C', 2000), true); window.VFDSimulator.advance(.01);
    change(sim, 'inputs', 'LI1', true); window.VFDSimulator.advance(.01);
    change(sim, 'inputs', 'LI3', true); window.VFDSimulator.advance(.01); change(sim, 'inputs', 'LI3', false); window.VFDSimulator.advance(.1);
    assert.equal(sim.readings().direction, -1); assert.match(text(sim), /En marcha atrás/);
  });
  test('selected HS2 replaces HSP in analog diagnosis', sim => {
    assert.equal(window.VFDSimulator.saveParameter('FUn.HSP.LIA', 'LI4'), true);
    assert.equal(window.VFDSimulator.saveParameter('FUn.HSP.HS2', 40), true);
    change(sim, 'inputs', 'LI4', true); // Default PS2 would otherwise select SP3.
    assert.equal(window.VFDSimulator.saveParameter('FUn.PS2.LIA', 'nO'), true);
    change(sim, 'inputs', 'LI1', true); window.VFDSimulator.advance(.1);
    assert.equal(sim.readings().activeHighSpeed, 40); assert.match(text(sim), /HS2 = 40 Hz/);
    assert.doesNotMatch(text(sim), /HSP = 50 Hz/);
  });
  test('PI manual uses SP4; automatic uses PI3 with both reference inputs', sim => {
    assert.equal(window.VFDSimulator.saveParameter('FUn.PI.PIF', 'AI1'), true);
    assert.equal(window.VFDSimulator.saveParameter('FUn.PI.PAU', 'LI2'), true);
    assert.equal(window.VFDSimulator.saveParameter('FUn.PI.Pr2', 'LI3'), true);
    assert.equal(window.VFDSimulator.saveParameter('FUn.PI.Pr4', 'LI4'), true);
    change(sim, 'inputs', 'LI4', true); change(sim, 'inputs', 'LI1', true); window.VFDSimulator.advance(.1);
    assert.match(text(sim), /PI en manual: la velocidad la fija SP4/);
    assert.doesNotMatch(text(sim), /en lugar de AI1|Consigna por AI1/);
    change(sim, 'inputs', 'LI3', true); change(sim, 'inputs', 'LI2', true); window.VFDSimulator.advance(.1);
    assert.match(text(sim), /Regulación PI automática: referencia PI3 = 60/);
    assert.doesNotMatch(text(sim), /Velocidad preseleccionada/);
  });
  test('idle held shaft does not claim rising current or heat', sim => {
    change(sim, 'inputs', 'shaftHeld', true); window.VFDSimulator.advance(.1);
    assert.match(text(sim), /Sin salida energizada, retenerlo no produce corriente/);
    assert.equal(sim.readings().LCr, 0);
  });
  test('invalid import is an error value and cannot replace configuration', sim => {
    const before = window.VFDSimulator.getConfig();
    assert.equal(window.VFDSimulator.importText('{').ok, false);
    assert.deepEqual(window.VFDSimulator.getConfig(), before);
  });
  test('manufacturer PDF page mappings and model-bound explanations', () => {
    assert.deepEqual(manualLink({manual: 'user', page: 22}), {file: 'Manual del fabricante.pdf', page: 57, label: 'Manual, pág. 56'});
    assert.equal(manualLink({manual: 'technical', page: 119}).page, 56);
    assert.match(PARAMETERS['FUn.AP1'].text, /PI activo/);
    assert.match(PARAMETERS['FUn.PI.PAU'].text, /SP4/);
    assert.match(FAULTS.OCF.simulator, /demanda magnetizante/);
    assert.equal(FAULTS.SCF.logicReset, false); assert.equal(FAULTS.SOF.logicReset, true);
    assert.equal(FAULTS.SOF.autoReset, false);
  });
  for (const [name, callback] of tests) {
    const {sim, dispose} = fixture();
    try { await callback(sim); count += 1; console.log('PASS ' + name); }
    finally { dispose(); }
    assert.equal(pendingFrames.size, 0); assert.equal(listeners.size, 0);
  }
} finally {
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}
console.log(`PASS ${count} controller and study-guide cases.`);
