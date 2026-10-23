// Output waveforms for the scope tab, synthesized from the drive's present state as
// if it were in steady state. The time origin is the zero crossing of the
// phase U reference, so the picture stands still like a triggered oscilloscope.
//
// Modulation: regular-sampled carrier PWM, as digital drives update the duty once per
// carrier period, with min-max zero-sequence injection (equivalent to space-vector
// modulation), which reaches a line voltage of Vdc / sqrt(2). Teaching model: the
// ATV11's exact modulation strategy is not documented in the manufacturer's manuals.
// The 2 ms detail adds an independent leakage-current solution around the
// fundamental; its result never enters the averaged motor integration.

import { PHASES } from './engine-types';
import type { ElectricalOutput, Phase } from './engine-types';
import { invariant } from './invariant';
export { PHASES } from './engine-types';
export type { Phase } from './engine-types';

/** Instruments consume the output already described by the model. */
export type ScopeInput = ElectricalOutput;

/** A piecewise-constant signal: value[k] holds from edge[k] to edge[k + 1]. */
export interface Steps { edges: number[]; values: number[] }

const OFFSET: Readonly<Record<Phase, number>> = { U: 0, V: -2 * Math.PI / 3, W: 2 * Math.PI / 3 };
/** Lowest frequency drawn as a waveform; below it the window would be too long. */
export const MIN_SCOPE_FREQUENCY = 1;

function clamp(value: number, low: number, high: number): number { return Math.min(high, Math.max(low, value)); }

/** Electrical angle at time t after the trigger. */
export function angleAt(input: ScopeInput, t: number): number { return input.mode === 'ac' ? 2 * Math.PI * input.frequency * t : 0; }

/** Duty of each leg (0 to 1) for the references at time t. */
export function duties(input: ScopeInput, t: number): Record<Phase, number> {
  if (input.mode === 'off' || input.dcBus <= 0) return { U: 0.5, V: 0.5, W: 0.5 };
  // Phase reference peaks are sqrt(2) Vll / sqrt(3) in AC. In DC the model's
  // source leg drives the stated voltage against its connected return legs.
  const reference: Record<Phase, number> = input.mode === 'dc'
    ? (() => {
      // The injection source follows the first connected conductor. An open U
      // therefore transfers injection to V/W instead of driving them identically.
      const { source, returns } = input.topology;
      const result: Record<Phase, number> = { U: 0, V: 0, W: 0 };
      if (source === null) return result;
      const count = returns.length + 1;
      result[source] = returns.length * input.voltage / count;
      for (const phase of returns) result[phase] = -input.voltage / count;
      return result;
    })()
    : (() => {
      const peak = Math.SQRT2 * input.voltage / Math.sqrt(3), angle = angleAt(input, t);
      return { U: peak * Math.sin(angle + OFFSET.U), V: peak * Math.sin(angle + OFFSET.V), W: peak * Math.sin(angle + OFFSET.W) };
    })();
  const zero = -(Math.max(reference.U, reference.V, reference.W) + Math.min(reference.U, reference.V, reference.W)) / 2;
  const duty = (phase: Phase): number => clamp(0.5 + (reference[phase] + zero) / input.dcBus, 0, 1);
  return { U: duty('U'), V: duty('V'), W: duty('W') };
}

/** Which voltage the scope shows. */
export type VoltageKind = 'line' | 'phase' | 'pole';

/**
 * How each leg's switching state (0 or 1, times Vdc) adds up to the chosen voltage.
 * line u_UV: sU - sV. pole u_U0, against the negative bus rail: sU.
 * phase u_UN, against the motor star point: with three windings connected the star
 * sits at the mean of the three terminals, (2 sU - sV - sW) / 3; with one conductor
 * open it sits midway between the other two. With U itself open there is no
 * defined U to N voltage at the drive, so null.
 */
export function legWeights(kind: VoltageKind, connected: Readonly<Record<Phase, boolean>>): Record<Phase, number> | null {
  if (kind === 'line') return { U: 1, V: -1, W: 0 };
  if (kind === 'pole') return { U: 1, V: 0, W: 0 };
  return windingWeights('U', connected);
}

