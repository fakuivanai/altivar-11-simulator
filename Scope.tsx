// The history view draws actual averaged physical samples. The other views show
// a stationary waveform at the current operating point; only the 2 ms detail
// adds the independent leakage-current ripple solution.
import { Show, createSignal, onCleanup, onMount, untrack } from 'solid-js';
import type { JSX } from 'solid-js';
import type { LiveReadings } from './simulator';
import { PHASES, averageVoltage, niceLimit, outputVoltage, phaseCurrents, scopeWindow, switchedCurrents } from './waveforms';
import type { CurrentTrace, Phase, ScopeInput, VoltageKind } from './waveforms';
import { scopeTrace } from './scope-history';
import type { ScopePoint, ScopeSample, ScopeTrigger } from './scope-history';
import { Segmented, SliderLabel, useSimulator } from './ui';

export const PHASE_COLOURS: Readonly<Record<Phase, string>> = { U: '#d55e00', V: '#0072b2', W: '#009e73' };
const FUNDAMENTAL = '#7b3294';
const ZOOM_LENGTH = 0.002;
const REDRAW_MS = 100;

export function scopeInput(r: LiveReadings): ScopeInput { return r.output; }

interface Plot { top: number; height: number; left: number; width: number; limit: number }
const yOf = (plot: Plot, value: number): number => plot.top + plot.height / 2 - value / plot.limit * plot.height / 2;

function frame(ctx: CanvasRenderingContext2D, plot: Plot, label: string, unit: string, windowLabel: string): void {
  ctx.strokeStyle = '#ccc'; ctx.lineWidth = 1;
  ctx.strokeRect(plot.left, plot.top, plot.width, plot.height);
  ctx.beginPath(); ctx.moveTo(plot.left, yOf(plot, 0)); ctx.lineTo(plot.left + plot.width, yOf(plot, 0)); ctx.stroke();
  ctx.fillStyle = '#444'; ctx.font = '13px Arial, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.fillText('+' + plot.limit + ' ' + unit, plot.left - 4, plot.top + 7);
  ctx.fillText('0', plot.left - 4, yOf(plot, 0));
  ctx.fillText('-' + plot.limit, plot.left - 4, plot.top + plot.height - 7);
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = '#222'; ctx.font = 'bold 14px Arial, sans-serif';
  ctx.fillText(label, plot.left + 6, plot.top + 4);
  ctx.textAlign = 'right'; ctx.font = '12px Arial, sans-serif'; ctx.fillStyle = '#666';
  ctx.fillText(windowLabel, plot.left + plot.width - 4, plot.top + plot.height - 16);
}

const VOLTAGES: Readonly<Record<VoltageKind, { button: string; label: string }>> = {
  line: { button: 'Línea UV', label: 'u UV, entre las salidas U y V' },
  phase: { button: 'Fase UN', label: 'u UN, de U al neutro (estrella) del motor' },
  pole: { button: 'Rama U0', label: 'u U0, de U al negativo del bus' },
};

/** Coloured legend entries at the top right of a plot. */
function legend(ctx: CanvasRenderingContext2D, plot: Plot, entries: ReadonlyArray<readonly [string, string]>): void {
  ctx.font = 'bold 13px Arial, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
  let x = plot.left + plot.width - 6;
  for (const [text, colour] of [...entries].reverse()) {
    ctx.fillStyle = colour; ctx.fillText(text, x, plot.top + 4);
    x -= ctx.measureText(text).width + 10;
  }
}

