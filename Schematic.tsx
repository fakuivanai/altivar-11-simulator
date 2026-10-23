import { invariant } from './invariant';
// Original wiring drawing for the stage. Geometry comes from layout.ts; the control
// fan and the motor leads are built so that no two conductors cross. Only the
// contacts, the wiper and the U-V short follow the simulator state.
import { For, Show } from 'solid-js';
import type { JSX } from 'solid-js';
import {
  BRAKE, BRAKE_TOP, BUS_Y, CONTROL_STRIP, CONTROL_TARGET, CONTROL_TERMINALS, COVER, DISCONNECT, DO_BOX,
  DRIVE, FAN_STEP, FAN_TOP, MOTOR_BOX, PHASE_Y, POT, POWER_OUTPUTS, POWER_STRIP, RELAY, SHORT_X,
  STAGE, STRIP_Y, SUPPLY, SWITCH, controlTerminalX, powerTerminalX,
} from './layout';
import type { Box, ControlTerminal } from './layout';
import { LOGIC_INPUTS, PHASES } from './engine-types';
import type { Phase } from './engine-types';
import { useSimulator } from './ui';

const RADIUS = 5.5;
const START = STRIP_Y + RADIUS;

const Terminal = (props: { x: number; y: number }) => <circle class="terminal" cx={props.x} cy={props.y} r={RADIUS} />;
const Dot = (props: { x: number; y: number }) => <circle class="node" cx={props.x} cy={props.y} r={3.2} />;
const Rect = (props: { box: Box; rx?: number; class?: string }) =>
  <rect class={props.class ?? 'component'} x={props.box.x} y={props.box.y} width={props.box.w} height={props.box.h} rx={props.rx ?? 0} />;
function phaseX(phase: Phase): number { return powerTerminalX(POWER_OUTPUTS.indexOf(phase)); }

/** Where each control conductor reaches its component below the drive. */
function controlEnd(name: ControlTerminal): number {
  if (name === 'RC' || name === 'RA') return RELAY.y;
  if (name === '0V' || name === '+5V') return POT.y;
  if (name === 'AI1') return POT.wiperBend;
  if (name === 'DO') return DO_BOX.y;
  if (name === '+15V') return BUS_Y;
  return SWITCH.top;
}

/**
 * Conductors that move left turn in strip order, so the leftmost one turns first.
 * A later conductor's horizontal run then stays below every earlier vertical run.
 */
function fanPath(name: ControlTerminal, index: number): string {
  const from = controlTerminalX(index), to = CONTROL_TARGET[name], end = controlEnd(name);
  invariant(to <= from, 'el abanico de control sólo se abre hacia la izquierda');
  const bend = FAN_TOP + FAN_STEP * index;
  invariant(bend < end, 'el giro de ' + name + ' queda debajo de su componente');
  return to === from ? `M${from} ${START} V${end}` : `M${from} ${START} V${bend} H${to} V${end}`;
}

/** Strip label written upwards, as in the manufacturer's terminal drawing. */
const StripLabel = (props: { x: number; children: string }) => {
  const x = props.x + 4.5, y = STRIP_Y - 11;
  return <text x={x} y={y} class="strip-label" transform={`rotate(-90 ${x} ${y})`}>{props.children}</text>;
};

