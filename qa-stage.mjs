// Firefox checks for the projection stage, through native WebDriver BiDi (Node 22+).
// Run: node qa-stage.mjs "Simulador de variador.html" [output folder]
// Opens the file from disk, uses native pointer input, checks behaviour through
// window.VFDSimulator and audits the drawing: wires against wires, wires against
// text, and positioned controls against each other and the stage edges.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {auditStage} from './qa-stage-layout.mjs';
import {spawn} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const file = resolve(process.argv[2] ?? 'Simulador de variador.html');
const guidePage = file.replace(/Simulador de variador\.html$/, 'Simulador de variador, guía de estudio.html');
const output = resolve(process.argv[3] ?? 'qa-stage-output');
await mkdir(output, {recursive: true});
const temporary = await mkdtemp(join(tmpdir(), 'vfd-stage-'));
const firefox = spawn(process.env.FIREFOX_PATH || 'firefox',
  ['--headless', '--no-remote', '--profile', temporary, '--remote-debugging-port', '0', 'about:blank'],
  {stdio: ['ignore', 'pipe', 'pipe']});
let log = '', socket, next = 1, context;
const pending = new Map(), errors = [], requests = [], results = [], layouts = [];
let browserVersion = '';
const htmlSHA256 = createHash('sha256').update(await readFile(file)).digest('hex');
const guideSHA256 = createHash('sha256').update(await readFile(guidePage)).digest('hex');
const command = (method, params = {}) => new Promise((ok, fail) => {
  const id = next++;
  const timer = setTimeout(() => { pending.delete(id); fail(new Error('timeout ' + method)); }, 20000);
  pending.set(id, {ok, fail, timer});
  socket.send(JSON.stringify({id, method, params}));
});
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function evaluate(expression) {
  const result = await command('script.evaluate', {expression, target: {context}, awaitPromise: true, resultOwnership: 'root'});
  if (result.type === 'exception') throw new Error('page exception: ' + JSON.stringify(result.exceptionDetails.text));
  return result.result;
}
async function value(expression) {
  const result = await evaluate(`Promise.resolve(${expression}).then(value => JSON.stringify(value))`);
  return JSON.parse(result.value);
}
async function element(selector) {
  const result = await evaluate(`document.querySelector(${JSON.stringify(selector)})`);
  assert.equal(result.type, 'node', 'missing element ' + selector);
  return {sharedId: result.sharedId};
}
async function pointer(selector, actions) {
  const origin = {type: 'element', element: await element(selector)};
  await command('input.performActions', {context, actions: [{type: 'pointer', id: 'mouse', parameters: {pointerType: 'mouse'},
    actions: [{type: 'pointerMove', x: 0, y: 0, origin}, ...actions]}]});
}
const click = selector => pointer(selector, [{type: 'pointerDown', button: 0}, {type: 'pointerUp', button: 0}]);
const drive = () => value('window.VFDSimulator.getState()');
async function key(selector, key) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  await command('input.performActions', {context, actions: [{type: 'key', id: 'keyboard', actions: [{type: 'keyDown', value: key}, {type: 'keyUp', value: key}]}]});
}
async function check(name, body) {
  try { await body(); results.push({name, ok: true}); console.log('PASS', name); }
  catch (error) { results.push({name, ok: false, error: String(error.message ?? error)}); console.log('FAIL', name, '\n   ', error.message); }
}
async function screenshot(name) {
  const shot = await command('browsingContext.captureScreenshot', {context});
  await writeFile(join(output, name + '.png'), Buffer.from(shot.data, 'base64'));
}

// The same rendered geometry contract is exercised in Chromium.
const AUDIT = '(' + auditStage.toString() + ')()';

