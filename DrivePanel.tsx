// Keypad and display of the drive front, after the user guide, page 56.
import { onCleanup } from 'solid-js';
import type { JSX } from 'solid-js';
import { DISPLAY, KEYS, PANEL_INFO, ROUTE } from './layout';
import { place, usePress, useSimulator } from './ui';

/** A keypad key; a click without a pointer (assistive technology) also activates it. */
function Key(props: { id: keyof typeof KEYS; label: string; handlers: JSX.HTMLAttributes<HTMLButtonElement>; activate: () => void; children: JSX.Element }): JSX.Element {
  return (
    <button id={props.id} {...place(KEYS[props.id], 'key')} aria-label={props.label} {...props.handlers}
      onClick={event => { if (event.detail === 0) props.activate(); }}>{props.children}</button>
  );
}

/** ENT acts on release; held 2 s it confirms tCC and FCS, which need a long press. */
function EnterKey(): JSX.Element {
  const sim = useSimulator();
  let hold: { started: number; timer: number; confirmed: boolean } | null = null;
  const cancel = (): void => { if (hold) window.clearTimeout(hold.timer); hold = null; };
  const begin = (): void => {
    cancel();
    const started = performance.now();
    const timer = window.setTimeout(() => {
      const editing = sim.panelSnapshot().editing;
      if (hold && editing && ['FUn.tCC.ACt', 'FUn.FCS'].includes(editing)) { sim.enter(2000); hold.confirmed = true; }
    }, 2000);
    hold = { started, timer, confirmed: false };
  };
  const end = (): void => {
    if (!hold) return;
    const completed = hold;
    cancel();
    if (!completed.confirmed) sim.enter(performance.now() - completed.started);
  };
  onCleanup(cancel);
  return <Key id="ent" label="ENT" handlers={usePress({ press: begin, release: end, cancel })} activate={() => sim.enter()}>ENT</Key>;
}

/** Arrow keys repeat while held, faster after a while. */
function ArrowKey(props: { id: 'up' | 'down' }): JSX.Element {
  const sim = useSimulator();
  const direction = props.id === 'up' ? 1 : -1;
  let timer: number | null = null;
  const stop = (): void => { if (timer !== null) window.clearTimeout(timer); timer = null; };
  const start = (): void => {
    stop(); sim.key(direction);
    let repetitions = 0;
    const repeat = (): void => {
      sim.key(direction); repetitions += 1;
      timer = window.setTimeout(repeat, repetitions > 15 ? 45 : 110);
    };
    timer = window.setTimeout(repeat, 450);
  };
  onCleanup(stop);
  return (
    <Key id={props.id} label={props.id === 'up' ? 'Subir' : 'Bajar'} handlers={usePress({ press: start, release: stop })} activate={() => sim.key(direction)}>
      <svg viewBox="0 0 30 24" aria-hidden="true"><path d={props.id === 'up' ? 'M15 2 L29 21 L1 21 Z' : 'M15 22 L29 3 L1 3 Z'} /></svg>
    </Key>
  );
}

export function DrivePanel(): JSX.Element {
  const sim = useSimulator();
  return <>
    <div id="display" {...place(DISPLAY)} role="status" aria-label="Pantalla del variador"
      classList={{ fault: sim.display().fault, flash: sim.flashing() }}>{sim.display().text}</div>
    <button id="esc" {...place(KEYS.esc, 'key')} aria-label="ESC" onClick={() => sim.escapeKey()}>ESC</button>
    <ArrowKey id="up" />
    <EnterKey />
    <ArrowKey id="down" />
    <div id="route" {...place({ x: ROUTE.x - 120, y: ROUTE.y - 12, w: 240, h: 24 })}>{sim.display().route}</div>
  </>;
}

export function PanelInfo(): JSX.Element {
  const sim = useSimulator();
  return (
    <section id="panel-info" {...place(PANEL_INFO)} aria-label="Pantalla">
      <h2>Pantalla</h2>
      <div id="caption" classList={{ fault: sim.display().fault }}>{sim.display().caption}</div>
      <ul>
        <li><kbd>▲</kbd> <kbd>▼</kbd> recorren el menú</li>
        <li><kbd>ENT</kbd> entra o guarda</li>
        <li><kbd>ESC</kbd> vuelve</li>
        <li>Rearme de fallas: abrir y cerrar la red</li>
      </ul>
      <div id="operator-note">{sim.operatorNote()}</div>
    </section>
  );
}