function Housing(): JSX.Element {
  const { x, y, w, h } = DRIVE, left = x + COVER.inset, right = x + w - COVER.inset, middle = x + w / 2;
  const cover = `M${left} ${COVER.top} H${right} V${COVER.sideBottom} Q${right} ${COVER.bottom - 10} ${middle} ${COVER.bottom}`
    + ` Q${left} ${COVER.bottom - 10} ${left} ${COVER.sideBottom} Z`;
  const supplyTerminals = [[SUPPLY.PE, 'PE'], [SUPPLY.L, 'R/L1'], [SUPPLY.N, 'S/L2/N']] as const;
  return (
    <g class="drive-outline">
      <rect class="housing" x={x} y={y} width={w} height={h} rx={4} />
      <path class="housing-line" d={`M${x} ${y + 42} H${x + w}`} />
      <For each={supplyTerminals}>{([px, label]) => <>
        <Terminal x={px} y={SUPPLY.terminalY} />
        <text x={px} y={SUPPLY.terminalY + 20} class="small" text-anchor="middle">{label}</text>
      </>}</For>
      <text x={x + 22} y={COVER.top - 8} class="brand">Altivar 11</text>
      <path class="cover" d={cover} />
      <Rect box={CONTROL_STRIP} class="strip" />
      <Rect box={POWER_STRIP} class="strip" />
      <For each={CONTROL_TERMINALS}>{(name, index) => <>
        <StripLabel x={controlTerminalX(index())}>{name}</StripLabel>
        <Terminal x={controlTerminalX(index())} y={STRIP_Y} />
      </>}</For>
      <For each={POWER_OUTPUTS}>{(name, index) => <>
        <StripLabel x={powerTerminalX(index())}>{name}</StripLabel>
        <Terminal x={powerTerminalX(index())} y={STRIP_Y} />
      </>}</For>
      <text x={CONTROL_STRIP.x} y={CONTROL_STRIP.y - 6} class="small muted">Bornes de control</text>
      <text x={POWER_STRIP.x + POWER_STRIP.w} y={POWER_STRIP.y - 6} class="small muted" text-anchor="end">Salida</text>
    </g>
  );
}

function Supply(): JSX.Element {
  const sim = useSimulator();
  const powered = () => sim.state.config.inputs.powered;
  const { L, N, PE, topY, terminalY, contactTop, contactBottom } = SUPPLY;
  const groundTop = terminalY - RADIUS - 40;
  const linkY = () => (powered() ? (contactTop + contactBottom) / 2 : contactTop + 14);
  const shift = () => (powered() ? 0 : 8);
  return <>
    <g class="wires">
      <For each={[L, N]}>{px => <>
        <path data-net={px === L ? 'L-source' : 'N-source'} d={`M${px} ${topY} V${contactTop}`} />
        <path data-net={px === L ? 'L' : 'N'} d={`M${px} ${contactBottom} V${terminalY - RADIUS}`} />
        <Dot x={px} y={contactTop} /><Dot x={px} y={contactBottom} />
        <path id={'breaker-' + px} class="blade" data-net={px === L ? 'L' : 'N'}
          data-connects={powered() ? (px === L ? 'L L-source' : 'N N-source') : undefined}
          d={powered() ? `M${px} ${contactTop} V${contactBottom}` : `M${px} ${contactBottom} L${px - 16} ${contactTop + 4}`} />
      </>}</For>
      <path data-net="PE" d={`M${PE} ${terminalY - RADIUS} V${groundTop} M${PE - 14} ${groundTop} H${PE + 14} M${PE - 9} ${groundTop - 5} H${PE + 9} M${PE - 4} ${groundTop - 10} H${PE + 4}`} />
      <path id="breaker-link" class="mechanical-link" d={`M${L - shift()} ${linkY()} H${N - shift()}`} />
    </g>
    <text x={L - 10} y={topY + 8} class="label" text-anchor="end">L</text>
    <text x={N - 10} y={topY + 8} class="label" text-anchor="end">N</text>
  </>;
}

function Relay(): JSX.Element {
  const sim = useSimulator();
  const closed = () => sim.readings().relay;
  const { y, left, right } = RELAY, a = left + 8, b = right - 8, middle = (left + right) / 2;
  return <>
    <g class="wires">
      <path data-net="RC" d={`M${left} ${y} H${a}`} />
      <path data-net="RA" d={`M${b} ${y} H${right}`} />
      <Dot x={a} y={y} /><Dot x={b} y={y} />
      <path id="relay-blade" class="blade" data-net="RC" data-connects={closed() ? 'RC RA' : undefined}
        d={closed() ? `M${a} ${y} H${b}` : `M${a} ${y} L${b - 2} ${y - 13}`} />
    </g>
    <text x={middle} y={y + 30} class="small" text-anchor="middle">Relé</text>
    <text id="relay" x={middle} y={y + 48} class="small" text-anchor="middle">{closed() ? 'cerrado' : 'abierto'}</text>
  </>;
}

