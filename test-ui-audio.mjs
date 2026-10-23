// Browser regressions for the actual keypad and optional audio components.
// Run: node test-ui-audio.mjs [output directory]. PLAYWRIGHT_MODULE and BROWSER_PATH
// follow the other browser checks. Visibility and pending audio requests use explicit
// fixtures; the test does not claim physical background-tab or speaker validation.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {transformAsync} from '@babel/core';
import solid from 'babel-preset-solid';
import typescript from '@babel/preset-typescript';

const root = fileURLToPath(new URL('.', import.meta.url));
const output = resolve(process.argv[2] || 'qa-ui-audio-output');
await mkdir(output, {recursive: true});
const compile = async (code, filename) => (await transformAsync(code, {
  filename, babelrc: false, configFile: false,
  presets: [[solid, {generate: 'dom'}], [typescript, {onlyRemoveTypeImports: true}]],
})).code;
const fixture = await compile(`
  import {createSignal} from 'solid-js';
  import {render} from 'solid-js/web';
  import {SimulatorProvider} from './ui';
  import {DrivePanel} from './DrivePanel';
  import {FullscreenButton, SoundToggle} from './HeaderControls';
  const [readings, setReadings] = createSignal({outputMode:'ac', frequency:25, current:1,
    voltage:115, rpm:700, switchingFrequency:4});
  const fixture = window.fixture = {keys:[], enters:0, messages:[], nativeClicks:0};
  fixture.setReadings = value => setReadings(previous => ({...previous, ...value}));
  document.addEventListener('click', event => {
    if (event.target.closest('button.key') && event.detail === 0) fixture.nativeClicks += 1;
  });
  const sim = {
    state:{config:{motor:{speedRPM:1350, voltage:230, current:2.1}}}, readings,
    key: value => fixture.keys.push(value), enter: () => fixture.enters += 1,
    escapeKey: () => {}, panelSnapshot: () => ({editing:null}),
    display: () => ({fault:false,text:'rdY',route:'',caption:''}), flashing: () => false,
    status: message => fixture.messages.push(message),
  };
  fixture.dispose = render(() => <SimulatorProvider value={sim}>
    <DrivePanel /><SoundToggle /><FullscreenButton />
  </SimulatorProvider>, document.getElementById('app'));
`, join(root, 'ui-audio-fixture.tsx'));
const bundled = await build({
  absWorkingDir: root, stdin: {contents: fixture, resolveDir: root, loader: 'js'},
  bundle: true, write: false, format: 'iife', platform: 'browser', conditions: ['browser'],
  target: 'es2020', define: {'process.env.NODE_ENV': '"production"'},
  plugins: [{name: 'solid-jsx', setup(builder) {
    builder.onLoad({filter: /\.tsx$/}, async args => ({
      contents: await compile(await readFile(args.path, 'utf8'), args.path), loader: 'js',
    }));
  }}],
});
const html = '<!doctype html><html lang="es"><meta charset="utf-8">' +
  '<style>.key{width:60px;height:60px}#display,#route{display:none}</style>' +
  '<div id="app"></div><script>' + bundled.outputFiles[0].text.replace(/<\/script/gi, '<\\/script') + '</script>';
const fixturePath = join(output, 'ui-audio-fixture.html');
await writeFile(fixturePath, html);
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless: true, executablePath: process.env.BROWSER_PATH,
  args: ['--no-sandbox', '--disable-dev-shm-usage']});
const cases = [], errors = [], requests = [];

async function check(name, body) {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  page.on('request', request => {
    if (!/^(file|blob|data|about):/.test(request.url())) requests.push(request.url());
  });
  await page.addInitScript(() => {
    window.audio = [];
    window.pendingResumes = [];
    window.audioMode = 'normal';
    window.hiddenFixture = false;
    Object.defineProperty(document, 'hidden', {get: () => window.hiddenFixture, configurable: true});
    Object.defineProperty(document, 'fullscreenEnabled', {get: () => true, configurable: true});
    window.setHidden = value => {
      window.hiddenFixture = value;
      document.dispatchEvent(new Event('visibilitychange'));
    };
    const Original = AudioContext;
    const nativeResume = Original.prototype.resume;
    window.AudioContext = class extends Original {
      constructor(...args) { super(...args); this.gains = []; this.oscillators = []; window.audio.push(this); }
      createGain() { const result = super.createGain(); this.gains.push(result); return result; }
      createOscillator() { const result = super.createOscillator(); this.oscillators.push(result); return result; }
      resume() {
        if (window.audioMode === 'reject') return Promise.reject(new Error('Controlled resume failure'));
        if (window.audioMode === 'delay') return new Promise((resolve, reject) => {
          window.pendingResumes.push({
            resolve: () => nativeResume.call(this).then(resolve, reject),
            reject: () => reject(new Error('Controlled stale resume failure')),
          });
        });
        return nativeResume.call(this);
      }
    };
  });
  try {
    await page.goto(pathToFileURL(fixturePath).href);
    await page.waitForFunction(() => !!window.fixture);
    await body(page);
    cases.push({name, ok: true});
    console.log('PASS', name);
  } catch (error) {
    cases.push({name, ok: false, error: String(error.stack || error)});
    console.log('FAIL', name, String(error));
  } finally { await page.close(); }
}

