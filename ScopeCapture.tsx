import type { JSX } from 'solid-js';
import type { ScopeHistory, ScopeHistoryStatus, ScopeTrigger } from './scope-history';

export const SCOPE_TRIGGERS: Readonly<Record<ScopeTrigger, string>> = {
  start: 'Arranque', load: 'Escalón de carga', fault: 'Falla',
};
const STATUS_TEXT: Readonly<Record<ScopeHistoryStatus, string>> = {
  live: 'Continuo', armed: 'Armada', capturing: 'Capturando', complete: 'Retenida',
};
export interface ScopeCaptureProps {
  history: ScopeHistory;
  duration: number;
  trigger: ScopeTrigger;
  status: ScopeHistoryStatus;
  onTrigger: (value: ScopeTrigger) => void;
  onStatus: (value: ScopeHistoryStatus) => void;
}

/** Capture settings stay available without permanently displacing the plots. */
export function ScopeCapture(props: ScopeCaptureProps): JSX.Element {
  let disclosure: HTMLDetailsElement | undefined;
  function arm(): void {
    props.history.arm(props.trigger, { before: props.duration * .2, after: props.duration * .8 });
    props.onStatus('armed');
    if (disclosure) disclosure.open = false;
  }
  function resume(): void {
    props.history.resume();
    props.onStatus('live');
    if (disclosure) disclosure.open = false;
  }
  return <div class="scope-capture">
    <details id="scope-capture-settings" ref={disclosure}>
      <summary id="scope-capture-toggle">Captura</summary>
      <div class="scope-capture-options">
        <label>Disparo
          <select id="scope-trigger" value={props.trigger}
            onChange={event => props.onTrigger(event.currentTarget.value as ScopeTrigger)}>
            <option value="start">Arranque</option>
            <option value="load">Escalón de carga</option>
            <option value="fault">Falla</option>
          </select>
        </label>
        <button id="scope-arm" onClick={arm}>Armar</button>
        <button id="scope-live" onClick={resume}>Continuo</button>
      </div>
    </details>
    <output id="scope-capture-status" role="status"
      title={props.status === 'armed' ? 'Esperando: ' + SCOPE_TRIGGERS[props.trigger] : STATUS_TEXT[props.status]}>
      {STATUS_TEXT[props.status]}
    </output>
  </div>;
}