function Potentiometer(): JSX.Element {
  const sim = useSimulator();
  const { y, left, right, body } = POT;
  const tip = y - body.h / 2 - 2;
  const wiper = () => {
    const position = sim.state.config.inputs.analogPosition / 100;
    invariant(position >= 0 && position <= 1, 'posición del potenciómetro fuera de rango');
    return body.x + 4 + (body.w - 8) * position;
  };
  return (
    <g class="wires">
      <Show when={sim.state.config.inputs.analogType === '5V'} fallback={<>
        <path data-net="0V" d={`M${left} ${y} H111`} />
        <path data-net="AI1" d={`M${CONTROL_TARGET.AI1} ${POT.wiperBend} V753`} />
        <circle class="component" cx={128} cy={y} r={17} />
        <text x={128} y={y + 5} class="tag" text-anchor="middle">{sim.state.config.inputs.analogType === '10V' ? 'V' : 'mA'}</text>
      </>}>
      <path data-net="0V" d={`M${left} ${y} H${body.x}`} />
      <path data-net="+5V" d={`M${body.x + body.w} ${y} H${right}`} />
      <rect class="component" x={body.x} y={y - body.h / 2} width={body.w} height={body.h} />
      <path id="pot-wiper" data-net="AI1" d={`M${CONTROL_TARGET.AI1} ${POT.wiperBend} H${wiper()} V${tip - 6}`} />
      <path id="pot-arrow" class="arrow" d={`M${wiper() - 5} ${tip - 8} L${wiper()} ${tip} L${wiper() + 5} ${tip - 8} Z`} />
      </Show>
    </g>
  );
}

function DigitalOutput(): JSX.Element {
  const sim = useSimulator();
  const text = () => {
    const current = sim.readings();
    return current.DOType === 'analog' ? (current.DO * 100).toFixed(0) + ' %' : current.DO ? '1' : '0';
  };
  const middle = DO_BOX.x + DO_BOX.w / 2;
  return <>
    <Rect box={DO_BOX} />
    <text x={middle} y={DO_BOX.y + 21} class="small" text-anchor="middle">DO</text>
    <text id="output" x={middle} y={RELAY.y + 30} class="small" text-anchor="middle">{text()}</text>
  </>;
}

function LogicContacts(): JSX.Element {
  const sim = useSimulator();
  const { top, bottom } = SWITCH, middle = (top + bottom) / 2;
  return <>
    <For each={LOGIC_INPUTS}>{id => {
      const x = CONTROL_TARGET[id];
      const closed = () => sim.state.config.inputs[id];
      const momentary = () => sim.state.config.inputModes[id] === 'button';
      // A pushbutton is drawn with its actuator; a maintained switch is not.
      const push = () => {
        if (!momentary()) return '';
        const bladeX = closed() ? x : x - 8;
        return `M${bladeX} ${middle} H${x - 20} M${x - 20} ${middle - 7} V${middle + 7}`;
      };
      return (
        <g class="wires">
          <Dot x={x} y={top} /><Dot x={x} y={bottom} />
          <path data-net="+15V" d={`M${x} ${bottom} V${BUS_Y}`} />
          <Dot x={x} y={BUS_Y} />
          <path id={id + '-blade'} class="blade" data-net="+15V" data-connects={closed() ? `${id} +15V` : undefined}
            d={closed() ? `M${x} ${bottom} V${top}` : `M${x} ${bottom} L${x - 15} ${top + 6}`} />
          <path id={id + '-push'} class="push" d={push()} />
        </g>
      );
    }}</For>
    <path class="wire" data-net="+15V" d={`M${CONTROL_TARGET.LI1} ${BUS_Y} H${CONTROL_TARGET['+15V']}`} />
  </>;
}

