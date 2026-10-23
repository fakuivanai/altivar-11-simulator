import assert from 'node:assert/strict';
import { test } from '@playwright/test';
import { openRendererFixture } from '../helpers/renderer-fixture.mjs';
import { assertFixtureClean } from '../helpers/bundle-fixture.mjs';
function decode(sample) {
  return Buffer.from(sample.data, 'base64');
}
function assertGeometry(sample) {
  assert.ok(sample.shaded > sample.width * sample.height * .1, 'The canvas must contain shaded 3D geometry');
  assert.ok(sample.shaded < sample.width * sample.height * .8, 'The motor must fit inside a white canvas');
  assert.ok(sample.minX > 1 && sample.minY > 1 && sample.maxX < sample.width - 2 && sample.maxY < sample.height - 2, 'Geometry must not be clipped at the canvas edges');
}
function assertLayout(before, after) {
  assert.deepEqual(after.canvas, before.canvas, 'Changing backing resolution must not move or resize the canvas');
  assert.deepEqual(after.button, before.button, 'Changing backing resolution must not move neighboring controls');
}
async function restoreQuarterTurn(page) {
  await page.evaluate(() => {
    motorFixture.sample(Math.PI / 2);
    motorFixture.lose();
  });
  await page.waitForFunction(() => motorFixture.metrics().losses === 1);
  await page.evaluate(() => motorFixture.restore());
  await page.waitForFunction(() => motorFixture.metrics().restorations === 1);
}
test.use({
  viewport: {
    width: 800,
    height: 600
  }
});
test.beforeEach(async ({
  page
}, testInfo) => {
  await openRendererFixture(page, testInfo);
});
test.afterEach(async ({
  page
}) => {
  assertFixtureClean(page);
});
test.describe('renderer at device scale 1', () => {
  test.use({
    deviceScaleFactor: 1
  });
  test('native WebGL renders shaded geometry with valid buffers and program', async ({
    page
  }) => {
    const before = await page.evaluate(() => motorFixture.metrics());
    const zero = await page.evaluate(() => motorFixture.sample(0));
    assertGeometry(zero);
    assert.equal(zero.width, 300);
    assert.equal(zero.height, 175);
    const after = await page.evaluate(() => motorFixture.metrics());
    assert.equal(after.dpr, 1);
    assertLayout(before, after);
    assert.deepEqual(after.live, {
      buffers: 2,
      programs: 1,
      shaders: 0
    });
    assert.deepEqual(await page.evaluate(() => motorFixture.resourceHandlesValid()), {
      buffers: true,
      programs: true
    });
  });
  test('a quarter turn rotates the radial mark and a full turn restores the image', async ({
    page
  }) => {
    const zero = await page.evaluate(() => motorFixture.sample(0));
    const quarter = await page.evaluate(() => motorFixture.sample(Math.PI / 2));
    const full = await page.evaluate(() => motorFixture.sample(2 * Math.PI));
    const zeroBytes = decode(zero),
      quarterBytes = decode(quarter);
    let changed = 0;
    for (let i = 0; i < zeroBytes.length; i += 4) {
      if (zeroBytes[i] !== quarterBytes[i] || zeroBytes[i + 1] !== quarterBytes[i + 1] || zeroBytes[i + 2] !== quarterBytes[i + 2]) changed++;
    }
    assert.ok(changed > 100, 'The radial reference mark must visibly rotate');
    assert.deepEqual(decode(full), zeroBytes, 'A complete physical turn must return the identical image');
  });
  test('context restoration recreates resources and redraws the last angle', async ({
    page
  }) => {
    const before = await page.evaluate(() => motorFixture.metrics());
    await page.evaluate(() => motorFixture.sample(0));
    const after = await page.evaluate(() => motorFixture.metrics());
    const quarter = await page.evaluate(() => motorFixture.sample(Math.PI / 2));
    await page.evaluate(() => motorFixture.lose());
    await page.waitForFunction(() => motorFixture.metrics().losses === 1);
    const lost = await page.evaluate(() => motorFixture.metrics());
    assert.equal(lost.visibility, 'hidden');
    assert.equal(lost.fallbackVisible, true);
    assert.equal(lost.fallbackText, 'Se perdió la vista 3D. Esperando recuperar WebGL.');
    assertLayout(after, lost);
    await page.evaluate(() => motorFixture.draw(Math.PI / 2));
    await page.evaluate(() => motorFixture.restore());
    await page.waitForFunction(() => motorFixture.metrics().restorations === 1);
    const restored = await page.evaluate(() => motorFixture.metrics());
    assert.equal(restored.fallbackVisible, false);
    assert.equal(restored.visibility, before.visibility);
    assert.deepEqual(restored.live, {
      buffers: 2,
      programs: 1,
      shaders: 0
    });
    assert.deepEqual(restored.created, {
      buffers: 4,
      programs: 2,
      shaders: 4
    });
    assert.deepEqual(decode(await page.evaluate(() => motorFixture.restoredPixels())), decode(quarter), 'Restoration must redraw the last physical angle without another draw call');
    assertLayout(after, restored);
  });
  test('idempotent disposal releases resources after restoration and removes its fallback', async ({
    page
  }) => {
    const before = await page.evaluate(() => motorFixture.metrics());
    await restoreQuarterTurn(page);
    await page.evaluate(() => motorFixture.dispose());
    const disposed = await page.evaluate(() => motorFixture.metrics());
    assert.deepEqual(disposed.live, {
      buffers: 0,
      programs: 0,
      shaders: 0
    });
    assert.deepEqual(disposed.deleted, {
      buffers: 2,
      programs: 1,
      shaders: 4
    });
    assert.deepEqual(await page.evaluate(() => motorFixture.releasedHandlesInvalid()), {
      buffers: true,
      programs: true
    });
    assert.equal(disposed.fallbackCount, 0);
    assert.equal(disposed.visibility, before.visibility);
    assert.match(await page.evaluate(() => motorFixture.drawAfterDispose()), /después de liberar/);
  });
});
test.describe('renderer at device scale 2', () => {
  test.use({
    deviceScaleFactor: 2
  });
  test('four canvas sizes retain CSS layout and visible perspective geometry', async ({
    page
  }) => {
    for (const [width, height] of [[300, 175], [280, 160], [320, 180], [160, 220]]) {
      await page.evaluate(([width, height]) => motorFixture.resize(width, height), [width, height]);
      const layout = await page.evaluate(() => motorFixture.metrics());
      const sample = await page.evaluate(() => motorFixture.sample(Math.PI / 2));
      const sized = await page.evaluate(() => motorFixture.metrics());
      assert.equal(sized.dpr, 2);
      assert.equal(sample.width, width * 2);
      assert.equal(sample.height, height * 2);
      assert.equal(sized.canvas.width, width);
      assert.equal(sized.canvas.height, height);
      assertLayout(layout, sized);
      assertGeometry(sample);
    }
  });
  test('disposal during context loss prevents a subsequent renderer restart', async ({
    page
  }) => {
    await page.evaluate(() => {
      motorFixture.resize(160, 220);
      motorFixture.sample(Math.PI / 2);
      motorFixture.lose();
    });
    await page.waitForFunction(() => motorFixture.metrics().losses === 1);
    assert.equal((await page.evaluate(() => motorFixture.metrics())).fallbackVisible, true);
    await page.evaluate(() => motorFixture.dispose());
    const stopped = await page.evaluate(() => motorFixture.metrics());
    assert.equal(stopped.fallbackCount, 0);
    assert.equal(stopped.visibility, '');
    await page.evaluate(() => motorFixture.restore());
    await page.waitForFunction(() => motorFixture.metrics().restorations === 1);
    const noRestart = await page.evaluate(() => motorFixture.metrics());
    assert.deepEqual(noRestart.created, stopped.created, 'A disposed renderer must not recreate resources on restoration');
    assert.deepEqual(noRestart.live, {
      buffers: 0,
      programs: 0,
      shaders: 0
    });
    assert.equal(noRestart.fallbackCount, 0);
  });
});
