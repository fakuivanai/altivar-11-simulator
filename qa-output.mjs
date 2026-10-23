// Run after build: node qa-output.mjs [output directory].
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const output = resolve(process.argv[2] || 'qa-output');
await mkdir(output, {recursive: true});
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless: true, executablePath: process.env.BROWSER_PATH,
  args: ['--no-sandbox', '--disable-dev-shm-usage']});
const checks = [], errors = [], externalRequests = [], inputs = {};
try {
  for (const name of ['Simulador de variador.html', 'Simulador de variador, guía de estudio.html']) {
    const html = await readFile(join(root, name), 'utf8');
    inputs[name] = createHash('sha256').update(html).digest('hex');
    assert.doesNotMatch(html, /\/home\/|\/Users\/|[A-Z]:\\Users\\|scratch-workspaces/);
    const page = await browser.newPage({viewport: {width: 1280, height: 720}});
    page.on('pageerror', error => errors.push(String(error)));
    page.on('request', request => {
      if (!/^(file|blob|data|about):/.test(request.url())) externalRequests.push(request.url());
    });
    await page.goto(pathToFileURL(join(root, name)).href);
    await page.waitForFunction(() => !!window.VFDSimulator);
    await page.locator('#LI2').click();
    await page.waitForFunction(() => VFDSimulator.getState().rpm < -500);
    const reverse = await page.evaluate(() => VFDSimulator.getState());
    assert.ok(reverse.currentLag < Math.PI / 2 && reverse.regenerativePower === 0);
    assert.doesNotMatch(await page.locator('#scope-summary').innerText(), /devuelve energía/);
    checks.push({name: name + ': reverse motoring', ok: true});
    const configuration = await page.evaluate(() => VFDSimulator.getConfig());
    configuration.inputs.LI1 = false;
    configuration.inputs.LI2 = false;
    configuration.inputs.outputConnections.U = false;
    configuration.parameters['FUn.AdC.ACt'] = 'Ct';
    const result = await page.evaluate(text => VFDSimulator.importText(text), JSON.stringify(configuration));
    assert.equal(result.ok, true);
    await page.waitForFunction(() => VFDSimulator.getState().outputMode === 'dc' && VFDSimulator.getState().phaseCurrentV > 1.4);
    const dc = await page.evaluate(() => VFDSimulator.getState());
    assert.equal(dc.phaseCurrentU, 0);
    assert.equal(dc.phaseCurrentV, dc.phaseCurrentW);
    assert.equal(dc.regenerativePower, 0);
    assert.ok(dc.voltage > 0);
    assert.match(await page.locator('#scope-summary').innerText(), /entre V y W/);
    assert.equal(await page.locator('#scope-summary').evaluate(element => {
      const panel = element.closest('.tab-panel');
      return element.getBoundingClientRect().bottom <= panel.getBoundingClientRect().bottom;
    }), true);
    await page.screenshot({path: join(output, name.startsWith('Simulador de variador,') ? 'study-dc.png' : 'main-dc.png')});
    checks.push({name: name + ': open-U DC injection', ok: true});
    await page.close();
  }
} finally {
  await browser.close();
  await writeFile(join(output, 'receipt.json'), JSON.stringify({inputs, checks, errors, externalRequests}, null, 2) + '\n');
}
assert.deepEqual(errors, []);
assert.deepEqual(externalRequests, []);
console.log(checks.length + ' final-output checks passed.');
