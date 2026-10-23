// Canvas-only scope rendering: plot headings and time windows have their own
// margins, outside the trace rectangles. History uses slow display trends;
// the waveform views retain the separate steady-state reconstruction.
import { onCleanup, onMount } from 'solid-js';
import type { JSX } from 'solid-js';
import { displayNumber } from './format';
import type { MotorCircuit } from './motor-circuit';
import type { LiveReadings } from './simulator';
import { scopeTrace } from './scope-history';
import type { ScopeHistory, ScopeHistoryStatus, ScopePoint } from './scope-history';
import { scopeTrends } from './scope-trends';
import type { ScopeTrendSample } from './scope-trends';
import { SCOPE_VOLTAGES } from './ScopeControls';
import type { HistoryChannels, ScopeView } from './ScopeControls';
import { PHASES, averageVoltage, niceLimit, outputVoltage, phaseCurrents, scopeWindow, switchedCurrents } from './waveforms';
import type { CurrentTrace, Phase, ScopeInput, VoltageKind } from './waveforms';

const PHASE_COLOURS: Readonly<Record<Phase, string>> = { U: '#d55e00', V: '#0072b2', W: '#009e73' };
const FUNDAMENTAL = '#7b3294';
const ZOOM_LENGTH = .002;
const REDRAW_MS = 100;
const TITLE_HEIGHT = 22, TIME_HEIGHT = 18, PLOT_GAP = 16;

interface Plot {
  top: number;
  height: number;
  left: number;
  width: number;
  limit: number;
  positive?: boolean;
}
const yOf = (plot: Plot, value: number): number => plot.positive
  ? plot.top + plot.height - value / plot.limit * plot.height
  : plot.top + plot.height / 2 - value / plot.limit * plot.height / 2;

function frame(context: CanvasRenderingContext2D, plot: Plot, label: string, unit: string, windowLabel: string): void {
  context.strokeStyle = '#ccc'; context.lineWidth = 1;
  context.strokeRect(plot.left, plot.top, plot.width, plot.height);
  context.beginPath(); context.moveTo(plot.left, yOf(plot, 0)); context.lineTo(plot.left + plot.width, yOf(plot, 0)); context.stroke();
  context.fillStyle = '#444'; context.font = '13px Arial, sans-serif'; context.textAlign = 'right'; context.textBaseline = 'middle';
  context.fillText(displayNumber(plot.limit) + ' ' + unit, plot.left - 4, plot.top + 7);
  context.fillText('0', plot.left - 4, yOf(plot, 0));
  if (!plot.positive) context.fillText(displayNumber(-plot.limit), plot.left - 4, plot.top + plot.height - 7);
  context.textAlign = 'left'; context.textBaseline = 'top'; context.fillStyle = '#222'; context.font = 'bold 14px Arial, sans-serif';
  context.fillText(label, plot.left, plot.top - 20);
  context.textAlign = 'right'; context.font = '12px Arial, sans-serif'; context.fillStyle = '#666';
  context.fillText(windowLabel, plot.left + plot.width, plot.top + plot.height + 4);
}

/** Coloured legend entries at the top right of a plot. */
function legend(context: CanvasRenderingContext2D, plot: Plot, entries: ReadonlyArray<readonly [string, string]>): void {
  context.font = 'bold 13px Arial, sans-serif'; context.textAlign = 'right'; context.textBaseline = 'top';
  let x = plot.left + plot.width - 6;
  for (const [text, colour] of [...entries].reverse()) {
    context.fillStyle = colour; context.fillText(text, x, plot.top - 20);
    x -= context.measureText(text).width + 10;
  }
}

