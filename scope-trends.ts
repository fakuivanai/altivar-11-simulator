// Original display-only time-window integration of recorded physical samples.
// Squared voltage/current use trapezoidal quadrature, followed by a square root.
// The recorder and frozen captures retain the unmodified signed samples.
import type { Phase } from './engine-types';
import type { ScopeSample } from './scope-history';
import { invariant } from './invariant';

export const SCOPE_TREND_WINDOW = .1;
const DISPLAY_INTERVAL = .005;
const METRIC_COUNT = 7;
export interface ScopeTrendSample {
  readonly time: number;
  readonly voltageRms: number;
  readonly currentRms: Readonly<Record<Phase, number>>;
  readonly torqueMean: number;
  readonly fluxMean: number;
  readonly dcBusMean: number;
  readonly rpm: number;
  readonly loadTorque: number;
}
function metric(sample: ScopeSample, index: number): number {
  switch (index) {
    case 0: return (sample.voltage.U - sample.voltage.V) ** 2;
    case 1: return sample.current.U ** 2;
    case 2: return sample.current.V ** 2;
    case 3: return sample.current.W ** 2;
    case 4: return sample.torque;
    case 5: return sample.flux;
    default: return sample.dcBus;
  }
}

/** Causal RMS/mean trends over at most 100 ms of available history. Uneven edge
 * samples are weighted by elapsed time, not by their count. Rendering is limited
 * to 200 points/s; physical acquisition and trigger precision remain unchanged. */
export function scopeTrends(samples: readonly ScopeSample[], window = SCOPE_TREND_WINDOW): ScopeTrendSample[] {
  invariant(Number.isFinite(window) && window > 0, 'la ventana eficaz debe ser positiva');
  if (samples.length === 0) return [];
  const first = samples[0]!;
  const totals = new Float64Array(METRIC_COUNT);
  const means = new Float64Array(METRIC_COUNT);
  const result: ScopeTrendSample[] = [];
  let left = 0, lastOutput = -Infinity;
  for (let index = 0; index < samples.length; index++) {
    const current = samples[index]!;
    invariant(Number.isFinite(current.time) && (index === 0 || current.time >= samples[index - 1]!.time),
      'el registro debe tener tiempos finitos y ordenados');
    if (index > 0) {
      const previous = samples[index - 1]!;
      const elapsed = current.time - previous.time;
      for (let channel = 0; channel < METRIC_COUNT; channel++)
        totals[channel]! += (metric(previous, channel) + metric(current, channel)) * elapsed / 2;
    }
    const cutoff = current.time - window;
    while (left < index && samples[left + 1]!.time <= cutoff) {
      const from = samples[left]!, to = samples[left + 1]!;
      for (let channel = 0; channel < METRIC_COUNT; channel++)
        totals[channel]! -= (metric(from, channel) + metric(to, channel)) * (to.time - from.time) / 2;
      left++;
    }
    if (index !== samples.length - 1 && current.time - lastOutput < DISPLAY_INTERVAL - 1e-10) continue;
    const duration = current.time - Math.max(first.time, cutoff);
    const from = samples[left]!, to = samples[Math.min(left + 1, index)]!;
    const partial = Math.max(0, cutoff - from.time);
    const fraction = to.time > from.time ? partial / (to.time - from.time) : 0;
    for (let channel = 0; channel < METRIC_COUNT; channel++) {
      const start = metric(from, channel);
      const atCutoff = start + (metric(to, channel) - start) * fraction;
      const area = totals[channel]! - (start + atCutoff) * partial / 2;
      means[channel] = duration > 0 ? area / duration : metric(current, channel);
    }
    result.push({
      time: current.time, voltageRms: Math.sqrt(Math.max(0, means[0]!)),
      currentRms: { U: Math.sqrt(Math.max(0, means[1]!)), V: Math.sqrt(Math.max(0, means[2]!)),
        W: Math.sqrt(Math.max(0, means[3]!)) },
      torqueMean: means[4]!, fluxMean: means[5]!, dcBusMean: means[6]!,
      rpm: current.rpm, loadTorque: current.loadTorque,
    });
    lastOutput = current.time;
  }
  return result;
}
