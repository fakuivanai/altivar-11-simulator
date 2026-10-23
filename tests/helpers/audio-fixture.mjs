// Controlled visibility and resume fixtures exercise the actual Web Audio graph.
// They do not claim physical speaker or browser-chrome validation.
import { bundleFixture, openFixture } from './bundle-fixture.mjs';
const source = `
  import {createSignal} from 'solid-js';
  import {render} from 'solid-js/web';
  import {SimulatorProvider} from './ui';
  import {DrivePanel} from './DrivePanel';
  import {FullscreenButton, SoundToggle} from './HeaderControls';
  const [readings, setReadings] = createSignal({rpm:700, output:{mode:'ac', frequency:25,
    aggregateCurrent:1, current:{U:1,V:1,W:1}, voltage:115, dcBus:325, switchingKHz:4,
    currentLag:0.8, connected:{U:true,V:true,W:true}}});
  const fixture = window.fixture = {keys:[], enters:0, messages:[], nativeClicks:0};
  fixture.setReadings = value => setReadings(previous => ({...previous, ...value,
    output:value.output ? {...previous.output, ...value.output} : previous.output}));
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
`;
let bundled;
export async function openAudioFixture(page, testInfo) {
  await page.addInitScript(() => {
    window.audio = [];
    window.pendingResumes = [];
    window.audioMode = 'normal';
    window.hiddenFixture = false;
    Object.defineProperty(document, 'hidden', {
      get: () => window.hiddenFixture,
      configurable: true
    });
    Object.defineProperty(document, 'fullscreenEnabled', {
      get: () => true,
      configurable: true
    });
    window.setHidden = value => {
      window.hiddenFixture = value;
      document.dispatchEvent(new Event('visibilitychange'));
    };
    const Original = AudioContext;
    const nativeResume = Original.prototype.resume;
    window.AudioContext = class extends Original {
      constructor(...args) {
        super(...args);
        this.gains = [];
        this.oscillators = [];
        window.audio.push(this);
      }
      createGain() {
        const result = super.createGain();
        this.gains.push(result);
        return result;
      }
      createOscillator() {
        const result = super.createOscillator();
        this.oscillators.push(result);
        return result;
      }
      resume() {
        if (window.audioMode === 'reject') return Promise.reject(new Error('Controlled resume failure'));
        if (window.audioMode === 'delay') return new Promise((resolve, reject) => {
          window.pendingResumes.push({
            resolve: () => nativeResume.call(this).then(resolve, reject),
            reject: () => reject(new Error('Controlled stale resume failure'))
          });
        });
        return nativeResume.call(this);
      }
    };
  });
  const script = await (bundled ??= bundleFixture(source, 'ui-audio-fixture', true));
  await openFixture(page, testInfo, {
    name: 'ui-audio-fixture',
    script,
    body: '<div id="app"></div>',
    style: '.key{width:60px;height:60px}#display,#route{display:none}'
  });
  await page.waitForFunction(() => !!window.fixture);
}
