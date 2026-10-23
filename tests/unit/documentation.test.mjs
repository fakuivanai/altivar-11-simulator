import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CATALOG } from '../../configuration.ts';
import { MODEL_FACT_GROUPS, renderDocumentation } from '../../documentation.ts';

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
