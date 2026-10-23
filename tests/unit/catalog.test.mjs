import assert from 'node:assert/strict';
import { test } from 'node:test';
import catalog from '../../catalog-final.json' with { type: 'json' };
import { PARAMETER_IDS, MONITORS } from '../../parameter-types.ts';
test('The complete catalog matches the typed registry and manufacturer page ranges', () => {
  const settings = catalog.filter(item => item.readonly !== true);
  const monitors = catalog.filter(item => item.readonly === true);
  assert.equal(catalog.length, 82);
  assert.equal(new Set(catalog.map(item => item.id)).size, 82);
  assert.equal(settings.length, 74);
  assert.equal(monitors.length, 8);
  assert.deepEqual(new Set(PARAMETER_IDS), new Set(settings.map(item => item.id)));
  assert.deepEqual(new Set(MONITORS.map(code => 'SUP.' + code)), new Set(monitors.map(item => item.id)));
  const number = value => typeof value === 'number' && Number.isFinite(value);
  for (const item of catalog) {
    assert.equal(item.id, [...item.path, item.code].join('.'), item.id);
    assert.ok(typeof item.label === 'string' && item.label.trim(), item.id);
    assert.ok(['user', 'technical'].includes(item.source.manual), item.id);
    const [minimum, maximum] = item.source.manual === 'user' ? [18, 33] : [64, 124];
    assert.ok(Number.isInteger(item.source.page) && item.source.page >= minimum && item.source.page <= maximum, item.id);
    if (item.readonly === true) {
      assert.deepEqual(item.path, ['SUP'], item.id);
      assert.equal(Object.hasOwn(item, 'default'), false, item.id);
    } else if (item.choices) {
      assert.ok(item.choices.length > 0 && item.choices.includes(item.default), item.id);
      assert.equal(typeof item.runEditable, 'boolean', item.id);
    } else {
      assert.ok(['min', 'max', 'step', 'default'].every(key => number(item[key])), item.id);
      assert.ok(item.min <= item.default && item.default <= item.max && item.step > 0, item.id);
      assert.equal(typeof item.runEditable, 'boolean', item.id);
    }
  }
});
