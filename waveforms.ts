// Output waveforms for the scope tab, synthesized from the drive's present state as
// if it were in steady state. The time origin is the rising zero crossing of the
// phase U reference, so the picture stands still like a triggered oscilloscope.
//
// Modulation: regular-sampled carrier PWM, as digital drives update the duty once per
// carrier period, with min-max zero-sequence injection (equivalent to space-vector
// modulation), which reaches a line voltage of Vdc / sqrt(2). Teaching model: the
// ATV11's exact modulation strategy is not documented in the manufacturer's manuals.
// Currents are the fundamental only; switching ripple depends on the motor's leakage
// inductance, which the simulator does not model.

import { PHASES } from './engine-types';
import type { Phase } from './engine-types';
export { PHASES };
export type { Phase };

export interface ScopeInput {
  mode: 'off' | 'ac' | 'dc';
  /** Signed output frequency, Hz; negative reverses the phase sequence. */
  frequency: number;
  /** Fundamental line-to-line voltage, V rms (in DC, voltage from injection source to returns). */
  voltage: number;
  dcBus: number;
  /** Switching frequency, kHz. */
  switchingKHz: number;
  /** Per-conductor current magnitudes, A rms in AC and constant A in DC. */
  current: Readonly<Record<Phase, number>>;
  /** Lag of the fundamental current behind the phase voltage, rad. */
  currentLag: number;
  /** Which motor conductors are connected. */
  connected: Readonly<Record<Phase, boolean>>;
}

/** A piecewise-constant signal: value[k] holds from edge[k] to edge[k + 1]. */
export interface Steps { edges: number[]; values: number[] }

const OFFSET: Readonly<Record<Phase, number>> = { U: 0, V: -2 * Math.PI / 3, W: 2 * Math.PI / 3 };
/** Lowest frequency drawn as a waveform; below it the window would be too long. */
export const MIN_SCOPE_FREQUENCY = 1;

function clamp(value: number, low: number, high: number): number { return Math.min(high, Math.max(low, value)); }

/** Electrical angle at time t after the trigger. */
export function angleAt(input: ScopeInput, t: number): number { return 2 * Math.PI * input.frequency * t; }

/** Duty of each leg (0 to 1) for the references at time t. */
export function duties(input: ScopeInput, t: number): Record<Phase, number> {
  if (input.mode === 'off' || input.dcBus <= 0) return { U: 0.5, V: 0.5, W: 0.5 };
  // Phase reference peaks: sqrt(2) Vll / sqrt(3) in AC; in DC, U carries +2/3 of the
  // U to V/W voltage and V, W carry -1/3 each.
  const reference: Record<Phase, number> = input.mode === 'dc'
    ? (() => {
      // The injection source follows the first connected conductor. An open U
      // therefore transfers injection to V/W instead of driving them identically.
      const connected = PHASES.filter(phase => input.connected[phase]);
      const result: Record<Phase, number> = { U: 0, V: 0, W: 0 };
      if (connected.length < 2) return result;
      for (const phase of connected)
        result[phase] = (phase === connected[0] ? connected.length - 1 : -1) * input.voltage / connected.length;
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
  if (!connected.U) return null;
  if (connected.V && connected.W) return { U: 2 / 3, V: -1 / 3, W: -1 / 3 };
  if (connected.V) return { U: 1 / 2, V: -1 / 2, W: 0 };
  if (connected.W) return { U: 1 / 2, V: 0, W: -1 / 2 };
  return null;
}

/**
 * The chosen voltage over [start, start + length], as exact switching edges. Each
 * carrier period samples the duty at its centre and turns each leg on for a centred
 * interval of that duty.
 */
export function outputVoltage(input: ScopeInput, kind: VoltageKind, start: number, length: number): Steps | null {
  const end = start + length, weights = legWeights(kind, input.connected);
  if (!weights) return null;
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
  const connected = PHASES.filter(phase => input.connected[phase] && input.current[phase] > 0);
  const result: Record<Phase, number> = { U: 0, V: 0, W: 0 };
  if (input.mode === 'off' || connected.length < 2) return result;
  if (input.mode === 'dc') {
    const [first, ...rest] = connected;
    result[first!] = input.current[first!];
    // Preserve the same per-conductor magnitudes used by the bench meters.
    for (const phase of rest) result[phase] = -input.current[phase];
    return result;
  }
  // so reversing the phase sequence also reverses its angular sign.
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
  const frequency = Math.max(Math.abs(input.frequency), MIN_SCOPE_FREQUENCY);
  if (!zoom) return { start: 0, length: 2 / frequency };
  // Centre the zoom window where phase U is at the chosen angle.
  const centre = zoom.angle / (2 * Math.PI * (input.frequency < 0 ? -frequency : frequency));
  return { start: centre - zoom.length / 2, length: zoom.length };
}

/** Upper end of an axis: the next 1, 2 or 5 step above the value. */
export function niceLimit(value: number, minimum: number): number {
  const target = Math.max(Math.abs(value), minimum);
  const decade = 10 ** Math.floor(Math.log10(target));
  for (const step of [1, 2, 5, 10]) if (step * decade >= target) return step * decade;
  return 10 * decade;
}
