import { diagnosisLines } from './diagnosis';
// Study panel for the learning page: explains the display, the selected menu or
// parameter, active faults and the drive's present behaviour, and lists the whole
// configuration. It only reads the simulator state and calls navigate.
import { For, Match, Show, Switch, createEffect, createMemo, createSignal } from 'solid-js';
import type { JSX } from 'solid-js';
import { CATALOG } from './configuration';
import type { CatalogItem, CodeValue } from './configuration';
import type { FaultCode } from './engine-types';
import { DISPLAY_STATES, FAULTS, MENUS, PARAMETERS, manualLink } from './guide-content';
import { catalogItem } from './simulator';
import { LOGIC_INPUTS } from './engine-types';
import { useSimulator } from './ui';

const ELEMENT_HELP: Readonly<Record<string, string>> = {
  'power-breaker': 'Seccionador de red: alimenta R/L1 y S/L2/N. Después de eliminar la causa, corte la alimentación, espere que se apague la pantalla y vuelva a conectarla. En este modelo el corte debe durar más de 0,4 s.',
  esc: 'ESC: sale del menú o parámetro y descarta el valor mostrado.',
  up: 'Flecha arriba: menú o parámetro anterior, o aumenta el valor.',
  down: 'Flecha abajo: menú o parámetro siguiente, o disminuye el valor.',
  ent: 'ENT: entra en un menú o parámetro, o guarda el valor mostrado; la pantalla parpadea al guardar. No da marcha.',
  'analog-position': 'Ajusta la señal aplicada a AI1. En 0 a 5 V representa un potenciómetro entre +5V y 0V; en 0 a 10 V o 0 a 20 mA representa una fuente externa. Con PI activo, AI1 mide la realimentación del proceso.',
  'analog-type': 'Señal física que llega a AI1. Debe coincidir con AIt / ACt.',
  'phase-U': 'Contacto del conductor U hacia el motor. En el modelo, abrir uno de los tres conductores permite observar la alimentación del motor por dos conductores, el par reducido y las corrientes desequilibradas.',
  'phase-V': 'Seccionador del conductor V hacia el motor.',
  'phase-W': 'Seccionador del conductor W hacia el motor.',
  'short-bridge': 'Puente entre U y V en la salida del variador, antes de los contactos del motor. Al energizar la salida, el modelo dispara SCF.',
  'brake-module': 'Módulo de frenado entre PA/+ y PC/- con su resistencia. Disipa la energía que devuelve el motor. Su capacidad de frenado es limitada.',
  'hold-shaft': 'Aplica un freno de par finito mientras se mantiene pulsado. El eje recorre un ángulo hasta detenerse. Con salida energizada, pueden subir la corriente y el estado térmico.',
  'supply-field': 'Tensión de la red monofásica. Este modelo usa unos 293 V para OSF y unos 163 V para USF; son umbrales del modelo, no especificaciones del fabricante.',
  'scope-canvas': 'Osciloscopio: Registro conserva muestras del transitorio físico promediado. Las vistas 2 períodos y Zoom 2 ms reconstruyen el régimen del estado actual. El zoom agrega rizado de corriente sin modificar el motor.',
  'scope-history': 'Registro temporal del motor, con tensión y corriente, par y velocidad, o flujo y bus.',
  'scope-arm': 'Arma una captura única del evento elegido, con tiempo previo y posterior al disparo.',
  'scope-live': 'Vuelve al registro continuo después de una captura.',
  'scope-periods': 'Muestra dos períodos de la salida. Con muchos pulsos por píxel, el gris marca entre qué niveles conmuta la tensión.',
  'scope-zoom': 'Ventana de 2 ms para ver pulsos y rizado de corriente. El control deslizante elige el punto del período de U. Es una reconstrucción local de régimen permanente.',
  'voltage-line': 'Tensión entre las salidas U y V: pulsos de 0 y más o menos la tensión del bus. Su valor medio es la tensión de línea fundamental.',
  'voltage-phase': 'Tensión de U al neutro de la estrella del motor: escalones de un tercio y dos tercios del bus. Su valor medio es la tensión de fase.',
  'voltage-pole': 'Tensión de la rama U respecto del negativo del bus: conmuta entre 0 y la tensión del bus. Su valor medio incluye la mitad del bus y la componente homopolar de la modulación.',
  'sound-toggle': 'Sonido aproximado: el silbido a la frecuencia de conmutación (cambie SFr para oírlo), el zumbido magnético al doble de la frecuencia de salida y el ruido mecánico con la velocidad.',
  'fullscreen-toggle': 'Pantalla completa. En teléfonos intenta además fijar la orientación horizontal.',
  ...Object.fromEntries(LOGIC_INPUTS.map(id => [id,
    id + ': contacto entre el borne ' + id + ' y +15V. Cerrado es estado 1. Su función depende de la programación (ver Configuración).'])),
};