function drawVoltage(
  context: CanvasRenderingContext2D, plot: Plot, input: ScopeInput, kind: VoltageKind, start: number, length: number,
): void {
  const period = input.switchingKHz > 0 ? 1 / (1000 * input.switchingKHz) : length;
  if (!outputVoltage(input, kind, start, Math.min(period, length))) {
    context.fillStyle = '#a51c1c'; context.font = '14px Arial, sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText('Con U abierto no hay tensión de U al neutro.', plot.left + plot.width / 2, plot.top + plot.height / 2 + 20);
    return;
  }
  const pulsePixels = input.switchingKHz > 0 ? plot.width / length / (2000 * input.switchingKHz) : Infinity;
  const x = (t: number): number => plot.left + (t - start) / length * plot.width;
  context.save();
  context.beginPath(); context.rect(plot.left, plot.top, plot.width, plot.height); context.clip();
  if (pulsePixels < 2) {
    // Show the level envelope when individual pulses are unresolved. A sampled
    // carrier per pixel bounds work even when two fundamental periods last 2 s.
    context.fillStyle = '#d6d6d6';
    for (let c = 0; c < Math.round(plot.width); c++) {
      const centre = start + length * (c + .5) / plot.width;
      const from = Math.floor(centre / period) * period;
      const levels = outputVoltage(input, kind, from, period)!.values;
      const top = yOf(plot, Math.max(...levels)), bottom = yOf(plot, Math.min(...levels));
      context.fillRect(plot.left + c, top, 1, Math.max(1, bottom - top));
    }
  } else {
    const steps = outputVoltage(input, kind, start, length)!;
    context.strokeStyle = '#444'; context.lineWidth = 1.2; context.beginPath();
    for (let k = 0; k < steps.values.length; k++) {
      const y = yOf(plot, steps.values[k]!), x1 = x(steps.edges[k]!), x2 = x(steps.edges[k + 1]!);
      if (k) context.lineTo(x1, y); else context.moveTo(x1, y);
      context.lineTo(x2, y);
    }
    context.stroke();
  }
  context.strokeStyle = FUNDAMENTAL; context.lineWidth = 2; context.setLineDash([6, 4]); context.beginPath();
  for (let c = 0; c <= plot.width; c += 2) {
    const py = yOf(plot, averageVoltage(input, kind, start + length * c / plot.width) ?? 0);
    if (c) context.lineTo(plot.left + c, py); else context.moveTo(plot.left + c, py);
  }
  context.stroke();
  context.restore();
}

function drawCurrents(
  context: CanvasRenderingContext2D, plot: Plot, input: ScopeInput, start: number, length: number, detail?: CurrentTrace,
): void {
  context.save();
  context.beginPath(); context.rect(plot.left, plot.top, plot.width, plot.height); context.clip();
  context.lineWidth = 2;
  for (const phase of PHASES) {
    context.strokeStyle = PHASE_COLOURS[phase]; context.beginPath();
    if (detail) {
      for (let index = 0; index < detail.times.length; index++) {
        const x = plot.left + (detail.times[index]! - start) / length * plot.width;
        const y = yOf(plot, detail.values[phase][index]!);
        if (index) context.lineTo(x, y); else context.moveTo(x, y);
      }
    } else {
      for (let c = 0; c <= plot.width; c += 2) {
        const py = yOf(plot, phaseCurrents(input, start + length * c / plot.width)[phase]);
        if (c) context.lineTo(plot.left + c, py); else context.moveTo(plot.left + c, py);
      }
    }
    context.stroke();
  }
  context.restore();
}

function timeLabel(seconds: number): string {
  return seconds >= 1 ? displayNumber(seconds) + ' s' : displayNumber(seconds * 1000) + ' ms';
}

interface HistorySeries {
  label: string;
  unit: string;
  colour: string;
  minimum: number;
  value: (sample: ScopeTrendSample) => number;
}
function historySeries(channels: HistoryChannels): readonly [readonly HistorySeries[], readonly HistorySeries[]] {
  if (channels === 'mechanical') return [
    [
      { label: 'Motor', unit: 'N m', colour: FUNDAMENTAL, minimum: 1, value: sample => sample.torqueMean },
      { label: 'Carga', unit: 'N m', colour: '#444', minimum: 1, value: sample => sample.loadTorque },
    ],
    [{ label: 'Velocidad', unit: 'rpm', colour: '#444', minimum: 100, value: sample => sample.rpm }],
  ];
  if (channels === 'magnetic') return [
    [{ label: 'Flujo medio', unit: 'Wb', colour: FUNDAMENTAL, minimum: .1, value: sample => sample.fluxMean }],
    [{ label: 'Bus medio', unit: 'V', colour: '#444', minimum: 100, value: sample => sample.dcBusMean }],
  ];
  return [
    [{ label: 'Tensión UV eficaz', unit: 'V', colour: FUNDAMENTAL, minimum: 100, value: sample => sample.voltageRms }],
    PHASES.map(phase => ({ label: phase, unit: 'A', colour: PHASE_COLOURS[phase], minimum: 1,
      value: (sample: ScopeTrendSample) => sample.currentRms[phase] })),
  ];
}

function drawHistory(
  context: CanvasRenderingContext2D, plot: Plot, points: readonly ScopePoint[], colour: string, start: number, length: number,
): void {
  context.save(); context.beginPath(); context.rect(plot.left, plot.top, plot.width, plot.height); context.clip();
  context.strokeStyle = colour; context.lineWidth = 1.5; context.beginPath();
  points.forEach((point, index) => {
    const x = plot.left + (point.time - start) / length * plot.width, y = yOf(plot, point.value);
    if (index) context.lineTo(x, y); else context.moveTo(x, y);
  });
  context.stroke(); context.restore();
}
function triggerMarker(context: CanvasRenderingContext2D, plot: Plot, time: number, start: number, length: number): void {
  const x = plot.left + (time - start) / length * plot.width;
  context.save(); context.strokeStyle = '#a51c1c'; context.setLineDash([3, 3]);
  context.beginPath(); context.moveTo(x, plot.top); context.lineTo(x, plot.top + plot.height); context.stroke(); context.restore();
}