try {
  const endpoint = await new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('Firefox did not start: ' + log)), 20000);
    const read = chunk => {
      log += chunk;
      const match = log.match(/WebDriver BiDi listening on (ws:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timer); ok(match[1] + '/session'); }
    };
    firefox.stdout.on('data', read); firefox.stderr.on('data', read);
  });
  socket = new WebSocket(endpoint);
  socket.addEventListener('message', event => {
    const packet = JSON.parse(event.data);
    if ('id' in packet) {
      const request = pending.get(packet.id); if (!request) return;
      pending.delete(packet.id); clearTimeout(request.timer);
      packet.type === 'error' ? request.fail(new Error(JSON.stringify(packet))) : request.ok(packet.result);
    } else if (packet.method === 'log.entryAdded' && packet.params.level === 'error') errors.push(packet.params.text);
    else if (packet.method === 'network.beforeRequestSent') {
      const url = packet.params.request.url;
      if (!/^(file|blob|data|about):/.test(url)) requests.push(url);
    }
  });
  await new Promise((ok, fail) => { socket.addEventListener('open', ok, {once: true}); socket.addEventListener('error', fail, {once: true}); });
  const session = await command('session.new', {capabilities: {alwaysMatch: {}}});
  browserVersion = session.capabilities.browserVersion;
  console.log('Firefox', browserVersion);
  await command('session.subscribe', {events: ['log.entryAdded', 'network.beforeRequestSent']});
  context = (await command('browsingContext.getTree', {})).contexts[0].context;

  for (const [width, height] of [[1280, 720], [1024, 768], [1920, 1080]]) {
    await command('browsingContext.setViewport', {context, viewport: {width, height}});
    for (const [pageName, pageFile] of [['projection', file], ['guide', guidePage]]) {
      await command('browsingContext.navigate', {context, url: pathToFileURL(pageFile).href, wait: 'complete'});
      await sleep(1200);
      await check(`${pageName} layout audit at ${width}x${height}`, async () => {
        const audit = await value(AUDIT);
        layouts.push({page: pageName, width, height, audit});
        assert.ok(audit.counts.wires > 35 && audit.counts.placed > 25, 'audit saw too little: ' + JSON.stringify(audit));
        assert.deepEqual(audit.problems, []);
        const page = await value('[document.documentElement.scrollWidth, document.documentElement.scrollHeight, innerWidth, innerHeight]');
        assert.ok(page[0] <= page[2] && page[1] <= page[3], 'page scrolls: ' + page);
      });
      await screenshot(`${pageName}-${width}x${height}`);
    }
  }

  await command('browsingContext.setViewport', {context, viewport: {width: 1280, height: 720}});
  await command('browsingContext.navigate', {context, url: pathToFileURL(file).href, wait: 'complete'});
  await sleep(1500);
  const factory = await value('VFDSimulator.getConfig()');
  await check('ready state with supply and closed fault relay', async () => {
    assert.equal(await value("document.getElementById('display').textContent"), 'rdY');
    const state = await drive();
    assert.equal(state.relay, true); assert.ok(state.dcBus > 300, 'dc bus ' + state.dcBus);
  });
  await check('3D canvas draws the motor', async () => {
    const shot = await command('browsingContext.captureScreenshot', {context, clip: {type: 'element', element: await element('#motor-canvas')}});
    await writeFile(join(output, 'motor.png'), Buffer.from(shot.data, 'base64'));
    const pixels = await value(`(() => {
      const canvas = document.getElementById('motor-canvas'), gl = canvas.getContext('webgl');
      if (!gl) throw new Error('WebGL unavailable in test');
      VFDSimulator.advance(0);
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let shaded = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 245 || pixels[i + 1] < 245 || pixels[i + 2] < 245) shaded += 1;
      return {shaded, total: canvas.width * canvas.height, error: gl.getError()};
    })()`);
    assert.equal(pixels.error, 0);
    assert.ok(pixels.shaded > pixels.total * 0.05, 'canvas lacks geometry: ' + JSON.stringify(pixels));
  });
  await check('LI1 starts the motor; ENT does not', async () => {
    await click('#ent'); await sleep(300);
    assert.equal((await drive()).running, false);
    await click('#LI1'); await sleep(3500);
    const state = await drive();
    assert.ok(state.running && state.rpm > 600, 'rpm ' + state.rpm);
    assert.equal(await value("document.getElementById('LI1').getAttribute('aria-pressed')"), 'true');
  });
  await check('opening W unbalances the phase currents', async () => {
    await click('#phase-W'); await sleep(1500);
    const state = await drive();
    assert.ok(state.currentImbalance > 50, 'imbalance ' + state.currentImbalance);
    assert.ok(Math.abs(state.phaseCurrentW) < 0.01, 'W current ' + state.phaseCurrentW);
    await click('#phase-W'); await sleep(2500);
    assert.ok((await drive()).currentImbalance < 10);
  });
  await check('holding the shaft stalls the motor until release', async () => {
    await pointer('#hold-shaft', [{type: 'pointerDown', button: 0}, {type: 'pause', duration: 1500}]);
    const held = await drive();
    assert.ok(held.rpm < 20, 'rpm while held ' + held.rpm);
    await pointer('#hold-shaft', [{type: 'pointerUp', button: 0}]);
    await sleep(3500);
    assert.ok((await drive()).rpm > 600, 'did not reaccelerate');
  });
  await check('U-V short trips SCF and opens the fault relay', async () => {
    await click('#short-bridge'); await sleep(500);
    const state = await drive();
    assert.equal(state.fault, 'SCF');
    assert.equal(state.relay, false);
    assert.equal(await value("document.getElementById('display').textContent"), 'SCF');
    assert.equal(await value("document.getElementById('short-jumper').getAttribute('visibility')"), 'visible');
    await screenshot('fault-SCF');
  });
  await check('cycling the supply breaker clears the fault', async () => {
    await click('#short-bridge'); await click('#LI1');
    await click('#power-breaker'); await sleep(800);
    assert.equal(await value("document.getElementById('display').textContent"), '');
    await click('#power-breaker'); await sleep(1200);
    const state = await drive();
    assert.equal(state.fault, null);
    assert.equal(await value("document.getElementById('display').textContent"), 'rdY');
  });
  await check('pushbutton mode runs only while pressed', async () => {
    await click('#LI1-mode');
    assert.equal(await value("document.getElementById('LI1-mode').textContent"), 'Pulsador');
    assert.notEqual(await value("document.getElementById('LI1-push').getAttribute('d')"), '');
    await pointer('#LI1', [{type: 'pointerDown', button: 0}, {type: 'pause', duration: 1200}]);
    assert.ok((await drive()).running, 'not running while pressed');
    await pointer('#LI1', [{type: 'pointerUp', button: 0}]); await sleep(200);
    assert.equal((await value('window.VFDSimulator.getConfig()')).inputs.LI1, false);
    await pointer('#LI1', [{type: 'pointerDown', button: 0}]);
    await evaluate("window.dispatchEvent(new Event('blur'))");
    assert.equal((await value('window.VFDSimulator.getConfig()')).inputs.LI1, false);
    await pointer('#LI1', [{type: 'pointerUp', button: 0}]);
    await click('#LI1-mode');
    assert.equal(await value("document.getElementById('LI1-mode').textContent"), 'Interruptor');
  });
  await check('panel keys navigate and ESC returns', async () => {
    await sleep(4000);
    await click('#up');
    const shown = await value("document.getElementById('display').textContent");
    assert.notEqual(shown, 'rdY');
    await click('#esc');
    assert.equal(await value("document.getElementById('display').textContent"), 'rdY');
  });
  await check('native keyboard edits one ramp step and ENT confirms it', async () => {
    const previous = await value('VFDSimulator.getConfig().parameters.ACC');
    await evaluate("VFDSimulator.navigate('ACC')");
    await key('#ent', '\uE007'); await key('#up', '\uE00D');
    assert.equal(await value('VFDSimulator.panel().draft'), Number((previous + .1).toFixed(1)));
    await key('#ent', '\uE00D');
    assert.equal(await value('VFDSimulator.getConfig().parameters.ACC'), Number((previous + .1).toFixed(1)));
    await click('#esc'); await click('#esc');
  });
  await check('potentiometer moves the wiper and AI1 reading', async () => {
    const before = await value("document.getElementById('pot-wiper').getAttribute('d')");
    await evaluate("(() => { const s = document.getElementById('analog-position'); s.value = '90'; s.dispatchEvent(new Event('input', {bubbles: true})); })()");
    assert.equal(await value("document.getElementById('analog-reading').textContent"), 'AI1 4.5 V');
    assert.notEqual(await value("document.getElementById('pot-wiper').getAttribute('d')"), before);
  });
  await check('brake module toggles', async () => {
    await click('#brake-module');
    assert.equal((await value('window.VFDSimulator.getConfig()')).inputs.brakeModule, true);
    await click('#brake-module');
  });
  await check('a refused nameplate change springs back to the stored value', async () => {
    await click('#tab-motor');
    await click('#LI1'); await sleep(1500);
    await evaluate("(() => { const f = document.querySelector('input[aria-label=\"Motor Tensión V\"], #settings .fields input'); f.value = '400'; f.dispatchEvent(new Event('change', {bubbles: true})); })()");
    assert.equal(await value("document.querySelector('#settings .fields input').value"), '0.37');
    assert.match(await value("document.getElementById('status').textContent"), /Detenga el variador/);
    await click('#LI1'); await sleep(4500);
    await evaluate("(() => { const f = document.querySelector('#settings .fields input'); f.value = '0.55'; f.dispatchEvent(new Event('change', {bubbles: true})); })()");
    assert.equal((await value('window.VFDSimulator.getConfig()')).motor.powerKW, 0.55);
  });
  await check('a configuration file loads through the file picker', async () => {
    await click('#tab-files');
    const saved = JSON.parse(await value('window.VFDSimulator.exportText()'));
    saved.parameters.ACC = 7.5;
    const path = join(output, 'config.json');
    await writeFile(path, JSON.stringify(saved));
    await command('input.setFiles', {context, element: await element('#import'), files: [path]});
    await sleep(500);
    assert.equal((await value('window.VFDSimulator.getConfig()')).parameters.ACC, 7.5);
    assert.equal(await value("document.getElementById('file-name').textContent"), 'config.json');
    assert.match(await value("document.getElementById('status').textContent"), /Configuración cargada/);
  });

  // Counts canvas pixels close to a colour, to tell that a trace was drawn.
  const tracePixels = colour => value("(() => { const c = document.getElementById('scope-canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const [r, g, b] = " + JSON.stringify(colour) + "; let n = 0; for (let k = 0; k < d.length; k += 4) if (Math.abs(d[k] - r) < 40 && Math.abs(d[k + 1] - g) < 40 && Math.abs(d[k + 2] - b) < 40 && d[k + 3] > 200) n++; return n; })()");
  const COLOURS = {U: [213, 94, 0], V: [0, 114, 178], W: [0, 158, 115], fundamental: [123, 50, 146]};
  await check('the scope tab draws the PWM voltage, its fundamental and three currents while running', async () => {
    await evaluate('VFDSimulator.importText(' + JSON.stringify(JSON.stringify(factory)) + ')');
    await click('#tab-scope');
    assert.equal(await value("document.getElementById('tab-scope').getAttribute('aria-selected')"), 'true');
    assert.match(await value("document.getElementById('scope-summary').textContent"), /Sin salida/);
    await click('#LI1'); await sleep(4500);
    assert.equal((await drive()).outputMode, 'ac');
    for (const name of ['U', 'V', 'W', 'fundamental']) assert.ok(await tracePixels(COLOURS[name]) > 150, name + ' trace missing');
    const summary = await value("document.getElementById('scope-summary').textContent");
    assert.match(summary, /\d+\.\d Hz/); assert.match(summary, /kHz/); assert.match(summary, /cos φ 0\.\d\d/);
    await screenshot('scope-periods');
  });
  await check('zooming shows individual pulses around the chosen angle', async () => {
    await click('#scope-zoom'); await sleep(300);
    assert.equal(await value("document.getElementById('scope-zoom').getAttribute('aria-pressed')"), 'true');
    assert.ok(await value("document.getElementById('scope-angle') !== null"));
    await screenshot('scope-zoom');
    await click('#scope-periods');
  });
  await check('the voltage selector shows line, phase-to-neutral and pole voltages', async () => {
    for (const kind of ['phase', 'pole', 'line']) {
      await click('#voltage-' + kind); await sleep(300);
      assert.equal(await value("document.getElementById('voltage-" + kind + "').getAttribute('aria-pressed')"), 'true');
      assert.ok(await tracePixels(COLOURS.fundamental) > 150, kind + ': mean voltage trace missing');
      await screenshot('scope-' + kind);
    }
    await click('#scope-zoom'); await click('#voltage-phase'); await sleep(300);
    await screenshot('scope-phase-zoom');
    await click('#voltage-line'); await click('#scope-periods');
  });
  await check('opening W leaves two opposite currents on the scope', async () => {
    await click('#phase-W'); await sleep(1500);
    await screenshot('scope-open-W');
    assert.ok(await tracePixels(COLOURS.U) > 150 && await tracePixels(COLOURS.V) > 150);
    await click('#phase-W'); await sleep(2000);
  });
  await check('sound is off by default and toggles without errors', async () => {
    assert.equal(await value("document.getElementById('sound-toggle').getAttribute('aria-pressed')"), 'false');
    await click('#sound-toggle'); await sleep(600);
    assert.equal(await value("document.getElementById('sound-toggle').getAttribute('aria-pressed')"), 'true');
    await click('#sound-toggle'); await sleep(200);
    assert.equal(await value("document.getElementById('sound-toggle').getAttribute('aria-pressed')"), 'false');
  });
  await check('the fullscreen button appears exactly where the browser supports it', async () => {
    assert.equal(await value("document.getElementById('fullscreen-toggle') !== null"), await value('document.fullscreenEnabled'));
  });
  await evaluate('VFDSimulator.importText(' + JSON.stringify(JSON.stringify(factory)) + ')');

  await check('native held ENT enables 3C and its start pulse stays latched until LI1 opens', async () => {
    await evaluate('VFDSimulator.importText(' + JSON.stringify(JSON.stringify(factory)) + ')');
    await evaluate("VFDSimulator.navigate('FUn.tCC.ACt')");
    await click('#ent'); await click('#up'); await click('#ent');
    assert.equal(await value("VFDSimulator.getConfig().parameters['FUn.tCC.ACt']"), '2C');
    await pointer('#ent', [{type: 'pointerDown', button: 0}, {type: 'pause', duration: 2100}, {type: 'pointerUp', button: 0}]);
    assert.equal(await value("VFDSimulator.getConfig().parameters['FUn.tCC.ACt']"), '3C');
    for (let i = 0; i < 4; i += 1) await click('#esc');
    assert.equal(await value("document.getElementById('LI1-purpose').textContent"), 'Parada');
    assert.equal(await value("document.getElementById('LI2-purpose').textContent"), 'Marcha');
    await click('#LI1'); await click('#LI2'); await sleep(2000);
    assert.equal((await drive()).running, true);
    await click('#LI2'); await sleep(150); assert.equal((await drive()).running, true);
    const audit = await value(AUDIT); layouts.push({page: 'projection', mode: '3C-running', audit});
    assert.deepEqual(audit.problems, []);
    await click('#LI1'); await sleep(4000); assert.equal((await drive()).running, false);
  });
  await command('browsingContext.setViewport', {context, viewport: {width: 1920, height: 1080}});
  await command('browsingContext.navigate', {context, url: pathToFileURL(guidePage).href, wait: 'complete'});
  await sleep(1200);
  const guideText = () => value("document.getElementById('guide').innerText");
  const lowerText = () => value("document.querySelector('.guide-lower').innerText");
  await check('guide explains the ready display and the missing run command', async () => {
    assert.match(await guideText(), /rdY\s*Variador listo/);
    assert.match(await lowerText(), /Sin orden de marcha\. Cierre LI1/);
  });
  await check('guide follows the panel into a parameter and its draft value', async () => {
    await click('#up'); await click('#up');
    assert.match(await guideText(), /Menú|Funciones|Supervisión|Control/);
    await evaluate("VFDSimulator.navigate('ACC')");
    await click('#ent'); await click('#up');
    const text = await guideText();
    assert.match(text, /ACC\s*Tiempo de aceleración/);
    assert.match(text, /En edición\s*3\.1 s/);
    assert.match(text, /Manual, pág\. 57/);
    await click('#esc'); await click('#esc');
  });
  await check('guide lists every setting and navigates on click', async () => {
    const rows = await value("document.querySelectorAll('#guide tr.row').length");
    assert.equal(rows, 82);
    await evaluate("[...document.querySelectorAll('#guide tr.row')].find(r => r.title === 'Tipo de mando').click()");
    assert.equal(await value("document.getElementById('display').textContent"), 'ACt');
    assert.match(await guideText(), /2C\s*Dos hilos/);
    await click('#esc'); await click('#esc'); await click('#esc');
  });
  await check('guide explains an injected fault, then keeps it as the last fault', async () => {
    await click('#short-bridge'); await click('#LI1'); await sleep(600);
    let text = await guideText();
    assert.match(text, /SCF\s*Cortocircuito en el motor/);
    assert.match(text, /En el simulador/);
    assert.match(text, /Eliminar la causa, cortar la red/);
    assert.match(text, /0,4 s/);
    assert.match(await lowerText(), /corto U-V sigue puesto/);
    await click('#short-bridge'); await click('#LI1');
    await click('#power-breaker'); await sleep(700); await click('#power-breaker'); await sleep(800);
    text = await guideText();
    assert.match(text, /Última falla, ya rearmada/);
  });
  await check('guide describes schematic elements on hover', async () => {
    await pointer('#brake-module', []);
    assert.match(await lowerText(), /Módulo de frenado entre PA\/\+ y PC\/-/);
  });
  await check('learning page fits the window without page scroll', async () => {
    const page = await value('[document.documentElement.scrollWidth, document.documentElement.scrollHeight, innerWidth, innerHeight]');
    assert.ok(page[0] <= page[2] && page[1] <= page[3], 'page scrolls: ' + page);
  });
  await screenshot('guide-1920x1080');
  await check('no page errors or external requests', async () => { assert.deepEqual(errors, []); assert.deepEqual(requests, []); });
} finally {
  socket?.close(); firefox.kill(); await sleep(300);
  await rm(temporary, {recursive: true, force: true});
}
const receipt = {passed: results.every(result => result.ok), browser: browserVersion, file: basename(file), htmlSHA256, guideSHA256, results, layouts, errors, externalRequests: requests};
await writeFile(join(output, 'results.json'), JSON.stringify(receipt, null, 2) + '\n');
const failed = results.filter(result => !result.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