function unit(metadata: CatalogItem): string { return 'unit' in metadata && metadata.unit ? ' ' + metadata.unit : ''; }
function show(value: CodeValue | null | undefined, metadata: CatalogItem): string {
  if (value === null || value === undefined) return '';
  if (metadata.id === 'SUP.COd') return value === 0 ? 'OFF' : value === -1 ? 'On' : String(value);
  return String(value) + unit(metadata);
}
function menuName(path: readonly string[]): string { return MENUS[path.join('.')]?.name ?? path[path.length - 1] ?? ''; }
/** Writes a catalog condition with menu codes instead of internal identifiers. */
function readableCondition(condition: string): string {
  return condition.replace(/\b(?:FUn|AIt|drC|SUP)\.([\w.]+)/g, (_, rest: string) => rest.split('.').join(' / ')).replace(/!=/g, ' distinto de ').replace(/==/g, ' igual a ');
}

function useParameters() {
  const sim = useSimulator();
  const value = (id: CatalogItem['id']): CodeValue | undefined => {
    const metadata = catalogItem(id);
    return metadata.kind === 'monitor' ? undefined : sim.state.config.parameters[metadata.id];
  };
  const isDefault = (metadata: CatalogItem): boolean =>
    !('default' in metadata) || metadata.default === null || value(metadata.id) === metadata.default;
  return { value, isDefault };
}

const Code = (props: { children: string }) => <span class="code">{props.children}</span>;
/** A heading made of a drive code and its name. */
const CodeTitle = (props: { code: string; children: JSX.Element }) => <h3><Code>{props.code}</Code>{props.children}</h3>;
/** One label and value pair inside a <dl class="facts">. */
const Fact = (props: { label: string; children: JSX.Element }) => <><dt>{props.label}</dt><dd>{props.children}</dd></>;
/** A bulleted list of plain texts. */
const Bullets = (props: { items: readonly string[] }) => <ul class="diagnosis"><For each={props.items}>{item => <li>{item}</li>}</For></ul>;

function Crumbs(props: { trail: readonly string[] }): JSX.Element {
  return (
    <div class="crumbs">Primer nivel
      <For each={props.trail}>{(code, index) => <> / {code} {menuName(props.trail.slice(0, index() + 1))}</>}</For>
    </div>
  );
}

function ManualLink(props: { metadata: CatalogItem }): JSX.Element {
  const link = () => manualLink(props.metadata.source);
  return <a href={link().url} target="_blank">{link().label}</a>;
}

function ParameterCard(props: { metadata: CatalogItem; draft: CodeValue | null; trail: readonly string[]; editing: boolean }): JSX.Element {
  const parameters = useParameters();
  const m = () => props.metadata;
  const text = () => PARAMETERS[m().id];
  const stored = () => parameters.value(m().id);
  const pending = () => props.editing && props.draft !== null && props.draft !== stored();
  return <>
    <Crumbs trail={props.trail} />
    <CodeTitle code={m().code}>{m().label}</CodeTitle>
    <Show when={text()}>{found => <div>{found().text}</div>}</Show>
    <dl class="facts">
      <Show when={m().kind !== 'monitor'} fallback={<Fact label="Lectura">sólo lectura, en marcha o parado</Fact>}>
        <Fact label="Valor guardado"><span classList={{ changed: !parameters.isDefault(m()) }}>{show(stored(), m())}</span></Fact>
        <Show when={pending()}><Fact label="En edición">{show(props.draft, m())}  (ENT guarda, ESC descarta)</Fact></Show>
        <Fact label="Inicial del simulador">{show(m().default, m())}</Fact>
        <Show when={m().kind === 'numeric'}>
          <Fact label={m().rangeBasis ? 'Rango del simulador' : 'Rango'}>{m().id === 'SUP.COd' ? 'OFF, On o código de 2 a 999' : `${m().min} a ${m().max}${unit(m())}`}</Fact>
        </Show>
        <Fact label="En marcha">{m().runEditable ? 'se puede cambiar' : 'sólo con el variador parado'}</Fact>
        <Show when={m().holdSeconds}>{seconds => <Fact label="Confirmación">mantener ENT {seconds()} s</Fact>}</Show>
        <Show when={m().condition}>{condition => <Fact label="Aparece si">{readableCondition(condition())}</Fact>}</Show>
      </Show>
      <Fact label="Fuente"><ManualLink metadata={m()} /></Fact>
    </dl>
    <Show when={m().choices}>{choices =>
      <ul class="choices">
        <For each={choices()}>{choice =>
          <li classList={{ current: choice === stored(), draft: props.editing && choice === props.draft }}>
            <code>{String(choice)}</code> {text()?.choices?.[String(choice)] ?? ''}
          </li>}</For>
      </ul>}</Show>
    <Show when={text()?.tip}>{tip => <div class="tip">{tip()}</div>}</Show>
    <Show when={m().note}>{note => <div class="note">Nota del registro: {note()}</div>}</Show>
    <Show when={props.editing && m().kind !== 'monitor'}><div class="keys-help">Subir y Bajar cambian el valor. ENT guarda y la pantalla parpadea. ESC descarta.</div></Show>
    <Show when={props.editing && m().kind === 'monitor'}><div class="keys-help">Lectura de supervisión. ENT la memoriza como visualización en marcha. ESC vuelve al menú.</div></Show>
  </>;
}

