import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CATALOG } from '../../configuration.ts';
import { MODEL_FACT_GROUPS, renderDocumentation } from '../../documentation.ts';
import { displayNumber, inputNumber } from '../../format.ts';
import { readableCondition } from '../../guide-content.ts';

const source = () => readFileSync(new URL('../../documentation.html', import.meta.url), 'utf8');
test('Every documented model group covers every executable constant', () => {
  const html = renderDocumentation(source());
  for (const group of MODEL_FACT_GROUPS) {
    assert.deepEqual(Object.keys(group.source).sort(), Object.keys(group.descriptions).sort(), group.id);
    for (const key of Object.keys(group.source)) {
      assert(group.descriptions[key][0].length > 8, group.id + '.' + key);
      assert.equal(html.split('data-model-fact="' + group.id + '.' + key + '"').length, 2);
    }
  }
});
test('Generated catalog covers every parameter and monitor with its reference', () => {
  const html = renderDocumentation(source());
  for (const item of CATALOG) {
    assert.equal(html.split('data-parameter="' + item.id + '"').length, 2, item.id);
    assert(html.includes(item.label.replaceAll('&', '&amp;')), item.id);
  }
  for (const diagnostic of ['ratedTorque', 'ratedCurrent', 'powerFactor', 'noLoadCurrent', 'lockedCurrent', 'breakdownSlip'])
    assert(html.includes('data-fit="' + diagnostic + '"'));
  assert(!html.includes('{{'));
});
test('Documentation fails its build for missing, repeated or unknown generated sections', () => {
  assert.throws(() => renderDocumentation(source().replace('{{MODEL_FACTS}}', '')), /Missing or repeated/);
  assert.throws(() => renderDocumentation(source() + '{{MODEL_FACTS}}'), /Missing or repeated/);
  assert.throws(() => renderDocumentation(source() + '{{UNKNOWN}}'), /Unknown/);
});

test('Spanish readings and native number inputs share three significant figures without losing small values', () => {
  for (const [value, display, input] of [
    [1.39489, '1,39', '1.39'], [-33.579, '-33,6', '-33.6'],
    [0.000001, '0,000001', '0.000001'], [999.99, '1000', '1000'],
    [1.78478e-14, '0', '0'], [-1e-15, '0', '0'],
  ]) {
    assert.equal(displayNumber(value), display);
    assert.equal(inputNumber(value), input);
    assert(Number.isFinite(Number(inputNumber(value))));
  }
});
test('The catalog uses study explanations, written conditions and Spanish numeric values', () => {
  const html = renderDocumentation(source());
  assert(html.includes('PS2 / LIA distinto de nO'));
  assert(html.includes('PI / PIF igual a AI1 y PI / Pr2 distinto de nO'));
  assert(!html.includes('Esperas1s'));
  assert(!html.includes('FUn.PI.PIF = AI1'));
  assert(!html.includes('FUn.PI.Pr2 != nO'));
  assert(html.includes('<td>1,47</td>'));
  assert(html.includes('mH</td>'));
  for (const key of ['inputPower', 'shaftPower', 'airGapPower', 'statorCopperLoss', 'rotorCopperLoss', 'efficiency', 'residual'])
    assert(html.includes('data-loss-balance="' + key + '"'));
  assert(!html.includes('1,39489'));
  assert(!/0,0{10}/.test(html));
  assert.equal(readableCondition('FUn.PI.PIF = AI1 y FUn.tLS > 0'), 'PI / PIF igual a AI1 y tLS mayor que 0');
});
test('All generated tables follow the physical explanation and reading instructions', () => {
  const html = renderDocumentation(source());
  const narrative = html.indexOf('id="observar"');
  assert(narrative > html.indexOf('id="control"'));
  for (const table of ['data-fit=', 'data-model-fact=', 'data-parameter='])
    assert(html.indexOf(table) > narrative, table);
});
