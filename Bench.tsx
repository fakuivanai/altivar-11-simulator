// Clickable parts of the schematic: transparent hit areas over the drawn contacts,
// the reference potentiometer and the fault actions.
import { For } from 'solid-js';
import type { JSX } from 'solid-js';
import {
  ANALOG_SELECT, ANALOG_SLIDER, BRAKE, CONTROL_TARGET, DISCONNECT, HINT, HOLD_BUTTON, MODE_BUTTON,
  PHASE_Y, SHORT_BUTTON, SUPPLY, SUPPLY_FIELD, SWITCH, inputPurposeBox,
} from './layout';
import { LOGIC_INPUTS, PHASES } from './engine-types';
import type { LogicInputId } from './engine-types';
import { ToggleButton, place, usePress, useSimulator } from './ui';

/** A logic input contact: a maintained switch toggles on click, a pushbutton acts while held. */
function LogicInput(props: { id: LogicInputId }): JSX.Element {
  const sim = useSimulator();
  const x = CONTROL_TARGET[props.id];
  const closed = () => sim.state.config.inputs[props.id];
  const momentary = () => sim.state.config.inputModes[props.id] === 'button';
  const role = () => sim.inputRole(props.id);
  const set = (value: boolean): void => { sim.commitExternal('inputs', props.id, value); };
  const press = usePress({ enabled: momentary, press: () => set(true), release: () => { if (closed()) set(false); } });
  return <>
    <button id={props.id} {...place({ x: x - SWITCH.width / 2 - 8, y: SWITCH.top - 4, w: SWITCH.width + 8, h: SWITCH.bottom - SWITCH.top + 8 }, 'contact logic')}
      classList={{ active: closed() }} aria-pressed={closed()}
      aria-label={`${props.id} ${role() || 'sin función'}: ${closed() ? 'cerrado' : 'abierto'}`}
      {...press} onClick={() => { if (!momentary()) set(!closed()); }} />
    <div id={props.id + '-purpose'} {...place(inputPurposeBox(props.id), 'purpose')} title={role()}>{role()}</div>
    <button id={props.id + '-mode'} {...place({ x: x - MODE_BUTTON.w / 2, y: MODE_BUTTON.y, w: MODE_BUTTON.w, h: MODE_BUTTON.h }, 'mode')}
      aria-label={'Tipo de mando ' + props.id}
      onClick={() => sim.commitExternal('inputModes', props.id, momentary() ? 'switch' : 'button')}>
      {momentary() ? 'Pulsador' : 'Interruptor'}
    </button>
  </>;
}

function Supply(): JSX.Element {
  const sim = useSimulator();
  const inputs = () => sim.state.config.inputs;
  return <>
    <ToggleButton id="power-breaker" input="powered" box={SUPPLY.breaker} class={inputs().powered ? 'contact' : 'contact open'}
      label="Interruptor de red" title={inputs().powered ? 'Abrir la red' : 'Cerrar la red'} />
    <label id="supply-field" {...place(SUPPLY_FIELD)}>
      Red monofásica<br />
      <input type="number" aria-label="Tensión de red" min="0" max="350" step="1" value={inputs().supplyV}
        onChange={event => {
          if (!sim.commitExternal('inputs', 'supplyV', event.currentTarget.valueAsNumber)) event.currentTarget.value = String(inputs().supplyV);
        }} /> V
    </label>
  </>;
}

function AnalogReference(): JSX.Element {
  const sim = useSimulator();
  const inputs = () => sim.state.config.inputs;
  return <>
    <input id="analog-position" {...place(ANALOG_SLIDER)} type="range" min="0" max="100" step="1"
      aria-label={inputs().analogType === '5V' ? 'Potenciómetro AI1' : 'Fuente externa AI1'} value={inputs().analogPosition}
      onInput={event => sim.commitExternal('inputs', 'analogPosition', event.currentTarget.valueAsNumber)} />
    <div id="analog-reading" {...place({ x: ANALOG_SLIDER.x, y: ANALOG_SLIDER.y + 28, w: ANALOG_SLIDER.w, h: 22 })}>{sim.analogReading()}</div>
    <select id="analog-type" {...place(ANALOG_SELECT)} aria-label="Tipo de señal en AI1" value={inputs().analogType}
      onChange={event => {
        const value = event.currentTarget.value;
        if (value === '5V' || value === '10V' || value === '20mA') sim.commitExternal('inputs', 'analogType', value);
      }}>
      <option value="5V">0 a 5 V</option><option value="10V">0 a 10 V</option><option value="20mA">0 a 20 mA</option>
    </select>
  </>;
}

function MotorConnections(): JSX.Element {
  const sim = useSimulator();
  const inputs = () => sim.state.config.inputs;
  return <>
    <For each={PHASES}>{phase => {
      const connected = () => inputs().outputConnections[phase];
      return (
        <button id={'phase-' + phase} {...place({ x: DISCONNECT.x, y: PHASE_Y[phase] - 20, w: DISCONNECT.w, h: DISCONNECT.h }, 'contact phase')}
          aria-pressed={connected()} aria-label={(connected() ? 'Abrir' : 'Cerrar') + ' el conductor ' + phase}
          title={(connected() ? 'Abrir ' : 'Cerrar ') + phase} onClick={() => sim.togglePhase(phase)}>
          <span class="name">{phase}</span>
        </button>
      );
    }}</For>
    <ToggleButton id="short-bridge" input="shortCircuit" box={SHORT_BUTTON} class="fault-action">
      {inputs().shortCircuit ? 'Quitar corto' : 'Corto U-V'}
    </ToggleButton>
    <ToggleButton id="brake-module" input="brakeModule" box={BRAKE} label="Módulo de frenado">
      <svg viewBox="0 0 40 20" aria-hidden="true"><path d="M0 10 H8 M32 10 H40" /><path d="M8 4 H32 V16 H8 Z" /></svg>
      <span>Módulo de frenado</span>
      <span id="brake-state" class="state">{inputs().brakeModule ? 'Conectado' : 'No'}</span>
    </ToggleButton>
  </>;
}

export function HoldShaft(): JSX.Element {
  const sim = useSimulator();
  const held = () => sim.state.config.inputs.shaftHeld;
  const press = usePress({
    press: () => sim.commitExternal('inputs', 'shaftHeld', true),
    release: () => { if (held()) sim.commitExternal('inputs', 'shaftHeld', false); },
  });
  return (
    <button id="hold-shaft" {...place(HOLD_BUTTON, 'fault-action')} aria-pressed={held()} title="Mantener pulsado" {...press}>
      {held() ? 'Eje bloqueado' : 'Bloquear eje'}
    </button>
  );
}

export function Bench(): JSX.Element {
  return <>
    <Supply />
    <For each={LOGIC_INPUTS}>{id => <LogicInput id={id} />}</For>
    <AnalogReference />
    <MotorConnections />
    <HoldShaft />
    <div id="hint" {...place(HINT)}>
      <b>Cómo usar el esquema</b><br />
      Pulse un contacto para abrirlo o cerrarlo: red, LI1 a LI4 y conductores U, V, W. Los botones rojos provocan fallas.
      Bloquear eje actúa mientras se mantiene pulsado.
    </div>
  </>;
}
