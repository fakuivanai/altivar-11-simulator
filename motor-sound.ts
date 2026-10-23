// Optional motor sound with Web Audio, off until the user turns it on (browsers only
// allow audio after a user gesture). Teaching approximation of what a VFD-fed motor
// sounds like, not a recording or an acoustic model:
//  - switching whine: magnetostriction at the switching frequency, with sidebands at
//    fs +/- 2f; louder with current. 2 to 4 kHz is clearly audible, 16 kHz barely.
//  - magnetic hum at twice the output frequency, with the flux (voltage over frequency).
//  - mechanical and fan noise: filtered noise that rises with speed.
import type { LiveReadings } from './simulator';

const MASTER = 0.12;
const SMOOTHING = 0.05;

interface Voices {
  context: AudioContext;
  master: GainNode;
  carrier: OscillatorNode; carrierGain: GainNode;
  lower: OscillatorNode; upper: OscillatorNode; sidebandGain: GainNode;
  hum: OscillatorNode; humGain: GainNode;
  noiseFilter: BiquadFilterNode; noiseGain: GainNode;
}

function oscillator(context: AudioContext, type: OscillatorType, destination: AudioNode): OscillatorNode {
  const node = context.createOscillator();
  node.type = type;
  node.connect(destination);
  node.start();
  return node;
}
function gain(context: AudioContext, destination: AudioNode): GainNode {
  const node = context.createGain();
  node.gain.value = 0;
  node.connect(destination);
  return node;
}

function build(): Voices {
  const context = new AudioContext();
  const master = gain(context, context.destination);
  master.gain.value = MASTER;
  const carrierGain = gain(context, master), sidebandGain = gain(context, master), humGain = gain(context, master);
  const carrier = oscillator(context, 'sine', carrierGain);
  const lower = oscillator(context, 'sine', sidebandGain), upper = oscillator(context, 'sine', sidebandGain);
  const hum = oscillator(context, 'triangle', humGain);
  // Two seconds of looping white noise through a band-pass for the mechanical part.
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let k = 0; k < data.length; k++) data[k] = Math.random() * 2 - 1;
  const noise = context.createBufferSource();
  noise.buffer = buffer; noise.loop = true;
  const noiseFilter = context.createBiquadFilter();
  noiseFilter.type = 'bandpass'; noiseFilter.Q.value = 0.8;
  const noiseGain = gain(context, master);
  noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noise.start();
  return { context, master, carrier, carrierGain, lower, upper, sidebandGain, hum, humGain, noiseFilter, noiseGain };
}

export interface MotorSound {
  /** Starts or resumes audio; call from a click handler. */
  start(): Promise<void>;
  stop(): void;
  update(readings: LiveReadings, ratedRPM: number, ratedVoltage: number, ratedCurrent: number): void;
  dispose(): void;
}

export function makeMotorSound(): MotorSound {
  let voices: Voices | null = null;
  // a late resume must respect a later stop or disposal, without an audible restart.
  let enabled = false;
  let disposed = false;
  const mute = (current: Voices): void => {
    current.master.gain.cancelScheduledValues(current.context.currentTime);
    current.master.gain.value = 0;
  };
  const suspend = (current: Voices): void => {
    mute(current);
    if (current.context.state !== 'closed') void current.context.suspend().catch(() => {});
  };
  const set = (param: AudioParam, value: number): void => {
    if (voices) param.setTargetAtTime(value, voices.context.currentTime, SMOOTHING);
  };
  return {
    async start() {
      if (disposed) return;
      enabled = true;
      const current = voices ??= build();
      try { await current.context.resume(); }
      catch (error: unknown) {
        if (enabled && !disposed) throw error;
        return;
      }
      if (!enabled || disposed) { suspend(current); return; }
      current.master.gain.setTargetAtTime(MASTER, current.context.currentTime, SMOOTHING);
    },
    stop() { enabled = false; if (voices) suspend(voices); },
    update(r, ratedRPM, ratedVoltage, ratedCurrent) {
      if (!enabled || !voices || voices.context.state !== 'running') return;
      const ac = r.outputMode === 'ac', on = r.outputMode !== 'off';
      const fs = 1000 * r.switchingFrequency, f = Math.abs(r.frequency);
      const load = Math.min(r.current / Math.max(ratedCurrent, 0.1), 2);
      const flux = ac ? Math.min(r.voltage / Math.max(f, 2) / (ratedVoltage / 50), 1.5) : 0;
      set(voices.carrier.frequency, fs);
      set(voices.lower.frequency, Math.max(20, fs - 2 * f));
      set(voices.upper.frequency, fs + 2 * f);
      // The whine is present whenever the inverter switches, even at no load.
      set(voices.carrierGain.gain, on ? 0.12 + 0.35 * load : 0);
      set(voices.sidebandGain.gain, ac ? 0.12 * load : 0);
      set(voices.hum.frequency, Math.max(20, 2 * f));
      set(voices.humGain.gain, ac ? 0.35 * flux * Math.min(f / 10, 1) : 0);
      const speed = Math.min(Math.abs(r.rpm) / Math.max(ratedRPM, 1), 2);
      set(voices.noiseFilter.frequency, 150 + 900 * speed);
      set(voices.noiseGain.gain, 0.5 * speed * speed);
    },
    dispose() {
      disposed = true;
      enabled = false;
      const current = voices;
      voices = null;
      if (current) {
        mute(current);
        if (current.context.state !== 'closed') void current.context.close().catch(() => {});
      }
    },
  };
}