/** Floating-star winding voltage; disconnected conductors carry no winding current. */
function windingWeights(phase: Phase, connected: Readonly<Record<Phase, boolean>>): Record<Phase, number> | null {
  const count = PHASES.filter(item => connected[item]).length;
  if (!connected[phase] || count < 2) return null;
  return {
    U: (phase === 'U' ? 1 : 0) - (connected.U ? 1 / count : 0),
    V: (phase === 'V' ? 1 : 0) - (connected.V ? 1 / count : 0),
    W: (phase === 'W' ? 1 : 0) - (connected.W ? 1 / count : 0),
  };
}

/**
 * The chosen voltage over [start, start + length], as exact switching edges. Each
 * carrier period samples the duty at its centre and turns each leg on for a centred
 * interval of that duty.
 */
export function outputVoltage(input: ScopeInput, kind: VoltageKind, start: number, length: number): Steps | null {
  const weights = legWeights(kind, input.connected);
  return weights ? switchingVoltage(input, weights, start, length) : null;
}

function switchingVoltage(input: ScopeInput, weights: Record<Phase, number>, start: number, length: number): Steps {
  const end = start + length;
  if (input.mode === 'off' || input.dcBus <= 0 || input.switchingKHz <= 0) return { edges: [start, end], values: [0] };
  const period = 1 / (1000 * input.switchingKHz);
  const events: Array<[number, number]> = [];
  for (let k = Math.floor(start / period); k * period < end; k++) {
    // Both ends use k * period so that adjacent periods share bit-identical boundaries.
    const t0 = k * period, t1 = (k + 1) * period, d = duties(input, (t0 + t1) / 2);
    for (const phase of PHASES) {
      const weight = weights[phase];
      if (weight === 0) continue;
      const on = t0 + (1 - d[phase]) * period / 2, off = t0 + (1 + d[phase]) * period / 2;
      if (d[phase] >= 1) events.push([t0, weight], [t1, -weight]);
      else if (d[phase] > 0) events.push([on, weight], [off, -weight]);
    }
  }
  events.sort((a, b) => a[0] - b[0]);
  const edges = [start], values: number[] = [];
  let level = 0;
  for (const [time, change] of events) {
    if (time <= start) { level += change; continue; }
    if (time >= end) break;
    if (time > edges[edges.length - 1]!) { values.push(level * input.dcBus); edges.push(time); }
    level += change;
  }
  values.push(level * input.dcBus);
  edges.push(end);
  // Rounding in the running sum: snap to the exact multiples of Vdc / 6.
  return { edges, values: values.map(value => Math.round(6 * value / input.dcBus) * input.dcBus / 6) };
}

/** Line voltage u_UV at the drive terminals. */
export function lineVoltage(input: ScopeInput, start: number, length: number): Steps {
  const steps = outputVoltage(input, 'line', start, length);
  if (!steps) throw new Error('la tensión de línea siempre está definida');
  return steps;
}

/**
 * Mean of the chosen voltage over a carrier period at time t (what the motor's
 * inductance effectively sees). For u_UV and u_UN it is the fundamental while the
 * modulation stays linear; u_U0 also carries Vdc / 2 and the zero-sequence term.
 */
export function averageVoltage(input: ScopeInput, kind: VoltageKind, t: number): number | null {
  const weights = legWeights(kind, input.connected);
  if (!weights) return null;
  if (input.mode === 'off') return 0;
  const d = duties(input, t);
  return input.dcBus * (weights.U * d.U + weights.V * d.V + weights.W * d.W);
}

/** Fundamental of u_UV at time t: it leads phase U by 30 degrees. */
export function lineFundamental(input: ScopeInput, t: number): number {
  if (input.mode === 'dc') return averageVoltage(input, 'line', t)!; // line voltage is always defined
  if (input.mode === 'off') return 0;
  return Math.SQRT2 * input.voltage * Math.sin(angleAt(input, t) + Math.PI / 6);
}

/**
 * Phase currents at time t. With one conductor open the other two carry one line
 * current, driven by the voltage between them; with two open nothing flows.
 */