function drawVoltage(ctx: CanvasRenderingContext2D, plot: Plot, input: ScopeInput, kind: VoltageKind, start: number, length: number): void {
  const period = input.switchingKHz > 0 ? 1 / (1000 * input.switchingKHz) : length;
  if (!outputVoltage(input, kind, start, Math.min(period, length))) {
    ctx.fillStyle = '#a51c1c'; ctx.font = '14px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Con U abierto no hay tensión de U al neutro.', plot.left + plot.width / 2, plot.top + plot.height / 2 + 20);
    return;
  }
  const pulsePixels = input.switchingKHz > 0 ? plot.width / length / (2000 * input.switchingKHz) : Infinity;
  const x = (t: number): number => plot.left + (t - start) / length * plot.width;
  ctx.save();
  ctx.beginPath(); ctx.rect(plot.left, plot.top, plot.width, plot.height); ctx.clip();
  if (pulsePixels < 2) {
    // Show the level envelope when individual pulses are unresolved. A sampled
    // carrier per pixel bounds work even when two fundamental periods last 2 s.
    ctx.fillStyle = '#d6d6d6';
    for (let c = 0; c < Math.round(plot.width); c++) {
      const centre = start + length * (c + .5) / plot.width;
      const from = Math.floor(centre / period) * period;
      const levels = outputVoltage(input, kind, from, period)!.values;
      const top = yOf(plot, Math.max(...levels)), bottom = yOf(plot, Math.min(...levels));
      ctx.fillRect(plot.left + c, top, 1, Math.max(1, bottom - top));
    }
  } else {
    const steps = outputVoltage(input, kind, start, length)!;
    ctx.strokeStyle = '#444'; ctx.lineWidth = 1.2; ctx.beginPath();
    for (let k = 0; k < steps.values.length; k++) {
      const y = yOf(plot, steps.values[k]!), x1 = x(steps.edges[k]!), x2 = x(steps.edges[k + 1]!);
      if (k) ctx.lineTo(x1, y); else ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
    }
    ctx.stroke();
  }
  ctx.strokeStyle = FUNDAMENTAL; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.beginPath();
  for (let c = 0; c <= plot.width; c += 2) {
    const py = yOf(plot, averageVoltage(input, kind, start + length * c / plot.width) ?? 0);
    if (c) ctx.lineTo(plot.left + c, py); else ctx.moveTo(plot.left + c, py);
  }
  ctx.stroke();
  ctx.restore();
}

