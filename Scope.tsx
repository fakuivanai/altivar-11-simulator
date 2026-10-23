// Oscilloscope tab: line voltage u_UV and the three phase currents, synthesized by
// waveforms.ts from the drive's present state and triggered on phase U.
// It redraws from its own animation loop while mounted, without going through signals.
import { Show, createSignal, onCleanup, onMount, untrack } from 'solid-js';
import type { JSX } from 'solid-js';
import type { LiveReadings } from './simulator';
import { PHASES, averageVoltage, niceLimit, outputVoltage, phaseCurrents, scopeWindow } from './waveforms';
import type { Phase, ScopeInput, Steps, VoltageKind } from './waveforms';
import { Segmented, SliderLabel, useSimulator } from './ui';

export const PHASE_COLOURS: Readonly<Record<Phase, string>> = { U: '#d55e00', V: '#0072b2', W: '#009e73' };
const FUNDAMENTAL = '#7b3294';
const ZOOM_LENGTH = 0.002;
const REDRAW_MS = 50;

export function scopeInput(r: LiveReadings): ScopeInput { return r.output; }

interface Plot { top: number; height: number; left: number; width: number; limit: number }
const yOf = (plot: Plot, value: number): number => plot.top + plot.height / 2 - value / plot.limit * plot.height / 2;

/** Lowest and highest level of a step signal within each pixel column. */
function columns(steps: Steps, start: number, length: number, count: number): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  let k = 0;
  for (let c = 0; c < count; c++) {
    const from = start + length * c / count, to = start + length * (c + 1) / count;
    while (k < steps.values.length - 1 && steps.edges[k + 1]! <= from) k++;
    let min = Infinity, max = -Infinity;
    for (let j = k; j < steps.values.length && steps.edges[j]! < to; j++) {
      const a = Math.max(steps.edges[j]!, from), b = Math.min(steps.edges[j + 1]!, to), v = steps.values[j]!;
      if (b <= a) continue;
      min = Math.min(min, v); max = Math.max(max, v);
    }
    result.push([min === Infinity ? 0 : min, max === -Infinity ? 0 : max]);
  }
  return result;
}

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
  const steps = outputVoltage(input, kind, start, length);
  if (!steps) {
    ctx.fillStyle = '#a51c1c'; ctx.font = '14px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Con U abierto no hay tensión de U al neutro.', plot.left + plot.width / 2, plot.top + plot.height / 2 + 20);
    return;
  }
  const pulsePixels = input.switchingKHz > 0 ? plot.width / length / (2000 * input.switchingKHz) : Infinity;
  const x = (t: number): number => plot.left + (t - start) / length * plot.width;
  ctx.save();
  ctx.beginPath(); ctx.rect(plot.left, plot.top, plot.width, plot.height); ctx.clip();
  if (pulsePixels < 2) {
    // Pulses narrower than two pixels: shade the levels they switch between; the
    // dashed mean below shows what they average to.
    ctx.fillStyle = '#d6d6d6';
    columns(steps, start, length, Math.round(plot.width)).forEach(([min, max], c) => {
      const top = yOf(plot, max), bottom = yOf(plot, min);
      ctx.fillRect(plot.left + c, top, 1, Math.max(1, bottom - top));
    });
  } else {
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

function drawCurrents(ctx: CanvasRenderingContext2D, plot: Plot, input: ScopeInput, start: number, length: number): void {
  ctx.save();
  ctx.beginPath(); ctx.rect(plot.left, plot.top, plot.width, plot.height); ctx.clip();
  ctx.lineWidth = 2;
  for (const phase of PHASES) {
    ctx.strokeStyle = PHASE_COLOURS[phase]; ctx.beginPath();
    for (let c = 0; c <= plot.width; c += 2) {
      const py = yOf(plot, phaseCurrents(input, start + length * c / plot.width)[phase]);
      if (c) ctx.lineTo(plot.left + c, py); else ctx.moveTo(plot.left + c, py);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function timeLabel(seconds: number): string {
  return seconds >= 0.1 ? (seconds * 1000).toFixed(0) + ' ms' : (seconds * 1000).toFixed(seconds >= 0.01 ? 0 : 1) + ' ms';
}

type View = 'periods' | 'zoom';

export function Scope(): JSX.Element {
  const sim = useSimulator();
  const [view, setView] = createSignal<View>('periods');
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
      const peak = input.mode === 'off' ? 0 : Math.SQRT2 * Math.max(input.current.U, input.current.V, input.current.W);
      const voltagePlot: Plot = { top: 0, height: plotHeight, left, width: plotWidth, limit: niceLimit(input.dcBus, 100) };
      const currentPlot: Plot = { top: plotHeight + gap, height: plotHeight, left, width: plotWidth, limit: niceLimit(peak * 1.1, 1) };
      const spanText = timeLabel(span.length);
      frame(ctx, voltagePlot, VOLTAGES[voltageKind].label, 'V', spanText);
      frame(ctx, currentPlot, 'Corrientes', 'A', spanText);
      legend(ctx, voltagePlot, [['- - valor medio', FUNDAMENTAL]]);
      legend(ctx, currentPlot, PHASES.map(phase => ['i ' + phase, PHASE_COLOURS[phase]] as const));
      drawVoltage(ctx, voltagePlot, input, voltageKind, span.start, span.length);
      drawCurrents(ctx, currentPlot, input, span.start, span.length);
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
  return (
    <div class="scope">
      <div class="scope-controls">
        <Segmented label="Ventana de tiempo" idPrefix="scope-" value={view()} onChange={setView}
          options={[['periods', '2 períodos'], ['zoom', 'Zoom 2 ms']]} />
        <Segmented label="Tensión mostrada" idPrefix="voltage-" value={kind()} onChange={setKind}
          options={(Object.keys(VOLTAGES) as VoltageKind[]).map(key => [key, VOLTAGES[key].button] as const)} />
      </div>
      <canvas id="scope-canvas" ref={canvas} role="img"
        aria-label={'Tensión ' + VOLTAGES[kind()].label + ' con sus pulsos de conmutación y corrientes de las tres fases'} />
      <Show when={view() === 'zoom'}>
        <div class="scope-angle">
          <SliderLabel for="scope-angle" label="Centro de la ventana">{angle()}° de U</SliderLabel>
          <input id="scope-angle" type="range" min="0" max="355" step="5" value={angle()} onInput={event => setAngle(event.currentTarget.valueAsNumber)} />
        </div>
      </Show>
      <p id="scope-summary" class="scope-summary">{summary().output}<br />{summary().current}</p>
      <p class="tab-note">Régimen permanente según el estado actual, disparado en U. Valor medio: promedio por período de conmutación (en UV y UN, la fundamental). Corrientes sin rizado.</p>
    </div>
  );
}
