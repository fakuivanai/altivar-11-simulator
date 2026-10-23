// Readings, the right-hand column (scope, nameplate, environment and files in tabs,
// with the load always visible), and the 3D motor canvas.
import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import type { JSX } from 'solid-js';
import { MOTOR_CANVAS, READINGS, SETTINGS } from './layout';
import { makeMotorView } from './motor-view';
import type { ValidConfiguration } from './configuration';
import { frictionScale, inertiaScale, percentScale, ratedSpeed, ratedTorque, startTime, torqueScale } from './scales';
import type { Scale } from './scales';
import { Scope } from './Scope';
import { Section, SliderLabel, Tabs, Ticks, place, useSimulator } from './ui';

/** A large reading with its caption. */
function Measure(props: { id: string; label: string; children: JSX.Element }): JSX.Element {
  return <div>{props.label}<output id={props.id}>{props.children}</output></div>;
}
/** One label and value row of the small readings table. */
function Row(props: { label: string; children: JSX.Element }): JSX.Element {
  return <><span>{props.label}</span>{props.children}</>;
}

export function Readings(): JSX.Element {
  const sim = useSimulator();
  const r = () => sim.readings();
  const state = () => {
    const current = r();
    return current.fault ? 'Fallo ' + current.fault : current.status === 'dcb' ? 'Inyección de corriente'
      : current.running ? 'En marcha' : current.status === 'nSt' ? 'Rueda libre' : 'Detenido';
  };
  return (
    <section id="readings" {...place(READINGS)} aria-label="Lecturas">
      <div class="big">
        <Measure id="rpm" label="Velocidad">{r().rpm.toFixed(0)} rpm</Measure>
        <Measure id="frequency" label="Frecuencia">{r().rFr.toFixed(1)} Hz</Measure>
        <Measure id="current" label="Corriente">{r().LCr.toFixed(2)} A</Measure>
        <Measure id="thermal" label="Térmico motor">{r().tHr.toFixed(0)} %</Measure>
      </div>
      <div class="state-row">
        <span id="run-state" classList={{ fault: r().fault !== null }}>{state()}</span>
        <span id="limit-state">{r().currentLimited ? 'Límite de corriente' : ''}</span>
      </div>
      <div class="table">
        <Row label="Bus de continua"><output id="dc-bus">{r().dcBus.toFixed(0)} V</output></Row>
        <Row label="Regeneración"><output id="regenerated-power">{r().regenerativePower.toFixed(0)} W</output></Row>
        <Row label="Fases">
          <span class="phases span3">
            <For each={['U', 'V', 'W'] as const}>{phase =>
              <span>{phase} <output id={'phase-current-' + phase}>{r()[`phaseCurrent${phase}`].toFixed(2)} A</output></span>}</For>
          </span>
        </Row>
        <Row label="Desequilibrio"><output id="current-imbalance">{r().currentImbalance.toFixed(0)} %</output></Row>
      </div>
    </section>
  );
}

type Motor = ValidConfiguration['motor'];
const percentText = (value: number): string => value.toFixed(value !== 0 && Math.abs(value) < 10 ? 1 : 0);
type NumericKey<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T] & string;

/** A number field bound to one configuration value; a refused value springs back. */
function NumberField<S extends 'motor' | 'inputs'>(props: {
  section: S; field: NumericKey<ValidConfiguration[S]>; label: JSX.Element; min: number; max: number; step: number;
}): JSX.Element {
  const sim = useSimulator();
  const value = (): number => {
    const found: unknown = sim.state.config[props.section][props.field];
    if (typeof found !== 'number') throw new Error('campo numérico desconocido ' + props.field);
    return found;
  };
  return (
    <label>{props.label}
      <input type="number" min={props.min} max={props.max} step={props.step} value={value()}
        onChange={event => {
          const commit = sim.commitExternal as (section: S, key: string, value: number) => boolean;
          if (!commit(props.section, props.field, event.currentTarget.valueAsNumber)) event.currentTarget.value = String(value());
        }} />
    </label>
  );
}

/** A slider over a relative scale; the reading shows both the relative and the stored SI value. */
function ScaledSlider(props: { id: string; label: string; scale: Scale; value: number; onChange: (value: number) => void; reading: JSX.Element; hint?: string }): JSX.Element {
  return (
    <div>
      <SliderLabel for={props.id} id={props.id + '-reading'} label={props.label}>{props.reading}</SliderLabel>
      <input id={props.id} type="range" min={props.scale.min} max={props.scale.max} step={props.scale.step}
        value={Math.min(props.scale.max, Math.max(props.scale.min, props.scale.toPosition(props.value)))}
        onInput={event => props.onChange(props.scale.fromPosition(event.currentTarget.valueAsNumber))} />
      <Ticks min={props.scale.min} max={props.scale.max} ticks={props.scale.ticks} />
      <Show when={props.hint}><div class="slider-hint">{props.hint}</div></Show>
    </div>
  );
}

const NAMEPLATE: ReadonlyArray<[string, NumericKey<Motor>, number, number, number]> = [
  ['Potencia kW', 'powerKW', .05, 3, .01], ['Tensión V', 'voltage', 100, 500, 1],
  ['Frecuencia Hz', 'frequency', 40, 200, 1], ['Corriente A', 'current', .1, 20, .01],
  ['Velocidad rpm', 'speedRPM', 50, 12000, 1], ['Cos φ', 'cosPhi', .1, 1, .01],
];