function ScreenCard(): JSX.Element {
  const sim = useSimulator();
  const panel = () => sim.panelSnapshot();
  // Only these fields matter here, so the card does not rebuild on every frame.
  const fault = createMemo(() => sim.readings().fault);
  const running = createMemo(() => sim.readings().running);
  const status = createMemo(() => sim.readings().status);
  const selection = () => sim.selected();
  return (
    <div class="card">
      <Switch>
        <Match when={!sim.state.config.inputs.powered}>
          <h3>Pantalla apagada</h3><div>Sin tensión de red. Cierre el seccionador de red.</div>
        </Match>
        <Match when={panel().editing}>{id =>
          <ParameterCard metadata={catalogItem(id())} draft={panel().draft} trail={panel().trail} editing={true} />}</Match>
        <Match when={panel().index === -1}>
          <Switch>
            <Match when={fault()}>{code => <>
              <CodeTitle code={code()}>{FAULTS[code()].name}</CodeTitle>
              <div>El código parpadea mientras dura la falla. Las causas y el rearme están abajo.</div>
            </>}</Match>
            <Match when={running()}>
              <h3>En marcha: muestra <Code>{panel().monitor}</Code>{sim.monitorLabel(panel().monitor)}</h3>
              <div>En marcha la pantalla muestra el valor de supervisión elegido en SUP. Para cambiarlo, entre a SUP, elija la lectura y pulse ENT dos veces.</div>
            </Match>
            <Match when={true}>
              <CodeTitle code={status() || 'rdY'}>{DISPLAY_STATES[status() || 'rdY'] ?? ''}</CodeTitle>
            </Match>
          </Switch>
          <div class="keys-help">Pulse Subir o Bajar para entrar al menú de primer nivel.</div>
        </Match>
        <Match when={selection()?.kind === 'parameter' ? selection() : undefined}>{item => {
          const found = item();
          return found.kind === 'parameter' ? <ParameterCard metadata={catalogItem(found.id)} draft={null} trail={panel().trail} editing={false} /> : null;
        }}</Match>
        <Match when={selection()}>{item => {
          const menu = () => MENUS[[...panel().trail, item().code].join('.')];
          return <>
            <Crumbs trail={panel().trail} />
            <CodeTitle code={item().code}>{menu()?.name ?? 'Menú'}</CodeTitle>
            <div>{menu()?.text ?? ''}</div>
            <div class="keys-help">ENT entra al menú. Subir y Bajar recorren las opciones. ESC vuelve.</div>
            <Show when={item().code === 'SUP' && sim.state.locked}>
              <div class="tip">El terminal está bloqueado por código: sólo se ve SUP. Desbloquee en SUP / COd.</div>
            </Show>
          </>;
        }}</Match>
      </Switch>
    </div>
  );
}

/** The active fault, or the last one after it was cleared. */
function FaultCard(): JSX.Element {
  const sim = useSimulator();
  const active = createMemo(() => sim.readings().fault);
  const [last, setLast] = createSignal<FaultCode | null>(null);
  createEffect(() => { const fault = active(); if (fault) setLast(fault); });
  const shown = () => active() ?? last();
  return (
    <Show when={shown()}>{code => {
      const text = () => FAULTS[code()];
      const parameters = () => sim.state.config.parameters;
      return (
        <div class="card" classList={{ fault: active() !== null }}>
          <CodeTitle code={code()}>{(active() ? '' : 'Última falla, ya rearmada: ') + text().name}</CodeTitle>
          <dl class="facts"><Fact label="Detecta">{text().detects}</Fact><Fact label="En el simulador">{text().simulator}</Fact></dl>
          <div>Qué revisar</div>
          <Bullets items={text().remedies} />
          <div>Rearme</div>
          <ul class="diagnosis">
            <li>Eliminar la causa, cortar la red, esperar que se apague la pantalla y volver a conectarla. En este modelo el corte debe superar 0,4 s.</li>
            <Show when={text().logicReset}>
              <li>{parameters()['FUn.rSF'] !== 'nO' ? `Dar una transición de 0 a 1 en ${parameters()['FUn.rSF']} (función rSF), una vez eliminada la causa.` : 'Por entrada lógica, si se asigna rSF en FUn y se elimina la causa.'}</li>
            </Show>
            <Show when={text().autoReset && parameters()['FUn.Atr'] === 'YES'}><li>Rearranque automático Atr activo. Reintenta si desaparece la causa y se mantienen la referencia y la orden del sentido de marcha.</li></Show>
          </ul>
          <div class="note">Fuente: manual del fabricante, Fallos, causas, soluciones, págs. 66 y 67. Los umbrales y tiempos indicados como simulación son elecciones del modelo.</div>
        </div>
      );
    }}</Show>
  );
}