export function phaseCurrents(input: ScopeInput, t: number): Record<Phase, number> {
  const result: Record<Phase, number> = { U: 0, V: 0, W: 0 };
  if (input.mode === 'off') return result;
  if (input.mode === 'dc') {
    const { source, returns } = input.topology;
    if (source === null) return result;
    result[source] = input.current[source];
    for (const phase of returns) result[phase] = -input.current[phase];
    return result;
  }
  const connected = PHASES.filter(phase => input.connected[phase] && input.current[phase] > 0);
  if (connected.length < 2) return result;
  // Current lags in physical time, so reverse rotation changes the angular lag sign.
  const angle = angleAt(input, t) - (input.frequency < 0 ? -1 : 1) * input.currentLag;
  if (connected.length === 3) {
    for (const phase of PHASES) result[phase] = Math.SQRT2 * input.current[phase] * Math.sin(angle + OFFSET[phase]);
    return result;
  }
  // Line pairs in sequence order: u_UV, u_VW, u_WU lead their first phase by 30 degrees.
  const pair: Readonly<Record<Phase, [Phase, Phase]>> = { W: ['U', 'V'], U: ['V', 'W'], V: ['W', 'U'] };
  const open = PHASES.find(phase => !connected.includes(phase))!;
  const [from, to] = pair[open];
  const line = Math.SQRT2 * input.current[from] * Math.sin(angle + OFFSET[from] + Math.PI / 6);
  result[from] = line;
  result[to] = -line;
  return result;
}

/** Time window for the two display modes. */
export function scopeWindow(input: ScopeInput, zoom: false | { angle: number; length: number }): { start: number; length: number } {
  // Without AC there is no period to follow; retain the scope's 50 Hz time base.
  const signedFrequency = input.mode === 'ac' ? input.frequency : 50;
  const frequency = Math.max(Math.abs(signedFrequency), MIN_SCOPE_FREQUENCY);
  if (!zoom) return { start: 0, length: 2 / frequency };
  // Centre the zoom window where phase U is at the chosen angle.
  const centre = zoom.angle / (2 * Math.PI * (signedFrequency < 0 ? -frequency : frequency));
  return { start: centre - zoom.length / 2, length: zoom.length };
}

/** Upper end of an axis: the next 1, 2 or 5 step above the value. */
export function niceLimit(value: number, minimum: number): number {
  const target = Math.max(Math.abs(value), minimum);
  const decade = 10 ** Math.floor(Math.log10(target));
  for (const step of [1, 2, 5, 10]) if (step * decade >= target) return step * decade;
  return 10 * decade;
}


export interface SwitchedCurrentInput {
  readonly output: ScopeInput;
  readonly circuit: {
    /** Effective per-phase stator resistance, ohm. */
    readonly statorResistance: number;
    /** Ls - Lm^2/Lr, referred to the stator, H. */
    readonly leakageInductance: number;
  };
}
export interface CurrentTrace {
  readonly times: number[];
  readonly values: Record<Phase, number[]>;
}
interface RipplePeriod {
  readonly steps: Steps;
  readonly mean: number;
  readonly initial: number;
}

/** Exact R-L evolution over a constant residual voltage, avoiding small-step loss. */
function leakageStep(current: number, voltage: number, time: number, resistance: number, inductance: number): number {
  if (resistance === 0) return current + voltage * time / inductance;
  const decay = -Math.expm1(-resistance * time / inductance);
  return current * (1 - decay) + voltage / resistance * decay;
}

function ripplePeriod(input: SwitchedCurrentInput, phase: Phase, start: number, period: number, incoming?: number): RipplePeriod | null {
  const weights = windingWeights(phase, input.output.connected);
  if (!weights) return null;
  const steps = switchingVoltage(input.output, weights, start, period);
  let mean = 0;
  for (let index = 0; index < steps.values.length; index++)
    mean += steps.values[index]! * (steps.edges[index + 1]! - steps.edges[index]!);
  mean /= period;
  if (incoming !== undefined) return { steps, mean, initial: incoming };
  const { statorResistance: resistance, leakageInductance: inductance } = input.circuit;
  let current = 0, area = 0, response = 0;
  for (let index = 0; index < steps.values.length; index++) {
    const time = steps.edges[index + 1]! - steps.edges[index]!;
    const voltage = steps.values[index]! - mean;
    if (resistance === 0) {
      const next = leakageStep(current, voltage, time, 0, inductance);
      area += (current + next) * time / 2;
      current = next;
    } else {
      const rate = resistance / inductance, z = -rate * time;
      // Remove the zero-mean forcing term analytically. The remaining response
      // is O(Rs), avoiding cancellation when Rs Ts / Lsigma approaches zero.
      const excess = Math.abs(z) < 1e-4 ? z * (.5 + z * (1 / 6 + z * (1 / 24 + z / 120)))
        : Math.expm1(z) / z - 1;
      const remaining = Math.max(0, start + period - steps.edges[index + 1]!);
      const weight = Math.expm1(-rate * remaining) * (1 + excess) + excess;
      response += voltage * time / inductance * weight;
    }
  }
  const initial = resistance === 0 ? -area / period
    : response / -Math.expm1(-resistance * period / inductance);
  return { steps, mean, initial };
}
function rippleAt(input: SwitchedCurrentInput, plan: RipplePeriod, time: number): number {
  const { statorResistance, leakageInductance } = input.circuit;
  let current = plan.initial;
  for (let index = 0; index < plan.steps.values.length; index++) {
    const from = plan.steps.edges[index]!, to = Math.min(time, plan.steps.edges[index + 1]!);
    if (to > from) current = leakageStep(current, plan.steps.values[index]! - plan.mean, to - from, statorResistance, leakageInductance);
    if (time <= plan.steps.edges[index + 1]!) break;
  }
  return current;
}

