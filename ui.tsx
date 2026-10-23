// Shared component helpers: the simulator context, stage placement, press-and-hold
// handling and small building blocks used across the panels.
import { For, Show, createContext, onCleanup, useContext } from 'solid-js';
import type { JSX } from 'solid-js';
import type { Box } from './layout';
import type { BooleanInput, Simulator } from './simulator';

const SimulatorContext = createContext<Simulator>();
export const SimulatorProvider = SimulatorContext.Provider;

export function useSimulator(): Simulator {
  const simulator = useContext(SimulatorContext);
  if (!simulator) throw new Error('Los componentes del simulador necesitan SimulatorProvider.');
  return simulator;
}

/** Absolute position on the 1600 x 900 stage. */
export function at(box: Box): JSX.CSSProperties {
  return { left: box.x + 'px', top: box.y + 'px', width: box.w + 'px', height: box.h + 'px' };
}

/** Spread on an element to place it on the stage: {...place(BOX, 'key')}. */
export function place(box: Box, className = ''): { class: string; style: JSX.CSSProperties } {
  return { class: className ? className + ' placed' : 'placed', style: at(box) };
}

/** Runs a callback when the window loses focus, for as long as the component lives. */
export function useWindowBlur(callback: () => void): void {
  window.addEventListener('blur', callback);
  onCleanup(() => window.removeEventListener('blur', callback));
}

const isActivationKey = (event: KeyboardEvent): boolean => event.key === ' ' || event.key === 'Enter';

/**
 * Handlers for a control that acts while it is held: pointer or Space/Enter.
 * Pointer capture keeps the release even if the pointer leaves the button, and
 * losing focus (or the window losing it) counts as releasing.
 * enabled() lets a control behave as a press-and-hold only in some modes; cancel(),
 * when given, handles an interrupted press instead of release().
 */
export function usePress(handlers: { press: () => void; release: () => void; cancel?: () => void; enabled?: () => boolean }): JSX.HTMLAttributes<HTMLButtonElement> {
  const enabled = handlers.enabled ?? (() => true);
  const release = (): void => { if (enabled()) handlers.release(); };
  const cancel = (): void => { if (enabled()) (handlers.cancel ?? handlers.release)(); };
  useWindowBlur(cancel);
  return {
    onPointerDown: event => {
      if (!enabled()) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); handlers.press();
    },
    onPointerUp: release, onPointerCancel: cancel, onLostPointerCapture: cancel, onBlur: cancel,
    // suppress native repeat clicks; the held control supplies its own repetition.
    onKeyDown: event => {
      if (!enabled() || !isActivationKey(event)) return;
      event.preventDefault();
      if (!event.repeat) handlers.press();
    },
    onKeyUp: event => { if (enabled() && isActivationKey(event)) { event.preventDefault(); release(); } },
  };
}

/** A button that flips one boolean bench input and shows its state. */
export function ToggleButton(props: {
  id: string; input: BooleanInput; box: Box; class?: string; label?: string; title?: string; children?: JSX.Element;
}): JSX.Element {
  const sim = useSimulator();
  return (
    <button id={props.id} {...place(props.box, props.class)} aria-pressed={sim.state.config.inputs[props.input]}
      aria-label={props.label} title={props.title} onClick={() => sim.toggleInput(props.input)}>{props.children}</button>
  );
}

/** A titled block in a side panel. */
export function Section(props: { title: string; children: JSX.Element }): JSX.Element {
  return <div><h2>{props.title}</h2>{props.children}</div>;
}

/** Label and value laid out as a slider heading. */
export function SliderLabel(props: { for: string; label: string; children: JSX.Element; id?: string }): JSX.Element {
  return <div class="slider-label"><label for={props.for}>{props.label}</label><output id={props.id}>{props.children}</output></div>;
}

/** Tick labels under a range input, positioned along its travel. */
export function Ticks(props: { min: number; max: number; ticks: ReadonlyArray<readonly [number, string]> }): JSX.Element {
  const left = (position: number): string => (100 * (position - props.min) / (props.max - props.min)) + '%';
  return (
    <div class="ticks" aria-hidden="true">
      <For each={props.ticks}>{([position, label]) => <span style={{ left: left(position) }}>{label}</span>}</For>
    </div>
  );
}

/** A segmented control: one button per option, the selected one pressed. */
export function Segmented<T extends string>(props: {
  label: string; value: T; options: ReadonlyArray<readonly [T, string]>; onChange: (value: T) => void; idPrefix?: string;
}): JSX.Element {
  return (
    <div class="segmented" role="group" aria-label={props.label}>
      <For each={props.options}>{([value, text]) =>
        <button id={props.idPrefix ? props.idPrefix + value : undefined} aria-pressed={props.value === value}
          onClick={() => props.onChange(value)}>{text}</button>}</For>
    </div>
  );
}

/** Tabs whose panels stay mounted only while selected. */
export function Tabs<T extends string>(props: {
  label: string; value: T; onChange: (value: T) => void;
  tabs: ReadonlyArray<{ id: T; title: string; content: () => JSX.Element }>;
}): JSX.Element {
  return <>
    <div class="tabs" role="tablist" aria-label={props.label}>
      <For each={props.tabs}>{tab =>
        <button id={'tab-' + tab.id} role="tab" aria-selected={props.value === tab.id} aria-controls={'panel-' + tab.id}
          onClick={() => props.onChange(tab.id)}>{tab.title}</button>}</For>
    </div>
    <For each={props.tabs}>{tab =>
      <Show when={props.value === tab.id}>
        <div id={'panel-' + tab.id} class="tab-panel" role="tabpanel" aria-labelledby={'tab-' + tab.id}>{tab.content()}</div>
      </Show>}</For>
  </>;
}