function TerminalTags(): JSX.Element {
  const sim = useSimulator();
  const names = ['RC', 'RA', '0V', 'AI1', '+5V', 'DO', 'LI1', 'LI2', 'LI3', 'LI4'] as const;
  return <>
    <For each={names}>{name => <Show when={name !== '+5V' || sim.state.config.inputs.analogType === '5V'}>
      <text x={CONTROL_TARGET[name] + 4} y={POT.wiperBend - 8} class="tag">{name}</text>
    </Show>}</For>
    <text x={CONTROL_TARGET['+15V'] + 5} y={BUS_Y - 6} class="tag">+15V</text>
  </>;
}

function MotorLeads(): JSX.Element {
  const sim = useSimulator();
  const left = DISCONNECT.x + 8, right = DISCONNECT.x + DISCONNECT.w - 8;
  return <>
    <g class="wires">
      <For each={PHASES}>{phase => {
        const x = phaseX(phase), y = PHASE_Y[phase];
        const closed = () => sim.state.config.inputs.outputConnections[phase];
        return <>
          <path data-net={phase} d={`M${x} ${START} V${y} H${left}`} />
          <Dot x={left} y={y} /><Dot x={right} y={y} />
          <path data-net={phase + '-motor'} d={`M${right} ${y} H${MOTOR_BOX.x - RADIUS}`} />
          <path id={'phase-' + phase + '-blade'} class="blade" data-net={phase}
            data-connects={closed() ? `${phase} ${phase}-motor` : undefined}
            d={closed() ? `M${left} ${y} H${right}` : `M${left} ${y} L${right - 3} ${y - 15}`} />
        </>;
      }}</For>
      <For each={[0, 1]}>{index => <path data-net={index === 0 ? 'PA' : 'PC'} d={`M${powerTerminalX(index)} ${START} V${BRAKE_TOP}`} />}</For>
    </g>
    <Rect box={MOTOR_BOX} rx={3} />
    <For each={PHASES}>{phase => <>
      <Terminal x={MOTOR_BOX.x} y={PHASE_Y[phase]} />
      <text x={MOTOR_BOX.x + 12} y={PHASE_Y[phase] + 6} class="label">{phase}</text>
    </>}</For>
    <g id="short-jumper" class="short" visibility={sim.state.config.inputs.shortCircuit ? 'visible' : 'hidden'}>
      <path data-net="U" data-connects="U V" d={`M${SHORT_X} ${PHASE_Y.V} V${PHASE_Y.U}`} />
      <Dot x={SHORT_X} y={PHASE_Y.V} /><Dot x={SHORT_X} y={PHASE_Y.U} />
    </g>
    <text x={MOTOR_BOX.x + MOTOR_BOX.w / 2} y={MOTOR_BOX.y + MOTOR_BOX.h + 20} class="small" text-anchor="middle">Bornes del motor</text>
  </>;
}

export function Schematic(): JSX.Element {
  const sim = useSimulator();
  return (
    <svg id="schematic" viewBox={`0 0 ${STAGE.width} ${STAGE.height}`} aria-hidden="true">
      <Housing />
      <Supply />
      <g class="wires"><For each={CONTROL_TERMINALS}>{(name, index) =>
        <Show when={name !== '+5V' || sim.state.config.inputs.analogType === '5V'}>
          <path data-net={name} d={fanPath(name, index())} />
        </Show>
      }</For></g>
      <Relay />
      <Potentiometer />
      <DigitalOutput />
      <LogicContacts />
      <TerminalTags />
      <MotorLeads />
      <Rect box={BRAKE} rx={3} />
    </svg>
  );
}