try {
  await check('Held Enter uses the keypad timer without native repeat clicks', async page => {
    await page.locator('#up').focus();
    await page.keyboard.down('Enter');
    for (let k = 0; k < 5; k++) await page.keyboard.down('Enter');
    assert.equal(await page.evaluate(() => fixture.keys.length), 1);
    assert.equal(await page.evaluate(() => fixture.nativeClicks), 0);
    await page.waitForFunction(() => fixture.keys.length >= 2);
    await page.keyboard.up('Enter');
    const released = await page.evaluate(() => fixture.keys.length);
    await page.waitForTimeout(180);
    assert.equal(await page.evaluate(() => fixture.keys.length), released);
    await page.locator('#up').click();
    assert.equal(await page.evaluate(() => fixture.keys.length), released + 1);
    await page.evaluate(() => document.getElementById('up').click());
    assert.equal(await page.evaluate(() => fixture.keys.length), released + 2);
  });
  await check('ENT waits for release through native Enter and Space repeats', async page => {
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
  await check('Sound starts off and explicit off suspends and mutes it', async page => {
    assert.equal(await page.evaluate(() => audio.length), 0);
    assert.equal(await page.locator('#sound-toggle').getAttribute('aria-pressed'), 'false');
    await page.locator('#sound-toggle').click();
    await page.waitForFunction(() => audio[0]?.state === 'running');
    await page.locator('#sound-toggle').click();
    await page.waitForFunction(() => audio[0].state === 'suspended');
    assert.equal(await page.evaluate(() => audio[0].gains[0].gain.value), 0);
    assert.equal(await page.locator('#sound-toggle').getAttribute('aria-pressed'), 'false');
  });
  await check('Visibility pauses audio while preserving the enabled preference', async page => {
    await page.locator('#sound-toggle').click();
    await page.waitForFunction(() => audio[0]?.state === 'running');
    await page.evaluate(() => setHidden(true));
    await page.waitForFunction(() => audio[0].state === 'suspended');
    await page.evaluate(() => fixture.setReadings({frequency:40}));
    assert.equal(await page.locator('#sound-toggle').getAttribute('aria-pressed'), 'true');
    const before = await page.evaluate(() => audio[0].currentTime);
    await page.waitForTimeout(150);
    assert.ok(Math.abs(await page.evaluate(() => audio[0].currentTime) - before) < .02);
    await page.evaluate(() => setHidden(false));
    await page.waitForFunction(() => audio[0].state === 'running');
    await page.waitForFunction(() => Math.abs(audio[0].oscillators[3].frequency.value - 80) < 1);
    await page.evaluate(() => fixture.setReadings({frequency:10}));
    await page.waitForFunction(() => Math.abs(audio[0].oscillators[3].frequency.value - 20) < 1);
    assert.equal(await page.locator('#sound-toggle').getAttribute('aria-pressed'), 'true');
  });
  await check('Visibility cannot enable sound after the user turns it off', async page => {
    await page.locator('#sound-toggle').click();
    await page.locator('#sound-toggle').click();
    await page.evaluate(() => { setHidden(true); setHidden(false); });
    await page.waitForFunction(() => audio[0].state === 'suspended');
    assert.equal(await page.locator('#sound-toggle').getAttribute('aria-pressed'), 'false');
  });
  await check('A delayed resume cannot undo a subsequent off command', async page => {
    await page.evaluate(() => { audioMode = 'delay'; });
    await page.locator('#sound-toggle').click();
    await page.waitForFunction(() => pendingResumes.length === 1);
    await page.locator('#sound-toggle').click();
    await page.evaluate(() => pendingResumes.shift().resolve());
    await page.waitForFunction(() => audio[0].state === 'suspended');
    assert.equal(await page.locator('#sound-toggle').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.evaluate(() => audio[0].gains[0].gain.value), 0);
  });
  await check('Hiding during a delayed resume keeps audio paused until visible', async page => {
    await page.evaluate(() => { audioMode = 'delay'; });
    await page.locator('#sound-toggle').click();
    await page.evaluate(() => setHidden(true));
    await page.evaluate(() => pendingResumes.shift().resolve());
    await page.waitForFunction(() => audio[0].state === 'suspended');
    assert.equal(await page.locator('#sound-toggle').getAttribute('aria-pressed'), 'true');
    await page.evaluate(() => { audioMode = 'normal'; setHidden(false); });
    await page.waitForFunction(() => audio[0].state === 'running');
    assert.equal(await page.evaluate(() => audio.length), 1);
  });
  await check('A stale resume failure cannot report an error after off', async page => {
    await page.evaluate(() => { audioMode = 'delay'; });
    await page.locator('#sound-toggle').click();
    await page.locator('#sound-toggle').click();
    await page.evaluate(() => pendingResumes.shift().reject());
    await page.waitForTimeout(30);
    assert.deepEqual(await page.evaluate(() => fixture.messages), []);
    assert.equal(await page.locator('#sound-toggle').getAttribute('aria-pressed'), 'false');
  });
  await check('An active resume failure returns the toggle to off and reports it', async page => {
    await page.evaluate(() => { audioMode = 'reject'; });
    await page.locator('#sound-toggle').click();
    await page.waitForFunction(() => fixture.messages.length === 1);
    await page.waitForFunction(() => audio[0].state === 'suspended');
    assert.equal(await page.locator('#sound-toggle').getAttribute('aria-pressed'), 'false');
  });
  await check('Disposal closes audio and invalidates pending resume and visibility work', async page => {
    await page.evaluate(() => { audioMode = 'delay'; });
    await page.locator('#sound-toggle').click();
    await page.evaluate(() => fixture.dispose());
    await page.waitForFunction(() => audio[0].state === 'closed');
    await page.evaluate(() => pendingResumes.shift().resolve());
    await page.evaluate(() => { setHidden(true); setHidden(false); });
    await page.waitForTimeout(30);
    assert.equal(await page.evaluate(() => audio[0].state), 'closed');
    assert.deepEqual(await page.evaluate(() => fixture.messages), []);
    assert.equal(await page.evaluate(() => pendingResumes.length), 0);
  });
  await check('Fullscreen entry and exit denial report a status without an unhandled rejection', async page => {
    await page.evaluate(() => {
      document.documentElement.requestFullscreen = () => Promise.reject(new Error('Controlled entry denial'));
    });
    await page.locator('#fullscreen-toggle').click();
    await page.waitForFunction(() => fixture.messages.length === 1);
    assert.equal(await page.locator('#fullscreen-toggle').getAttribute('aria-pressed'), 'false');
    await page.evaluate(() => {
      Object.defineProperty(document, 'fullscreenElement', {get: () => document.documentElement, configurable: true});
      document.exitFullscreen = () => Promise.reject(new Error('Controlled exit denial'));
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    await page.locator('#fullscreen-toggle').click();
    await page.waitForFunction(() => fixture.messages.length === 2);
    assert.equal(await page.locator('#fullscreen-toggle').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await page.evaluate(() => fixture.messages), [
      'No se pudo cambiar a pantalla completa.', 'No se pudo cambiar a pantalla completa.',
    ]);
  });
} finally {
  const sourceSHA256 = {};
  for (const name of ['ui.tsx', 'DrivePanel.tsx', 'HeaderControls.tsx', 'motor-sound.ts']) {
    sourceSHA256[name] = createHash('sha256').update(await readFile(join(root, name))).digest('hex');
  }
  await writeFile(join(output, 'ui-audio-receipt.json'), JSON.stringify({
    browser: browser.version(), sourceSHA256, fixtureSHA256: createHash('sha256').update(html).digest('hex'),
    cases, errors, requests,
    limits: 'Controlled visibility and delayed-resume fixtures; headless audio graph lifecycle, not physical speaker output or browser chrome.',
  }, null, 2) + '\n');
  await browser.close();
}
assert.deepEqual(errors, []);
assert.deepEqual(requests, []);
assert.ok(cases.every(result => result.ok), 'UI/audio regression failed');