function drawCurrents(ctx: CanvasRenderingContext2D, plot: Plot, input: ScopeInput, start: number, length: number, detail?: CurrentTrace): void {
  ctx.save();
  ctx.beginPath(); ctx.rect(plot.left, plot.top, plot.width, plot.height); ctx.clip();
  ctx.lineWidth = 2;
  for (const phase of PHASES) {
    ctx.strokeStyle = PHASE_COLOURS[phase]; ctx.beginPath();
    if (detail) {
      for (let index = 0; index < detail.times.length; index++) {
        const x = plot.left + (detail.times[index]! - start) / length * plot.width;
        const y = yOf(plot, detail.values[phase][index]!);
        if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
    } else {
      for (let c = 0; c <= plot.width; c += 2) {
        const py = yOf(plot, phaseCurrents(input, start + length * c / plot.width)[phase]);
        if (c) ctx.lineTo(plot.left + c, py); else ctx.moveTo(plot.left + c, py);
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}

function timeLabel(seconds: number): string {
  if (seconds >= 1) return seconds.toFixed(Number.isInteger(seconds) ? 0 : 1) + ' s';
  return seconds >= 0.1 ? (seconds * 1000).toFixed(0) + ' ms' : (seconds * 1000).toFixed(seconds >= 0.01 ? 0 : 1) + ' ms';
}

type View = 'history' | 'periods' | 'zoom';
type HistoryChannels = 'electrical' | 'mechanical' | 'magnetic';
const TRIGGERS: Readonly<Record<ScopeTrigger, string>> = { start: 'Arranque', load: 'Escalón de carga', fault: 'Falla' };

interface HistorySeries { label: string; unit: string; colour: string; minimum: number; value: (sample: ScopeSample) => number }
function historySeries(channels: HistoryChannels): readonly [readonly HistorySeries[], readonly HistorySeries[]] {
  if (channels === 'mechanical') return [
    [
      { label: 'Motor', unit: 'N m', colour: FUNDAMENTAL, minimum: 1, value: sample => sample.torque },
      { label: 'Carga', unit: 'N m', colour: '#444', minimum: 1, value: sample => sample.loadTorque },
    ],
    [{ label: 'Velocidad del rotor', unit: 'rpm', colour: '#444', minimum: 100, value: sample => sample.rpm }],
  ];
  if (channels === 'magnetic') return [
    [{ label: 'Flujo del rotor', unit: 'Wb', colour: FUNDAMENTAL, minimum: .1, value: sample => sample.flux }],
    [{ label: 'Tensión del bus', unit: 'V', colour: '#444', minimum: 100, value: sample => sample.dcBus }],
  ];
  return [
    [{ label: 'u UV del motor, promediada', unit: 'V', colour: FUNDAMENTAL, minimum: 100, value: sample => sample.voltage.U - sample.voltage.V }],
    PHASES.map(phase => ({ label: 'i ' + phase, unit: 'A', colour: PHASE_COLOURS[phase], minimum: 1, value: (sample: ScopeSample) => sample.current[phase] })),
  ];
}
function drawHistory(ctx: CanvasRenderingContext2D, plot: Plot, points: readonly ScopePoint[], colour: string, start: number, length: number): void {
  ctx.save(); ctx.beginPath(); ctx.rect(plot.left, plot.top, plot.width, plot.height); ctx.clip();
  ctx.strokeStyle = colour; ctx.lineWidth = 1.5; ctx.beginPath();
  points.forEach((point, index) => {
    const x = plot.left + (point.time - start) / length * plot.width, y = yOf(plot, point.value);
    if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  });
  ctx.stroke(); ctx.restore();
}
function triggerMarker(ctx: CanvasRenderingContext2D, plot: Plot, time: number, start: number, length: number): void {
  const x = plot.left + (time - start) / length * plot.width;
  ctx.save(); ctx.strokeStyle = '#a51c1c'; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(x, plot.top); ctx.lineTo(x, plot.top + plot.height); ctx.stroke(); ctx.restore();
}

export function Scope(): JSX.Element {
  const sim = useSimulator();
  const [view, setView] = createSignal<View>('history');
  const [channels, setChannels] = createSignal<HistoryChannels>('electrical');
  const [historyLength, setHistoryLength] = createSignal(5);
  const [trigger, setTrigger] = createSignal<ScopeTrigger>(sim.scopeHistory.trigger() ?? 'start');
  const [recording, setRecording] = createSignal('Registro continuo');
  const [angle, setAngle] = createSignal(60);
  const [kind, setKind] = createSignal<VoltageKind>('line');
  let canvas: HTMLCanvasElement | undefined;
  onMount(() => {
    let request = 0, last = 0;
    const draw = (time: number): void => {
      request = requestAnimationFrame(draw);
      if (!canvas || time - last < REDRAW_MS) return;
      last = time;
      const input = scopeInput(untrack(sim.readings));
      const voltageKind = untrack(kind);
      const zoom = untrack(view) === 'zoom' ? { angle: untrack(angle) * Math.PI / 180, length: ZOOM_LENGTH } : false as const;
      const span = scopeWindow(input, zoom);
      const detail = zoom ? switchedCurrents({ output: input, circuit: sim.motorCircuit() }, span.start, span.length) : undefined;
      const width = canvas.clientWidth, height = canvas.clientHeight, scale = canvas.getBoundingClientRect().width / Math.max(width, 1);
      const ratio = (window.devicePixelRatio ?? 1) * scale;
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const left = 54, plotWidth = width - left - 4, gap = 12, plotHeight = (height - gap) / 2;
      if (untrack(view) === 'history') {
        const capture = sim.scopeHistory.capture();
        const all = capture ? capture.samples : sim.scopeHistory.samples();
        const end = capture?.end ?? all.at(-1)?.time ?? 0;
        const start = capture?.start ?? end - untrack(historyLength);
        const length = end - start;
        const samples = all.filter(sample => sample.time >= start && sample.time <= end);
        const groups = historySeries(untrack(channels));
        groups.forEach((group, index) => {
          const traces = group.map(series => scopeTrace(samples, series.value));
          const largest = Math.max(0, ...traces.flatMap(points => points.map(point => Math.abs(point.value))));
          const plot: Plot = { top: index * (plotHeight + gap), height: plotHeight, left, width: plotWidth,
            limit: niceLimit(largest * 1.1, group[0]!.minimum) };
          const label = untrack(channels) === 'mechanical' && index === 0 ? 'Par'
            : group.length === 1 ? group[0]!.label : 'Corrientes instantáneas';
          frame(ctx, plot, label, group[0]!.unit, timeLabel(length));
          if (group.length > 1) legend(ctx, plot, group.map(series => [series.label, series.colour] as const));
          traces.forEach((points, series) => drawHistory(ctx, plot, points, group[series]!.colour, start, length));
          if (capture) triggerMarker(ctx, plot, capture.triggerTime, start, length);
        });
        const status = sim.scopeHistory.status();
        setRecording(status === 'armed' ? 'Esperando: ' + TRIGGERS[sim.scopeHistory.trigger()!]
          : status === 'capturing' ? 'Capturando después del disparo'
          : status === 'complete' ? 'Captura completa, retenida'
          : 'Registro continuo');
      } else {
        const detailPeak = detail ? Math.max(...PHASES.flatMap(phase => detail.values[phase].map(Math.abs))) : 0;
        const peak = input.mode === 'off' ? 0 : Math.SQRT2 * Math.max(input.current.U, input.current.V, input.current.W);
        const voltagePlot: Plot = { top: 0, height: plotHeight, left, width: plotWidth, limit: niceLimit(input.dcBus, 100) };
        const currentPlot: Plot = { top: plotHeight + gap, height: plotHeight, left, width: plotWidth, limit: niceLimit(Math.max(peak, detailPeak) * 1.1, 1) };
        const spanText = timeLabel(span.length);
        frame(ctx, voltagePlot, VOLTAGES[voltageKind].label, 'V', spanText);
        frame(ctx, currentPlot, 'Corrientes', 'A', spanText);
        legend(ctx, voltagePlot, [['- - valor medio', FUNDAMENTAL]]);
        legend(ctx, currentPlot, PHASES.map(phase => ['i ' + phase, PHASE_COLOURS[phase]] as const));
        drawVoltage(ctx, voltagePlot, input, voltageKind, span.start, span.length);
        drawCurrents(ctx, currentPlot, input, span.start, span.length, detail);
      }
    };
    request = requestAnimationFrame(draw);
    onCleanup(() => cancelAnimationFrame(request));
  });

  const input = () => scopeInput(sim.readings());
  const summary = () => {
    const i = input();
    if (i.mode === 'off') return { output: 'Sin salida: el variador no alimenta al motor.', current: '' };
    const current = Math.max(i.current.U, i.current.V, i.current.W);
    if (i.mode === 'dc') {
      const phases = i.topology.source === null ? [] : [i.topology.source, ...i.topology.returns];
      const terminals = phases.length === 3 ? 'U y los retornos V, W' : phases.join(' y ');
      return {
        output: phases.length >= 2 ? `Inyección de continua: ${i.voltage.toFixed(0)} V entre ${terminals}.` : 'Inyección de continua sin circuito cerrado del motor.',
        current: `Corriente continua máxima ${current.toFixed(2)} A.`,
      };
    }
    const lag = i.currentLag, regenerating = lag > Math.PI / 2;
    return {
      output: `${Math.abs(i.frequency).toFixed(1)} Hz, ${i.voltage.toFixed(0)} V de línea, bus ${i.dcBus.toFixed(0)} V, conmutación ${i.switchingKHz.toFixed(1)} kHz.`,
      current: `Corriente ${current.toFixed(2)} A, desfase ${(lag * 180 / Math.PI).toFixed(0)}° (cos φ ${Math.cos(lag).toFixed(2)})${regenerating ? ': el motor devuelve energía.' : '.'}`,
    };
  };
  function arm(): void {
    const length = historyLength();
    sim.scopeHistory.arm(trigger(), { before: length * .2, after: length * .8 });
    setRecording('Esperando: ' + TRIGGERS[trigger()]);
  }
  function resume(): void { sim.scopeHistory.resume(); setRecording('Registro continuo'); }
  return (
    <div class="scope">
      <div class="scope-controls">
        <Segmented label="Ventana de tiempo" idPrefix="scope-" value={view()} onChange={setView}
          options={[[ 'history', 'Registro' ], ['periods', '2 períodos'], ['zoom', 'Zoom 2 ms']]} />
        <Show when={view() !== 'history'}>
          <Segmented label="Tensión mostrada" idPrefix="voltage-" value={kind()} onChange={setKind}
            options={(Object.keys(VOLTAGES) as VoltageKind[]).map(key => [key, VOLTAGES[key].button] as const)} />
        </Show>
      </div>
      <Show when={view() === 'history'}>
        <div class="scope-controls">
          <Segmented label="Magnitudes registradas" idPrefix="scope-channels-" value={channels()} onChange={setChannels}
            options={[[ 'electrical', 'Tensión y corriente' ], ['mechanical', 'Par y velocidad'], ['magnetic', 'Flujo y bus']]} />
          <label>Ventana <select id="scope-duration" value={historyLength()} onChange={event => setHistoryLength(Number(event.currentTarget.value))}>
            <option value="1">1 s</option><option value="5">5 s</option><option value="10">10 s</option>
          </select></label>
        </div>
        <div class="scope-controls">
          <label>Disparo <select id="scope-trigger" value={trigger()} onChange={event => setTrigger(event.currentTarget.value as ScopeTrigger)}>
            <option value="start">Arranque</option><option value="load">Escalón de carga</option><option value="fault">Falla</option>
          </select></label>
          <button id="scope-arm" onClick={arm}>Armar captura</button>
          <button id="scope-live" onClick={resume}>Continuo</button>
          <output id="scope-capture-status">{recording()}</output>
        </div>
      </Show>
      <canvas id="scope-canvas" ref={canvas} role="img"
        aria-label={view() === 'history' ? 'Registro temporal de las magnitudes físicas del motor'
          : 'Tensión ' + VOLTAGES[kind()].label + ' con sus pulsos de conmutación y corrientes de las tres fases'} />
      <Show when={view() === 'zoom'}>
        <div class="scope-angle">
          <SliderLabel for="scope-angle" label="Centro de la ventana">{angle()}° de U</SliderLabel>
          <input id="scope-angle" type="range" min="0" max="355" step="5" value={angle()} onInput={event => setAngle(event.currentTarget.valueAsNumber)} />
        </div>
      </Show>
      <p id="scope-summary" class="scope-summary">{view() === 'history' ? 'Estado actual: ' : ''}{summary().output}<br />{summary().current}</p>
      <p class="tab-note">{view() === 'history'
        ? 'Registro del modelo promediado. La captura conserva 20% antes del disparo y 80% después. Línea roja: disparo. Sin pulsos de conmutación.'
        : view() === 'zoom'
          ? 'Reconstrucción local de régimen permanente. Rizado con la dispersión y resistencia del motor, sin realimentar el modelo promediado.'
          : 'Régimen permanente según el estado actual, disparado en U. Valor medio por período de conmutación. Corrientes fundamentales.'}</p>
    </div>
  );
}
