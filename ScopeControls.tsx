import { Show } from 'solid-js';
import type { JSX } from 'solid-js';
import { displayNumber } from './format';
import type { ScopeHistory, ScopeHistoryStatus, ScopeTrigger } from './scope-history';
import type { VoltageKind } from './waveforms';
import { ScopeCapture } from './ScopeCapture';
import { Segmented } from './ui';

export type ScopeView = 'history' | 'periods' | 'zoom';
export type HistoryChannels = 'electrical' | 'mechanical' | 'magnetic';
export const SCOPE_VOLTAGES: Readonly<Record<VoltageKind, { button: string; label: string }>> = {
  line: { button: 'Línea UV', label: 'Tensión UV' },
  phase: { button: 'Fase UN', label: 'Tensión UN' },
  pole: { button: 'Rama U0', label: 'Tensión U0' },
};
interface ScopeControlsProps {
  view: ScopeView;
  channels: HistoryChannels;
  duration: number;
  angle: number;
  voltage: VoltageKind;
  history: ScopeHistory;
  trigger: ScopeTrigger;
  status: ScopeHistoryStatus;
  onView: (value: ScopeView) => void;
  onChannels: (value: HistoryChannels) => void;
  onDuration: (value: number) => void;
  onAngle: (value: number) => void;
  onVoltage: (value: VoltageKind) => void;
  onTrigger: (value: ScopeTrigger) => void;
  onStatus: (value: ScopeHistoryStatus) => void;
}

export function ScopeControls(props: ScopeControlsProps): JSX.Element {
  return <>
    <div class="scope-toolbar">
      <Segmented label="Ventana de tiempo" idPrefix="scope-" value={props.view} onChange={props.onView}
        options={[[ 'history', 'Registro' ], ['periods', '2 períodos'], ['zoom', 'Zoom 2 ms']]} />
      <Show when={props.view === 'history'}>
        <ScopeCapture history={props.history} duration={props.duration} trigger={props.trigger}
          status={props.status} onTrigger={props.onTrigger} onStatus={props.onStatus} />
      </Show>
    <Show when={props.view === 'zoom'}>
      <label class="scope-angle" for="scope-angle" title="Centro del zoom en grados eléctricos de U">Centro
        <input id="scope-angle" type="range" min="0" max="355" step="5" value={props.angle}
          onInput={event => props.onAngle(event.currentTarget.valueAsNumber)} />
        <output>{displayNumber(props.angle)}°</output>
      </label>
    </Show>
    </div>
    <Show when={props.view === 'history'} fallback={
      <Segmented label="Tensión mostrada" idPrefix="voltage-" value={props.voltage} onChange={props.onVoltage}
        options={(Object.keys(SCOPE_VOLTAGES) as VoltageKind[]).map(kind => [kind, SCOPE_VOLTAGES[kind].button] as const)} />
    }>
      <div class="scope-toolbar scope-channels">
        <Segmented label="Magnitudes registradas" idPrefix="scope-channels-"
          value={props.channels} onChange={props.onChannels}
          options={[[ 'electrical', 'Eficaces' ], ['mechanical', 'Par y velocidad'], ['magnetic', 'Flujo y bus']]} />
        <label>Ventana
          <select id="scope-duration" value={props.duration}
            onChange={event => props.onDuration(Number(event.currentTarget.value))}>
            <option value="1">1 s</option><option value="5">5 s</option><option value="10">10 s</option>
          </select>
        </label>
      </div>
    </Show>

  </>;
}
