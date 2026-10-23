import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPanelFixture } from '../helpers/panel-fixture.mjs';
import { diagnosisLines } from '../../diagnosis.ts';
import { manualLink, PARAMETERS, FAULTS } from '../../guide-content.ts';
import documents from '../../manufacturer-documents.json' with { type: 'json' };
import { manualUrl } from '../../manuals.ts';
const change = (sim, section, key, value) => assert.equal(sim.commitExternal(section, key, value), true);
const text = sim => diagnosisLines(sim.state.config, sim.readings()).map(line => line[1]).join('\n');
test('keypad draft cancellation, save flash and first-boot bFr', () => {
  const sim = createPanelFixture();
  sim.key(-1);
  assert.equal(sim.selected().id, 'bFr');
  sim.enter();
  sim.key(1);
  assert.equal(sim.panelSnapshot().draft, 60);
  sim.escapeKey();
  assert.equal(sim.api.getConfig().parameters.bFr, 50);
  sim.enter();
  sim.key(1);
  sim.enter();
  assert.equal(sim.flashing(), true);
  const config = sim.api.getConfig();
  assert.equal(config.parameters.bFr, 60);
  assert.equal(config.parameters['drC.FrS'], 60);
  assert.equal(config.driveMemory.firstBoot, false);
  assert.ok(!sim.items().some(item => item.code === 'bFr'));
  sim.navigate('bFr');
  assert.deepEqual(sim.panelSnapshot().trail, ['FUn']);
  assert.equal(sim.selected().id, 'bFr');
  // bFr's primary catalog path is the root, but after first boot it must be
  // reachable through its FUn alias rather than pretending it is root-visible.
});
test('SUP preview is temporary; second ENT persists selection', () => {
  const sim = createPanelFixture();
  sim.navigate('SUP.LCr');
  sim.enter();
  sim.key(1);
  assert.equal(sim.panelSnapshot().monitor, 'LCr');
  assert.equal(sim.api.getConfig().driveMemory.monitor, 'FrH');
  sim.escapeKey();
  change(sim, 'inputs', 'powered', false);
  sim.api.advance(.5);
  change(sim, 'inputs', 'powered', true);
  assert.equal(sim.panelSnapshot().monitor, 'FrH');
  sim.navigate('SUP.LCr');
  sim.enter();
  sim.enter();
  assert.equal(sim.api.getConfig().driveMemory.monitor, 'LCr');
  change(sim, 'inputs', 'powered', false);
  sim.api.advance(.5);
  change(sim, 'inputs', 'powered', true);
  assert.equal(sim.panelSnapshot().monitor, 'LCr');
});
test('nCr keypad steps away from its fractional minimum into values that save and import', () => {
  const sim = createPanelFixture();
  sim.navigate('drC.nCr');
  sim.enter();
  sim.key(1);
  assert.equal(sim.panelSnapshot().draft, 2.11);
  sim.key(-1);
  assert.equal(sim.panelSnapshot().draft, 2.1);
  sim.escapeKey();
  assert.equal(sim.api.saveParameter('drC.nCr', .53), true);
  sim.navigate('drC.nCr');
  sim.enter();
  sim.key(-1);
  assert.equal(sim.panelSnapshot().draft, .525);
  sim.enter();
  assert.equal(sim.api.getConfig().parameters['drC.nCr'], .525);
  sim.key(1);
  assert.equal(sim.panelSnapshot().draft, .53);
  sim.enter();
  assert.equal(sim.api.getConfig().parameters['drC.nCr'], .53);
  const exported = sim.api.exportText();
  assert.equal(sim.api.importText(exported).ok, true);
  assert.equal(sim.api.getConfig().parameters['drC.nCr'], .53);
});
test('two-second tCC confirmation resets assignments and hides tCt', () => {
  const sim = createPanelFixture();
  assert.equal(sim.api.saveParameter('FUn.tCC.ACt', '3C', 1999), false);
  assert.equal(sim.api.saveParameter('FUn.tCC.ACt', '3C', 2000), true);
  const p = sim.api.getConfig().parameters;
  assert.equal(p['FUn.rrS'], 'LI3');
  assert.equal(p['FUn.PS2.LIA'], 'LI4');
  assert.equal(p['FUn.PS2.LIb'], 'nO');
  assert.equal(p['FUn.Atr'], 'nO');
  assert.equal(sim.canNavigate('FUn.tCC.tCt'), false);
  const before = sim.panelSnapshot();
  sim.navigate('FUn.tCC.tCt');
  assert.deepEqual(sim.panelSnapshot(), before);
  assert.equal(sim.api.saveParameter('FUn.tCC.tCt', 'LEL'), false);
});
test('short ENT on unchanged tCC preserves assignments and command state', () => {
  const sim = createPanelFixture();
  for (const [id, value] of [['FUn.rrS', 'LI4'], ['FUn.PS2.LIA', 'LI2'], ['FUn.PS2.LIb', 'LI3'], ['FUn.tCC.tCt', 'LEL'], ['FUn.Atr', 'YES'], ['FUn.FLr', 'YES']]) assert.equal(sim.api.saveParameter(id, value), true);
  sim.api.advance(.01);
  // LI2 is a preset input in the old mode and a run input in the new mode.
  // It is present before the next physical step, while the output is stopped.
  change(sim, 'inputs', 'LI2', true);
  const before = sim.api.getConfig().parameters;
  const commandState = sim.api.getState();
  sim.navigate('FUn.tCC.ACt');
  sim.enter();
  sim.enter(0);
  assert.deepEqual(sim.api.getConfig().parameters, before);
  assert.deepEqual(sim.api.getState(), commandState);
  assert.equal(sim.flashing(), true);
  // A real mode change still requires the documented hold and performs resets.
  assert.equal(sim.api.saveParameter('FUn.tCC.ACt', '3C', 1999), false);
  assert.deepEqual(sim.api.getConfig().parameters, before);
  assert.equal(sim.api.saveParameter('FUn.tCC.ACt', '3C', 2000), true);
  const changed = sim.api.getConfig().parameters;
  assert.equal(changed['FUn.rrS'], 'LI3');
  assert.equal(changed['FUn.tCC.tCt'], 'trn');
  assert.equal(changed['FUn.Atr'], 'nO');
  assert.equal(changed['FUn.PS2.LIA'], 'LI4');
  assert.equal(changed['FUn.PS2.LIb'], 'nO');
  assert.equal(sim.api.getState().armed, false);
});
test('unchanged bFr accepts first boot without overwriting custom motor settings', () => {
  const sim = createPanelFixture();
  assert.equal(sim.api.saveParameter('drC.FrS', 55), true);
  assert.equal(sim.api.saveParameter('HSP', 100), true);
  const before = sim.api.getConfig().parameters;
  assert.equal(sim.api.getConfig().driveMemory.firstBoot, true);
  sim.navigate('bFr');
  sim.enter();
  sim.enter();
  assert.deepEqual(sim.api.getConfig().parameters, before);
  assert.equal(sim.api.getConfig().driveMemory.firstBoot, false);
  sim.escapeKey();
  sim.navigate('bFr');
  assert.deepEqual(sim.panelSnapshot().trail, ['FUn']);
  sim.enter();
  sim.enter();
  assert.deepEqual(sim.api.getConfig().parameters, before);
  // Linked-default updates on a changed bFr are a documented model choice.
  assert.equal(sim.api.saveParameter('bFr', 60), true);
  const changed = sim.api.getConfig().parameters;
  for (const id of ['bFr', 'drC.FrS', 'HSP', 'FUn.dO.Ftd', 'FUn.HSP.HS2', 'FUn.HSP.HS3', 'FUn.HSP.HS4']) assert.equal(changed[id], 60);
});
test('unchanged SFt mode preserves SFr; a changed mode selects its valid default', () => {
  const sim = createPanelFixture();
  assert.equal(sim.api.saveParameter('FUn.SFt.SFr', 2), true);
  sim.navigate('FUn.SFt.ACt');
  sim.enter();
  sim.enter();
  assert.equal(sim.api.getConfig().parameters['FUn.SFt.SFr'], 2);
  assert.equal(sim.api.saveParameter('FUn.SFt.ACt', 'HF'), true);
  assert.equal(sim.api.getConfig().parameters['FUn.SFt.SFr'], 12);
  assert.equal(sim.api.saveParameter('FUn.SFt.SFr', 8), true);
  const commandState = sim.api.getState();
  sim.navigate('FUn.SFt.ACt');
  sim.enter();
  sim.enter();
  assert.equal(sim.api.getConfig().parameters['FUn.SFt.SFr'], 8);
  assert.deepEqual(sim.api.getState(), commandState);
  assert.equal(sim.api.saveParameter('FUn.SFt.ACt', 'LF'), true);
  assert.equal(sim.api.getConfig().parameters['FUn.SFt.SFr'], 4);
});
test('COd restricts guide navigation and writes; wrong code stays locked', () => {
  const sim = createPanelFixture();
  assert.equal(sim.api.saveParameter('SUP.COd', 123), true);
  assert.equal(sim.canNavigate('ACC'), false);
  assert.equal(sim.canNavigate('SUP.LCr'), true);
  const before = sim.panelSnapshot();
  sim.navigate('ACC');
  assert.deepEqual(sim.panelSnapshot(), before);
  assert.equal(sim.api.saveParameter('ACC', 4), false);
  assert.equal(sim.api.saveParameter('SUP.COd', 124), false);
  assert.equal(sim.state.locked, true);
  assert.equal(sim.api.saveParameter('SUP.COd', 123), true);
  assert.equal(sim.state.locked, false);
  assert.equal(sim.api.saveParameter('ACC', 4), true);
  change(sim, 'inputs', 'powered', false);
  sim.api.advance(.5);
  change(sim, 'inputs', 'powered', true);
  assert.equal(sim.state.locked, true);
});
test('COd unchanged numeric ENT stays unlocked; On/new code/power/OFF obey manual', () => {
  const sim = createPanelFixture();
  assert.equal(sim.api.saveParameter('SUP.COd', 123), true);
  assert.equal(sim.state.locked, true);
  assert.equal(sim.api.saveParameter('SUP.COd', 123), true);
  assert.equal(sim.state.locked, false);
  sim.navigate('SUP.COd');
  sim.enter();
  assert.equal(sim.panelSnapshot().draft, 123);
  sim.enter();
  assert.equal(sim.state.locked, false);
  assert.equal(sim.api.getConfig().parameters['SUP.COd'], 123);
  assert.equal(sim.api.saveParameter('SUP.COd', -1), true);
  assert.equal(sim.state.locked, true);
  assert.equal(sim.api.saveParameter('SUP.COd', 123), true);
  assert.equal(sim.api.saveParameter('SUP.COd', 456), true);
  assert.equal(sim.state.locked, true);
  assert.equal(sim.api.getConfig().parameters['SUP.COd'], 456);
  assert.equal(sim.api.saveParameter('SUP.COd', 456), true);
  change(sim, 'inputs', 'powered', false);
  sim.api.advance(.5);
  change(sim, 'inputs', 'powered', true);
  assert.equal(sim.state.locked, true);
  assert.equal(sim.api.saveParameter('SUP.COd', 456), true);
  assert.equal(sim.api.saveParameter('SUP.COd', 0), true);
  assert.equal(sim.state.locked, false);
  change(sim, 'inputs', 'powered', false);
  sim.api.advance(.5);
  change(sim, 'inputs', 'powered', true);
  assert.equal(sim.state.locked, false);
  assert.equal(sim.api.getConfig().parameters['SUP.COd'], 0);
});
test('powered-off panel cannot write or use study shortcut', () => {
  const sim = createPanelFixture();
  change(sim, 'inputs', 'powered', false);
  assert.equal(sim.canNavigate('ACC'), false);
  assert.equal(sim.api.saveParameter('ACC', 4), false);
  sim.key(-1);
  sim.enter();
  assert.equal(sim.panelSnapshot().editing, null);
});
test('running access permits ACC but rejects FrS and zero StA', () => {
  const sim = createPanelFixture();
  change(sim, 'inputs', 'LI1', true);
  sim.api.advance(.1);
  assert.equal(sim.readings().running, true);
  assert.equal(sim.api.saveParameter('ACC', 4), true);
  assert.equal(sim.api.saveParameter('drC.FrS', 60), false);
  assert.equal(sim.api.saveParameter('drC.StA', 0), false);
});
test('SCS backup and held FCS restore parameters without changing the real motor', () => {
  const sim = createPanelFixture();
  assert.equal(sim.api.saveParameter('ACC', 4), true);
  assert.equal(sim.api.saveParameter('FUn.SCS', 'YES'), true);
  assert.equal(sim.api.saveParameter('ACC', 6), true);
  const motor = sim.api.getConfig().motor;
  assert.equal(sim.api.saveParameter('FUn.FCS', 'rEC', 1999), false);
  assert.equal(sim.api.saveParameter('FUn.FCS', 'rEC', 2000), true);
  const config = sim.api.getConfig();
  assert.equal(config.parameters.ACC, 4);
  assert.equal(config.parameters['FUn.FCS'], 'nO');
  assert.deepEqual(config.motor, motor);
});
test('hidden PI monitor cannot be entered until PI is enabled', () => {
  const sim = createPanelFixture();
  assert.equal(sim.canNavigate('SUP.rPF'), false);
  const before = sim.panelSnapshot();
  sim.navigate('SUP.rPF');
  assert.deepEqual(sim.panelSnapshot(), before);
  assert.equal(sim.api.saveParameter('FUn.PI.PIF', 'AI1'), true);
  assert.equal(sim.canNavigate('SUP.rPF'), true);
  assert.equal(sim.api.getConfig().parameters['FUn.rrS'], 'nO');
});
test('direction explanation follows reverse priority and PFO', () => {
  const sim = createPanelFixture();
  assert.equal(sim.api.saveParameter('FUn.tCC.tCt', 'LEL'), true);
  change(sim, 'inputs', 'LI1', true);
  change(sim, 'inputs', 'LI2', true);
  sim.api.advance(.1);
  assert.equal(sim.readings().direction, -1);
  assert.match(text(sim), /En marcha atrás/);
  change(sim, 'inputs', 'LI1', false);
  change(sim, 'inputs', 'LI2', false);
  sim.api.advance(.1);
  // Reset via import creates a stopped fixture while preserving the programming.
  const config = sim.api.getConfig();
  config.parameters['FUn.tCC.tCt'] = 'PFO';
  assert.equal(sim.api.importText(JSON.stringify(config)).ok, true);
  sim.api.advance(.01);
  change(sim, 'inputs', 'LI1', true);
  change(sim, 'inputs', 'LI2', true);
  sim.api.advance(.1);
  assert.equal(sim.readings().direction, 1);
  assert.match(text(sim), /En marcha adelante/);
});
test('three-wire reverse pulse remains described as reverse after release', () => {
  const sim = createPanelFixture();
  assert.equal(sim.api.saveParameter('FUn.tCC.ACt', '3C', 2000), true);
  sim.api.advance(.01);
  change(sim, 'inputs', 'LI1', true);
  sim.api.advance(.01);
  change(sim, 'inputs', 'LI3', true);
  sim.api.advance(.01);
  change(sim, 'inputs', 'LI3', false);
  sim.api.advance(.1);
  assert.equal(sim.readings().direction, -1);
  assert.match(text(sim), /En marcha atrás/);
});
test('selected HS2 replaces HSP in analog diagnosis', () => {
  const sim = createPanelFixture();
  assert.equal(sim.api.saveParameter('FUn.HSP.LIA', 'LI4'), true);
  assert.equal(sim.api.saveParameter('FUn.HSP.HS2', 40), true);
  change(sim, 'inputs', 'LI4', true); // Default PS2 would otherwise select SP3.
  assert.equal(sim.api.saveParameter('FUn.PS2.LIA', 'nO'), true);
  change(sim, 'inputs', 'LI1', true);
  sim.api.advance(.1);
  assert.equal(sim.readings().activeHighSpeed, 40);
  assert.match(text(sim), /HS2 = 40 Hz/);
  assert.doesNotMatch(text(sim), /HSP = 50 Hz/);
});
test('PI manual uses SP4; automatic uses PI3 with both reference inputs', () => {
  const sim = createPanelFixture();
  assert.equal(sim.api.saveParameter('FUn.PI.PIF', 'AI1'), true);
  assert.equal(sim.api.saveParameter('FUn.PI.PAU', 'LI2'), true);
  assert.equal(sim.api.saveParameter('FUn.PI.Pr2', 'LI3'), true);
  assert.equal(sim.api.saveParameter('FUn.PI.Pr4', 'LI4'), true);
  change(sim, 'inputs', 'LI4', true);
  change(sim, 'inputs', 'LI1', true);
  sim.api.advance(.1);
  assert.match(text(sim), /PI en manual: la velocidad la fija SP4/);
  assert.doesNotMatch(text(sim), /en lugar de AI1|Consigna por AI1/);
  change(sim, 'inputs', 'LI3', true);
  change(sim, 'inputs', 'LI2', true);
  sim.api.advance(.1);
  assert.match(text(sim), /Regulación PI automática: referencia PI3 = 60/);
  assert.doesNotMatch(text(sim), /Velocidad preseleccionada/);
});
test('idle held shaft does not claim rising current or heat', () => {
  const sim = createPanelFixture();
  change(sim, 'inputs', 'shaftHeld', true);
  sim.api.advance(.1);
  assert.match(text(sim), /Sin salida energizada, retenerlo no produce corriente/);
  assert.equal(sim.readings().LCr, 0);
});
test('invalid import is an error value and cannot replace configuration', () => {
  const sim = createPanelFixture();
  const before = sim.api.getConfig();
  assert.equal(sim.api.importText('{').ok, false);
  assert.deepEqual(sim.api.getConfig(), before);
});
test('manufacturer PDF page mappings and model-bound explanations', () => {
  const sim = createPanelFixture();
  assert.equal(manualUrl('user'), documents.find(document => document.id === 'user').sourceUrl + '#page=53');
  assert.equal(manualUrl('technical'), documents.find(document => document.id === 'technical').sourceUrl + '#page=1');
  assert.deepEqual(manualLink({
    manual: 'user',
    page: 22
  }), {
    url: documents.find(document => document.id === 'user').sourceUrl + '#page=57',
    page: 57,
    label: 'Manual, pág. 56, PDF 57'
  });
  assert.equal(manualLink({
    manual: 'technical',
    page: 119
  }).page, 56);
  assert.deepEqual(manualLink({
    manual: 'technical',
    page: 101
  }), {
    url: documents.find(document => document.id === 'technical').sourceUrl + '#page=38',
    page: 38,
    label: 'Manual técnico, pág. 101, PDF 38'
  });
  assert.match(PARAMETERS['FUn.AP1'].text, /PI activo/);
  assert.match(PARAMETERS['FUn.PI.PAU'].text, /SP4/);
  assert.match(FAULTS.OCF.simulator, /demanda magnetizante/);
  assert.equal(FAULTS.SCF.logicReset, false);
  assert.equal(FAULTS.SOF.logicReset, true);
  assert.equal(FAULTS.SOF.autoReset, false);
});