/** Present behaviour comes from the same physical state that drives the bench. */
function Diagnosis(): JSX.Element {
  const sim = useSimulator();
  const lines = createMemo(() => diagnosisLines(sim.state.config, sim.readings()), [], {
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  return (
    <div class="card">
      <ul class="diagnosis"><For each={lines()}>{([level, text]) => <li class={level}>{text}</li>}</For></ul>
      <div class="note">Las corrientes U, V y W, su desequilibrio, la tensión del bus y la potencia devuelta son mediciones del modelo fuera de SUP. La respuesta mecánica y los tiempos térmicos son aproximados.</div>
    </div>
  );
}

/** Whole configuration, grouped by menu; a row click moves the panel there. */
function ConfigurationTable(): JSX.Element {
  const sim = useSimulator();
  const parameters = useParameters();
  const [onlyChanged, setOnlyChanged] = createSignal(false);
  const selected = createMemo(() => {
    const panel = sim.panelSnapshot(), selection = sim.selected();
    return panel.editing ?? (selection?.kind === 'parameter' && panel.index >= 0 ? selection.id : null);
  });
  const rows = createMemo(() => CATALOG.filter(metadata => !onlyChanged() || (metadata.kind !== 'monitor' && !parameters.isDefault(metadata))));
  const startsGroup = (index: number): boolean => {
    const list = rows(), previous = list[index - 1], current = list[index];
    return !!current && (!previous || previous.path.join('.') !== current.path.join('.'));
  };
  return (
    <div class="card">
      <div class="cfg-tools">
        <label><input type="checkbox" checked={onlyChanged()} onChange={event => setOnlyChanged(event.currentTarget.checked)} /> Sólo valores distintos del inicio del simulador</label>
      </div>
      <div class="note">La guía permite ir a un parámetro pulsando su fila. Es un atajo de esta página; en el equipo se usan las teclas. En gris: no disponible en el panel con la configuración, el bloqueo o la alimentación actuales.</div>
      <table class="cfg"><tbody>
        <For each={rows()}>{(metadata, index) => {
          const shown = () => sim.canNavigate(metadata.id);
          return <>
            <Show when={startsGroup(index())}>
              <tr><th colspan="3">{metadata.path.length ? metadata.path.join(' / ') + '  ' + menuName(metadata.path) : 'Primer nivel'}</th></tr>
            </Show>
            <tr class="row" classList={{ hidden: !shown(), selected: selected() === metadata.id }} title={metadata.label}
              tabindex={shown() ? 0 : -1} aria-disabled={!shown()}
              onClick={() => { if (shown()) sim.navigate(metadata.id); }}
              onKeyDown={event => { if (shown() && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); sim.navigate(metadata.id); } }}>
              <td><code>{metadata.code}</code></td>
              <td>{metadata.label}</td>
              <td class="value" classList={{ changed: !parameters.isDefault(metadata) }}>
                {metadata.kind === 'monitor' ? 'lectura' : show(parameters.value(metadata.id), metadata)}
              </td>
            </tr>
          </>;
        }}</For>
      </tbody></table>
    </div>
  );
}

/** Desktop layout: stage on the left with explanations below, study panel on the right. */
export function GuideLayout(props: { stage: (host: () => HTMLElement | undefined) => JSX.Element }): JSX.Element {
  const [element, setElement] = createSignal('');
  let host: HTMLDivElement | undefined;
  return (
    <div class="guide-layout">
      <div class="guide-left">
        <div id="stage-host" ref={host} onPointerOver={event => {
          const target = event.target instanceof Element ? event.target.closest('[id]') : null;
          const text = target ? ELEMENT_HELP[target.id] : undefined;
          if (text) setElement(text);
        }}>{props.stage(() => host)}</div>
        <div class="guide-lower">
          <section><h2>Qué está pasando</h2><Diagnosis /></section>
          <section><h2>Elemento del esquema</h2>
            <div class="card element-help">{element() || 'Pase el puntero sobre un contacto, una tecla o un botón del esquema para ver qué hace.'}</div>
          </section>
        </div>
      </div>
      <aside id="guide" aria-label="Guía de estudio">
        <h2>En pantalla</h2>
        <ScreenCard />
        <FaultCard />
        <h2>Configuración</h2>
        <ConfigurationTable />
      </aside>
    </div>
  );
}
