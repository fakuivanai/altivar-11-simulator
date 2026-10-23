// Physical samples come from the averaged motor integration, never from the
// steady-state waveform drawing. The bounded recorder is independent of the UI.
import type { FaultCode, Phase } from './engine-types';
import { invariant } from './invariant';

export interface ScopeSample {
  readonly time: number;
  /** Averaged instantaneous phase-to-star voltage, V. */
  readonly voltage: Readonly<Record<Phase, number>>;
  /** Signed instantaneous conductor current, A. */
  readonly current: Readonly<Record<Phase, number>>;
  readonly torque: number;
  readonly rpm: number;
  /** Magnitude of the rotor flux linkage, Wb. */
  readonly flux: number;
  readonly dcBus: number;
  readonly running: boolean;
  readonly fault: FaultCode | null;
  readonly loadTorque: number;
}

export type ScopeTrigger = 'start' | 'load' | 'fault';
export type ScopeHistoryStatus = 'live' | 'armed' | 'capturing' | 'complete';
export interface ScopeCapture {
  readonly trigger: ScopeTrigger;
  readonly triggerTime: number;
  readonly start: number;
  readonly end: number;
  readonly samples: readonly ScopeSample[];
}
interface CaptureWindow { before: number; after: number }
interface HistoryOptions { duration?: number; sampleInterval?: number }

function ownedSample(sample: ScopeSample): ScopeSample {
  return Object.freeze({
    ...sample,
    voltage: Object.freeze({ ...sample.voltage }),
    current: Object.freeze({ ...sample.current }),
  });
}
function triggered(trigger: ScopeTrigger, previous: ScopeSample, sample: ScopeSample): boolean {
  if (trigger === 'start') return !previous.running && sample.running;
  if (trigger === 'fault') return previous.fault === null && sample.fault !== null;
  return Math.abs(sample.loadTorque - previous.loadTorque) > 1e-9;
}

export const SCOPE_HISTORY_DEFAULTS = Object.freeze({ duration: 10, sampleInterval: .0005 });
/** A ring buffer with one armed acquisition; completed captures stay unchanged. */
export function createScopeHistory(options: HistoryOptions = {}) {
  const duration = options.duration ?? SCOPE_HISTORY_DEFAULTS.duration;
  const sampleInterval = options.sampleInterval ?? SCOPE_HISTORY_DEFAULTS.sampleInterval;
  invariant(Number.isFinite(duration) && duration > 0, 'la duración del registro debe ser positiva');
  invariant(Number.isFinite(sampleInterval) && sampleInterval > 0, 'el intervalo del registro debe ser positivo');
  const capacity = Math.ceil(duration / sampleInterval) + 1;
  const ring: Array<ScopeSample | undefined> = new Array(capacity);
  let head = 0, count = 0;
  let previous: ScopeSample | undefined;
  let lastStored = -Infinity;
  let state: ScopeHistoryStatus = 'live';
  let armed: { trigger: ScopeTrigger; window: CaptureWindow } | undefined;
  let acquisition: { trigger: ScopeTrigger; triggerTime: number; start: number; end: number; samples: ScopeSample[] } | undefined;

  function samples(): readonly ScopeSample[] {
    const result: ScopeSample[] = [];
    for (let index = 0; index < count; index++) result.push(ring[(head + index) % capacity]!);
    return result;
  }
  function clear(): void {
    ring.fill(undefined);
    head = 0; count = 0; previous = undefined; lastStored = -Infinity;
    state = 'live'; armed = undefined; acquisition = undefined;
  }
  function resume(): void {
    state = 'live'; armed = undefined; acquisition = undefined;
  }
  function arm(trigger: ScopeTrigger, window: CaptureWindow = { before: 0.25, after: 1 }): void {
    invariant(Number.isFinite(window.before) && window.before >= 0 && window.before <= duration,
      'el tiempo previo debe caber en el registro');
    invariant(Number.isFinite(window.after) && window.after >= 0 && window.before + window.after > 0,
      'la ventana de captura debe ser positiva');
    invariant(window.before + window.after <= duration, 'la captura debe caber en el registro');
    armed = { trigger, window: { ...window } };
    acquisition = undefined;
    state = 'armed';
  }
  function push(value: ScopeSample): void {
    invariant(Number.isFinite(value.time), 'el tiempo del registro debe ser finito');
    if (previous && value.time < previous.time) clear();
    const fired = armed && previous && triggered(armed.trigger, previous, value);
    const stored = value.time - lastStored >= sampleInterval - 1e-10;
    // Edges are checked before decimation so a short command or fault is retained.
    const sample = ownedSample(value);
    if (stored) {
      if (count === capacity) { ring[head] = sample; head = (head + 1) % capacity; }
      else { ring[(head + count) % capacity] = sample; count++; }
      lastStored = value.time;
      while (count > 0 && ring[head]!.time < value.time - duration - 1e-10) {
        ring[head] = undefined; head = (head + 1) % capacity; count--;
      }
    }
    if (fired && armed) {
      const { trigger, window } = armed;
      const start = sample.time - window.before, end = sample.time + window.after;
      const before = samples().filter(item => item.time >= start && item.time < sample.time);
      acquisition = { trigger, triggerTime: sample.time, start, end, samples: [...before, sample] };
      armed = undefined;
      state = window.after === 0 ? 'complete' : 'capturing';
    } else if (state === 'capturing' && acquisition && stored) {
      if (sample.time <= acquisition.end + 1e-10) acquisition.samples.push(sample);
      if (sample.time >= acquisition.end - 1e-10) state = 'complete';
    }
    previous = sample;
  }
  function capture(): ScopeCapture | null {
    if (!acquisition) return null;
    return { ...acquisition, samples: acquisition.samples.slice() };
  }
  return {
    push, samples, arm, capture, clear, resume,
    status: (): ScopeHistoryStatus => state,
    trigger: (): ScopeTrigger | null => armed?.trigger ?? acquisition?.trigger ?? null,
  };
}
export type ScopeHistory = ReturnType<typeof createScopeHistory>;

export interface ScopePoint { time: number; value: number }
/** Preserve a narrow peak and trough in each bin while bounding canvas work. */
export function scopeTrace<T extends { readonly time: number }>(
  samples: readonly T[], value: (sample: T) => number, maxPoints = 1000,
): ScopePoint[] {
  invariant(Number.isInteger(maxPoints) && maxPoints >= 4, 'el trazado necesita al menos cuatro puntos');
  const point = (index: number): ScopePoint => ({ time: samples[index]!.time, value: value(samples[index]!) });
  if (samples.length <= maxPoints) return samples.map((_, index) => point(index));
  const bins = Math.floor((maxPoints - 2) / 2), interior = samples.length - 2;
  const result = [point(0)];
  for (let bin = 0; bin < bins; bin++) {
    const start = 1 + Math.floor(bin * interior / bins);
    const end = 1 + Math.floor((bin + 1) * interior / bins);
    let low = start, high = start;
    for (let index = start + 1; index < end; index++) {
      if (value(samples[index]!) < value(samples[low]!)) low = index;
      if (value(samples[index]!) > value(samples[high]!)) high = index;
    }
    for (const index of low === high ? [low] : [Math.min(low, high), Math.max(low, high)]) result.push(point(index));
  }
  result.push(point(samples.length - 1));
  return result;
}
