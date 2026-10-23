import assert from 'node:assert/strict';
import { test } from '@playwright/test';
import { openAudioFixture } from '../helpers/audio-fixture.mjs';
import { assertFixtureClean } from '../helpers/bundle-fixture.mjs';
test.beforeEach(async ({
  page
}, testInfo) => {
  await openAudioFixture(page, testInfo);
});
test.afterEach(async ({
  page
}) => {
  assertFixtureClean(page);
});
test('Held Enter uses the keypad timer without native repeat clicks', async ({
  page
}) => {
  // Native protocol round trips must not consume the control's repeat delay.
  const start = Date.now();
  await page.clock.install({
    time: start
  });
  await page.clock.pauseAt(start + 10000);
  await page.locator('#up').focus();
  await page.keyboard.down('Enter');
  for (let k = 0; k < 5; k++) await page.keyboard.down('Enter');
  assert.equal(await page.evaluate(() => fixture.keys.length), 1);
  assert.equal(await page.evaluate(() => fixture.nativeClicks), 0);
  await page.clock.runFor(450);
  assert.equal(await page.evaluate(() => fixture.keys.length), 2);
  await page.keyboard.up('Enter');
  const released = await page.evaluate(() => fixture.keys.length);
  await page.clock.runFor(180);
  assert.equal(await page.evaluate(() => fixture.keys.length), released);
  await page.locator('#up').click();
  assert.equal(await page.evaluate(() => fixture.keys.length), released + 1);
  await page.evaluate(() => document.getElementById('up').click());
  assert.equal(await page.evaluate(() => fixture.keys.length), released + 2);
});
test('ENT waits for release through native Enter and Space repeats', async ({
  page
}) => {
  await page.locator('#ent').focus();
  for (const key of ['Enter', 'Space']) {
    const before = await page.evaluate(() => fixture.enters);
    await page.keyboard.down(key);
    for (let k = 0; k < 4; k++) await page.keyboard.down(key);
    assert.equal(await page.evaluate(() => fixture.enters), before);
    await page.keyboard.up(key);
    assert.equal(await page.evaluate(() => fixture.enters), before + 1);
  }
  assert.equal(await page.evaluate(() => fixture.nativeClicks), 0);
});
test('Sound starts off and explicit off suspends and mutes it', async ({
  page
}) => {
  assert.equal(await page.evaluate(() => audio.length), 0);
  assert.equal(await page.locator('#sound-toggle').getAttribute('aria-pressed'), 'false');
  await page.locator('#sound-toggle').click();
  await page.waitForFunction(() => audio[0]?.state === 'running');
  await page.locator('#sound-toggle').click();
  await page.waitForFunction(() => audio[0].state === 'suspended');
  assert.equal(await page.evaluate(() => audio[0].gains[0].gain.value), 0);
  assert.equal(await page.locator('#sound-toggle').getAttribute('aria-pressed'), 'false');
});
test('Visibility pauses audio while preserving the enabled preference', async ({
  page
}) => {
  await page.locator('#sound-toggle').click();
  await page.waitForFunction(() => audio[0]?.state === 'running');
  await page.evaluate(() => setHidden(true));
  await page.waitForFunction(() => audio[0].state === 'suspended');
  await page.evaluate(() => fixture.setReadings({
    output: {
      frequency: 40
    }
  }));
  assert.equal(await page.locator('#sound-toggle').getAttribute('aria-pressed'), 'true');
  const before = await page.evaluate(() => audio[0].currentTime);
  await page.waitForTimeout(150);
  assert.ok(Math.abs((await page.evaluate(() => audio[0].currentTime)) - before) < .02);
  await page.evaluate(() => setHidden(false));
  await page.waitForFunction(() => audio[0].state === 'running');
  await page.waitForFunction(() => Math.abs(audio[0].oscillators[3].frequency.value - 80) < 1);
  await page.evaluate(() => fixture.setReadings({
    output: {
      frequency: 10
    }
  }));
  await page.waitForFunction(() => Math.abs(audio[0].oscillators[3].frequency.value - 20) < 1);
  assert.equal(await page.locator('#sound-toggle').getAttribute('aria-pressed'), 'true');
});
test('Visibility cannot enable sound after the user turns it off', async ({
  page
}) => {
  await page.locator('#sound-toggle').click();
  await page.locator('#sound-toggle').click();
  await page.evaluate(() => {
    setHidden(true);
    setHidden(false);
  });
  await page.waitForFunction(() => audio[0].state === 'suspended');
  assert.equal(await page.locator('#sound-toggle').getAttribute('aria-pressed'), 'false');
});
test('A delayed resume cannot undo a subsequent off command', async ({
  page
}) => {
  await page.evaluate(() => {
    audioMode = 'delay';
  });
  await page.locator('#sound-toggle').click();
  await page.waitForFunction(() => pendingResumes.length === 1);
  await page.locator('#sound-toggle').click();
  await page.evaluate(() => pendingResumes.shift().resolve());
  await page.waitForFunction(() => audio[0].state === 'suspended');
  assert.equal(await page.locator('#sound-toggle').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.evaluate(() => audio[0].gains[0].gain.value), 0);
});
test('Hiding during a delayed resume keeps audio paused until visible', async ({
  page
}) => {
  await page.evaluate(() => {
    audioMode = 'delay';
  });
  await page.locator('#sound-toggle').click();
  await page.evaluate(() => setHidden(true));
  await page.evaluate(() => pendingResumes.shift().resolve());
  await page.waitForFunction(() => audio[0].state === 'suspended');
  assert.equal(await page.locator('#sound-toggle').getAttribute('aria-pressed'), 'true');
  await page.evaluate(() => {
    audioMode = 'normal';
    setHidden(false);
  });
  await page.waitForFunction(() => audio[0].state === 'running');
  assert.equal(await page.evaluate(() => audio.length), 1);
});
test('A stale resume failure cannot report an error after off', async ({
  page
}) => {
  await page.evaluate(() => {
    audioMode = 'delay';
  });
  await page.locator('#sound-toggle').click();
  await page.locator('#sound-toggle').click();
  await page.evaluate(() => pendingResumes.shift().reject());
  await page.waitForTimeout(30);
  assert.deepEqual(await page.evaluate(() => fixture.messages), []);
  assert.equal(await page.locator('#sound-toggle').getAttribute('aria-pressed'), 'false');
});
test('An active resume failure returns the toggle to off and reports it', async ({
  page
}) => {
  await page.evaluate(() => {
    audioMode = 'reject';
  });
  await page.locator('#sound-toggle').click();
  await page.waitForFunction(() => fixture.messages.length === 1);
  await page.waitForFunction(() => audio[0].state === 'suspended');
  assert.equal(await page.locator('#sound-toggle').getAttribute('aria-pressed'), 'false');
});
test('Disposal closes audio and invalidates pending resume and visibility work', async ({
  page
}) => {
  await page.evaluate(() => {
    audioMode = 'delay';
  });
  await page.locator('#sound-toggle').click();
  await page.evaluate(() => fixture.dispose());
  await page.waitForFunction(() => audio[0].state === 'closed');
  await page.evaluate(() => pendingResumes.shift().resolve());
  await page.evaluate(() => {
    setHidden(true);
    setHidden(false);
  });
  await page.waitForTimeout(30);
  assert.equal(await page.evaluate(() => audio[0].state), 'closed');
  assert.deepEqual(await page.evaluate(() => fixture.messages), []);
  assert.equal(await page.evaluate(() => pendingResumes.length), 0);
});
test('Fullscreen entry and exit denial report a status without an unhandled rejection', async ({
  page
}) => {
  await page.evaluate(() => {
    document.documentElement.requestFullscreen = () => Promise.reject(new Error('Controlled entry denial'));
  });
  await page.locator('#fullscreen-toggle').click();
  await page.waitForFunction(() => fixture.messages.length === 1);
  assert.equal(await page.locator('#fullscreen-toggle').getAttribute('aria-pressed'), 'false');
  await page.evaluate(() => {
    Object.defineProperty(document, 'fullscreenElement', {
      get: () => document.documentElement,
      configurable: true
    });
    document.exitFullscreen = () => Promise.reject(new Error('Controlled exit denial'));
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  await page.locator('#fullscreen-toggle').click();
  await page.waitForFunction(() => fixture.messages.length === 2);
  assert.equal(await page.locator('#fullscreen-toggle').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await page.evaluate(() => fixture.messages), ['No se pudo cambiar a pantalla completa.', 'No se pudo cambiar a pantalla completa.']);
});
