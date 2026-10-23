// Original classroom UI. The projection page shows the fixed stage scaled to the
// window; the learning page (html data-mode="guide") adds the study panel.
import { Show, onCleanup, onMount } from 'solid-js';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { Bench } from './Bench';
import { DrivePanel, PanelInfo } from './DrivePanel';
import { GuideLayout } from './Guide';
import { FullscreenButton, SoundToggle } from './HeaderControls';
import { STAGE } from './layout';
import { manualUrl } from './manuals';
import { MotorCanvas, Readings, Settings } from './Panels';
import { Schematic } from './Schematic';
import { createSimulator } from './simulator';
import { SimulatorProvider, useSimulator } from './ui';

function Header(): JSX.Element {
  const sim = useSimulator();
  return (
    <header class="topbar">
      <h1>Variador de frecuencia</h1><span class="model">ATV11HU09M2E, 0,37 kW, 230 V, 2,1 A</span>
      <div id="status" class="status" role="status" aria-live="polite">{sim.state.message}<Show when={sim.state.simulationLag > .1}> Simulación atrasada {sim.state.simulationLag.toFixed(1)} s.</Show></div>
      <SoundToggle />
      <FullscreenButton />
      <a id="manufacturer-manual" href={manualUrl('user')} target="_blank" rel="noopener" title="Descarga oficial del manual. Español: página PDF 53, impresa 52. Requiere internet.">Manual</a>
      <a id="model-documentation" href="Documentación del simulador.html" target="_blank" rel="noopener" title="Funciones, modelos y supuestos del simulador">Modelo</a>
    </header>
  );
}

/** Bound transformed overflow before measuring, including mobile browser bars. */
function Viewport(props: { children: JSX.Element }): JSX.Element {
  let frame: HTMLDivElement | undefined;
  let viewport: HTMLDivElement | undefined;
  onMount(() => {
    const visual = window.visualViewport;
    const fit = (): void => {
      if (!frame || !viewport) return;
      // VisualViewport dimensions shrink during pinch zoom. Multiplying by
      // scale retains the unzoomed available area, so fitting does not undo
      // the user's zoom or move the drawing against native viewport panning.
      // https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport
      const width = Math.min(frame.clientWidth, visual ? visual.width * visual.scale : frame.clientWidth);
      const height = Math.min(frame.clientHeight, visual ? visual.height * visual.scale : frame.clientHeight);
      viewport.style.width = `${width}px`;
      viewport.style.height = `${height}px`;
      viewport.style.setProperty('--viewport-height', `${height}px`);
    };
    fit();
    window.addEventListener('resize', fit);
    visual?.addEventListener('resize', fit);
    const observer = new ResizeObserver(fit);
    if (frame) observer.observe(frame);
    onCleanup(() => {
      window.removeEventListener('resize', fit);
      visual?.removeEventListener('resize', fit);
      observer.disconnect();
    });
  });
  return <div id="viewport-frame" ref={frame}><div id="viewport" ref={viewport}>{props.children}</div></div>;
}

/** The 1600 x 900 drawing, uniformly scaled to fit its bounded host. */
function Stage(props: { host: () => HTMLElement | undefined; centered?: boolean }): JSX.Element {
  let stage: HTMLDivElement | undefined;
  onMount(() => {
    const host = props.host();
    const fit = (): void => {
      if (!stage || !host) return;
      const width = host.clientWidth, height = host.clientHeight;
      const scale = Math.min(width / STAGE.width, height / STAGE.height);
      const left = Math.max(0, (width - STAGE.width * scale) / 2);
      const top = props.centered ? Math.max(0, (height - STAGE.height * scale) / 2) : 0;
      stage.style.transform = `translate(${left}px, ${top}px) scale(${scale})`;
    };
    fit();
    window.addEventListener('resize', fit);
    const observer = host && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    if (host) observer?.observe(host);
    onCleanup(() => { window.removeEventListener('resize', fit); observer?.disconnect(); });
  });
  return (
    <div id="stage" class="stage" ref={stage}>
      <Schematic />
      <Header />
      <DrivePanel />
      <PanelInfo />
      <Bench />
      <MotorCanvas />
      <Readings />
      <Settings />
    </div>
  );
}

function Projection(): JSX.Element {
  let host: HTMLDivElement | undefined;
  return <div id="projection-host" ref={host}><Stage host={() => host} centered /></div>;
}

function App(): JSX.Element {
  const simulator = createSimulator();
  const learning = document.documentElement.dataset.mode === 'guide';
  return (
    <SimulatorProvider value={simulator}>
      <Viewport>{learning ? <GuideLayout stage={host => <Stage host={host} />} /> : <Projection />}</Viewport>
    </SimulatorProvider>
  );
}

const root = document.getElementById('app');
if (!root) throw new Error('Falta el contenedor de la aplicación.');
render(() => <App />, root);