/**
 * Original switching-detail approximation derived by subtracting the carrier mean
 * from v = Rs i + d(psi)/dt. Rotor flux and the fundamental are held at the snapshot.
 * Lsigma d(delta i)/dt + Rs delta i = vPWM - mean(vPWM).
 * A bounded leading integration initializes the continuous R-L ripple. Each
 * carrier's voltage residual has zero mean; current means approach the averaged
 * baseline without resetting current at carrier boundaries. It changes neither
 * the motor state nor its RMS reading. This excludes cables, dead time and reflections.
 * Machine equation/parameter provenance:
 * https://www.mathworks.com/help/mcb/ref/inductionmotor.html
 */
export function switchedCurrents(input: SwitchedCurrentInput, start: number, length: number): CurrentTrace {
  const { output, circuit } = input;
  invariant(Number.isFinite(start) && Number.isFinite(length) && length > 0, 'la ventana de conmutación debe ser finita y positiva');
  invariant(Number.isFinite(circuit.statorResistance) && circuit.statorResistance >= 0,
    'la resistencia del estator debe ser finita y no negativa');
  invariant(Number.isFinite(circuit.leakageInductance) && circuit.leakageInductance > 0,
    'la inductancia de dispersión debe ser positiva');
  const end = start + length;
  const values: Record<Phase, number[]> = { U: [], V: [], W: [] };
  if (output.mode === 'off' || output.switchingKHz <= 0 || output.dcBus <= 0)
    return { times: [start, end], values: { U: [0, 0], V: [0, 0], W: [0, 0] } };
  const period = 1 / (1000 * output.switchingKHz);
  const plans = new Map<number, Record<Phase, RipplePeriod | null>>();
  const times = new Set<number>([start, end]);
  const first = Math.floor(start / period);
  // Start with a local periodic approximation, then carry current through the
  // leading PWM sequence. Target eight R-L time constants within a fixed budget;
  // initial-state accuracy is limited when L/R exceeds the warmup horizon.
  const settling = circuit.statorResistance > 0 ? 8 * circuit.leakageInductance / circuit.statorResistance : 0;
  const leading = Math.min(512, Math.max(2, Math.ceil(settling / period)));
  const incoming: Partial<Record<Phase, number>> = {};
  for (let index = first - leading; index * period < end; index++) {
    const from = index * period;
    const row = {
      U: ripplePeriod(input, 'U', from, period, incoming.U),
      V: ripplePeriod(input, 'V', from, period, incoming.V),
      W: ripplePeriod(input, 'W', from, period, incoming.W),
    };
    for (const phase of PHASES) {
      const plan = row[phase];
      if (plan) incoming[phase] = rippleAt(input, plan, plan.steps.edges.at(-1)!);
    }
    if (index >= first) plans.set(index, row);
    for (const phase of PHASES) for (const edge of row[phase]?.steps.edges ?? [])
      if (edge > start && edge < end) times.add(edge);
  }
  // Exact switching corners retain ripple extrema; extra points resolve the sine.
  for (let index = 1; index < 600; index++) times.add(start + length * index / 600);
  const ordered = [...times].sort((a, b) => a - b);
  for (const time of ordered) {
    // The last point belongs to the preceding interval, not a missing next plan.
    const index = Math.min(Math.floor(time / period), Math.ceil(end / period) - 1);
    const row = plans.get(index) ?? plans.get(index + 1)!;
    const fundamental = phaseCurrents(output, time);
    for (const phase of PHASES) values[phase].push(row[phase] ? fundamental[phase] + rippleAt(input, row[phase], time) : 0);
  }
  return { times: ordered, values };
}