interface ScopeCanvasProps {
  view: ScopeView;
  channels: HistoryChannels;
  duration: number;
  angle: number;
  voltage: VoltageKind;
  history: ScopeHistory;
  readings: () => LiveReadings;
  circuit: () => MotorCircuit;
  onStatus: (value: ScopeHistoryStatus) => void;
}
export function ScopeCanvas(props: ScopeCanvasProps): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  onMount(() => {
    let request = 0, lastDraw = -Infinity;
    const draw = (time: number): void => {
      request = requestAnimationFrame(draw);
      if (!canvas || time - lastDraw < REDRAW_MS) return;
      lastDraw = time;
      const width = canvas.clientWidth, height = canvas.clientHeight;
      if (width <= 0 || height <= 0) return;
      const stageScale = canvas.getBoundingClientRect().width / width;
      const ratio = window.devicePixelRatio * stageScale;
      const backingWidth = Math.max(1, Math.round(width * ratio));
      const backingHeight = Math.max(1, Math.round(height * ratio));
      if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
        canvas.width = backingWidth;
        canvas.height = backingHeight;
      }
      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const left = 62, plotWidth = width - left - 4;
      const plotHeight = Math.max(1, (height - PLOT_GAP - 2 * (TITLE_HEIGHT + TIME_HEIGHT)) / 2);
      const plotAt = (row: number, limit: number, positive = false): Plot => ({
        top: TITLE_HEIGHT + row * (plotHeight + TITLE_HEIGHT + TIME_HEIGHT + PLOT_GAP),
        height: plotHeight, left, width: plotWidth, limit, positive,
      });
      props.onStatus(props.history.status());
      if (props.view === 'history') {
        const capture = props.history.capture();
        const recorded = capture ? capture.samples : props.history.samples();
        const end = capture?.end ?? recorded.at(-1)?.time ?? 0;
        const start = capture?.start ?? end - props.duration;
        const length = end - start;
        const samples = scopeTrends(recorded).filter(sample => sample.time >= start && sample.time <= end);
        const groups = historySeries(props.channels);
        groups.forEach((group, row) => {
          const traces = group.map(series => scopeTrace(samples, series.value));
          const largest = Math.max(0, ...traces.flatMap(points => points.map(point => Math.abs(point.value))));
          const plot = plotAt(row, niceLimit(largest * 1.1, group[0]!.minimum), props.channels !== 'mechanical');
          const label = props.channels === 'mechanical' && row === 0 ? 'Par medio'
            : group.length === 1 ? group[0]!.label : 'Corrientes eficaces';
          frame(context, plot, label, group[0]!.unit, timeLabel(length));
          if (group.length > 1) legend(context, plot, group.map(series => [series.label, series.colour] as const));
          traces.forEach((points, series) => drawHistory(context, plot, points, group[series]!.colour, start, length));
          if (capture) triggerMarker(context, plot, capture.triggerTime, start, length);
        });
        return;
      }
      const input = props.readings().output;
      const zoom = props.view === 'zoom' ? { angle: props.angle * Math.PI / 180, length: ZOOM_LENGTH } : false;
      const span = scopeWindow(input, zoom);
      const detail = zoom ? switchedCurrents({ output: input, circuit: props.circuit() }, span.start, span.length) : undefined;
      const detailPeak = detail ? Math.max(...PHASES.flatMap(phase => detail.values[phase].map(Math.abs))) : 0;
      const peak = input.mode === 'off' ? 0 : Math.SQRT2 * Math.max(input.current.U, input.current.V, input.current.W);
      const voltagePlot = plotAt(0, niceLimit(input.dcBus, 100));
      const currentPlot = plotAt(1, niceLimit(Math.max(peak, detailPeak) * 1.1, 1));
      const spanLabel = timeLabel(span.length);
      frame(context, voltagePlot, SCOPE_VOLTAGES[props.voltage].label, 'V', spanLabel);
      frame(context, currentPlot, 'Corrientes', 'A', spanLabel);
      legend(context, voltagePlot, [['Promedio', FUNDAMENTAL]]);
      legend(context, currentPlot, PHASES.map(phase => [phase, PHASE_COLOURS[phase]] as const));
      drawVoltage(context, voltagePlot, input, props.voltage, span.start, span.length);
      drawCurrents(context, currentPlot, input, span.start, span.length, detail);
    };
    request = requestAnimationFrame(draw);
    onCleanup(() => cancelAnimationFrame(request));
  });
  return <canvas id="scope-canvas" ref={canvas} role="img" aria-label={props.view === 'history'
    ? 'Tendencias eficaces y medias del registro físico, con ventana de 100 ms'
    : 'Tensión con pulsos de conmutación y corrientes de las tres fases en régimen permanente'} />;
}