function Nameplate(): JSX.Element {
  const sim = useSimulator();
  const poles = () => sim.state.config.motor.poles;
  return (
    <Section title="Placa del motor">
      <div class="fields">
        <For each={NAMEPLATE}>{([label, field, min, max, step]) =>
          <NumberField section="motor" field={field} label={label} min={min} max={max} step={step} />}</For>
        <label>Polos
          <select id="motor-poles" value={poles()}
            onChange={event => { if (!sim.commitExternal('motor', 'poles', Number(event.currentTarget.value))) event.currentTarget.value = String(poles()); }}>
            <For each={[2, 4, 6, 8, 10, 12]}>{count => <option value={count}>{count}</option>}</For>
          </select>
        </label>
        <NumberField section="motor" field="inertia" label={<>Inercia, kg m<sup>2</sup></>} min={0.0001} max={2} step={0.0001} />
      </div>
      <p class="tab-note">El variador debe estar detenido para cambiar el motor.</p>
    </Section>
  );
}

function Load(): JSX.Element {
  const sim = useSimulator();
  const load = () => sim.state.config.mechanical;
  const motor = () => sim.state.config.motor;
  return (
    <Section title="Carga">
      <div class="mechanics">
        <ScaledSlider id="load" label="Par de carga" scale={torqueScale(motor())} value={load().torque}
          onChange={value => sim.commitExternal('mechanical', 'torque', value)}
          reading={`${percentText(100 * load().torque / ratedTorque(motor()))} % Tn (${load().torque.toFixed(2)} N m)`}
          hint={`Tn = ${ratedTorque(motor()).toFixed(2)} N m. Negativo: la carga arrastra al motor.`} />
        <ScaledSlider id="inertia" label="Inercia añadida" scale={inertiaScale(motor())} value={load().inertia}
          onChange={value => sim.commitExternal('mechanical', 'inertia', value)}
          reading={<>{(load().inertia / motor().inertia).toFixed(1)}x J motor ({load().inertia.toPrecision(2)} kg m<sup>2</sup>)</>}
          hint={`Sin carga ni fricción: ${startTime(motor(), load().inertia).toFixed(2)} s a par nominal. Escala logarítmica.`} />
        <ScaledSlider id="friction" label="Fricción viscosa" scale={frictionScale(motor())} value={load().friction}
          onChange={value => sim.commitExternal('mechanical', 'friction', value)}
          reading={`${percentText(load().friction * ratedSpeed(motor()) / ratedTorque(motor()) * 100)} % Tn a ${motor().speedRPM} rpm`}
          hint={`Proporcional a la velocidad: ${load().friction.toPrecision(2)} N m s/rad.`} />
      </div>
    </Section>
  );
}

function EnvironmentAndFiles(): JSX.Element {
  const sim = useSimulator();
  let picker: HTMLInputElement | undefined;
  return <>
    <Section title="Ambiente">
      <div class="environment fields">
        <NumberField section="inputs" field="ambient" label="Temperatura, °C" min={0} max={60} step={1} />
        <ScaledSlider id="ventilation" label="Ventilación" scale={percentScale()} value={sim.state.config.inputs.ventilation}
          onChange={value => sim.commitExternal('inputs', 'ventilation', value)}
          reading={`${(100 * sim.state.config.inputs.ventilation).toFixed(0)} %`} />
      </div>
    </Section>
    <Section title="Configuración">
      <div class="file-row">
        <button id="export" onClick={() => sim.download()}>Descargar</button>
        <button id="choose-file" onClick={() => picker?.click()}>Cargar</button>
        <output id="file-name">{sim.state.fileName || 'Sin archivo'}</output>
      </div>
      <input id="import" ref={picker} type="file" accept=".json,application/json"
        onChange={async event => {
          const input = event.currentTarget, file = input.files?.[0];
          if (!file) return;
          await sim.importFile(file);
          input.value = '';
        }} />
    </Section>
  </>;
}

type RightTab = 'scope' | 'motor' | 'files';

/** Right column: the parts that matter while running stay visible; setup goes in tabs. */
export function Settings(): JSX.Element {
  const [tab, setTab] = createSignal<RightTab>('scope');
  return (
    <section id="settings" {...place(SETTINGS)} aria-label="Ondas, motor, carga y archivos">
      <div class="tab-area">
        <Tabs label="Panel derecho" value={tab()} onChange={setTab} tabs={[
          { id: 'scope', title: 'Ondas', content: () => <Scope /> },
          { id: 'motor', title: 'Placa del motor', content: () => <Nameplate /> },
          { id: 'files', title: 'Ambiente y archivos', content: () => <EnvironmentAndFiles /> },
        ]} />
      </div>
      <Load />
    </section>
  );
}

/** WebGL motor; it draws on every simulator frame without going through signals. */
export function MotorCanvas(): JSX.Element {
  const sim = useSimulator();
  let canvas: HTMLCanvasElement | undefined;
  onMount(() => {
    if (!canvas) throw new Error('falta el canvas del motor');
    const view = makeMotorView(canvas);
    const stop = sim.onFrame(angle => view.draw(angle));
    onCleanup(() => { stop(); view.dispose(); });
  });
  return <canvas id="motor-canvas" ref={canvas} {...place(MOTOR_CANVAS)} role="img"
    aria-label="Motor tridimensional con aletas, eje y disco de carga marcado" />;
}
