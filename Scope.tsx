// Steady waveform details and slow recorded trends share the physical recorder.
import { createSignal } from 'solid-js';
import type { JSX } from 'solid-js';
import { displayNumber } from './format';
import type { ScopeHistoryStatus, ScopeTrigger } from './scope-history';
import { ScopeCanvas } from './ScopeCanvas';
import { ScopeControls } from './ScopeControls';
import type { HistoryChannels, ScopeView } from './ScopeControls';
import type { VoltageKind } from './waveforms';
import { useSimulator } from './ui';

export function Scope(): JSX.Element {
  const simulator = useSimulator();
  const [view, setView] = createSignal<ScopeView>('periods');
  const [channels, setChannels] = createSignal<HistoryChannels>('electrical');
  const [duration, setDuration] = createSignal(5);
  const [trigger, setTrigger] = createSignal<ScopeTrigger>(simulator.scopeHistory.trigger() ?? 'start');
  const [status, setStatus] = createSignal<ScopeHistoryStatus>(simulator.scopeHistory.status());
  const [angle, setAngle] = createSignal(60);
  const [voltage, setVoltage] = createSignal<VoltageKind>('line');
  function summary(): { output: string; current: string } {
    const output = simulator.readings().output;
    if (output.mode === 'off') return { output: 'Sin salida: el variador no alimenta al motor.', current: '' };
    const current = displayNumber(Math.max(output.current.U, output.current.V, output.current.W));
    if (output.mode === 'dc') {
      const phases = output.topology.source === null ? [] : [output.topology.source, ...output.topology.returns];
      const terminals = phases.length === 3 ? 'U y los retornos V, W' : phases.join(' y ');
      return {
        output: phases.length >= 2
          ? `Inyección de continua: ${displayNumber(output.voltage)} V entre ${terminals}.`
          : 'Inyección de continua sin circuito cerrado del motor.',
        current: `Corriente continua máxima ${current} A.`,
      };
    }
    const lag = output.currentLag;
    const frequency = displayNumber(Math.abs(output.frequency));
    const lineVoltage = displayNumber(output.voltage), bus = displayNumber(output.dcBus);
    const switching = view() === 'history' ? '' : `, PWM ${displayNumber(output.switchingKHz)} kHz`;
    return {
      output: `${frequency} Hz, ${lineVoltage} V de línea, bus ${bus} V${switching}.`,
      current: `Corriente ${current} A, desfase ${displayNumber(lag * 180 / Math.PI)}° `
        + `(cos φ ${displayNumber(Math.cos(lag))})${lag > Math.PI / 2 ? ': el motor devuelve energía.' : '.'}`,
    };
  }
  return <div class="scope">
    <ScopeControls view={view()} channels={channels()} duration={duration()} angle={angle()} voltage={voltage()}
      history={simulator.scopeHistory} trigger={trigger()} status={status()}
      onView={setView} onChannels={setChannels} onDuration={setDuration} onAngle={setAngle}
      onVoltage={setVoltage} onTrigger={setTrigger} onStatus={setStatus} />
    <ScopeCanvas view={view()} channels={channels()} duration={duration()} angle={angle()} voltage={voltage()}
      history={simulator.scopeHistory} readings={simulator.readings} circuit={simulator.motorCircuit} onStatus={setStatus} />
    <p id="scope-summary" class="scope-summary">
      {view() === 'history' ? 'Estado actual: ' : ''}{summary().output}<br />{summary().current}
    </p>
    <p class="tab-note">{view() === 'history'
      ? 'Eficaces y medias sobre 100 ms de historial disponible. Captura: 20% previo y 80% posterior al disparo.'
      : view() === 'zoom'
        ? 'Reconstrucción local en régimen permanente. Rizado R-L sin realimentar el modelo.'
        : 'Punto actual en régimen permanente. Promedio de tensión y corrientes fundamentales.'}</p>
  </div>;
}
