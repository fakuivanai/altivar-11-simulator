import { LOGIC_INPUTS, PHASES } from './engine-types';
import type { LogicInputId, Phase } from './engine-types';

// Fixed projection stage. Every wire, terminal and positioned control takes its
// coordinates from this module, so the drawing never depends on DOM measurement.
// The stage is scaled as a whole to fit the window.
export const STAGE = { width: 1600, height: 900 } as const;

export interface Point { readonly x: number; readonly y: number }
export interface Box { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

/** Drive housing, drawn after the manufacturer's front outline (not to scale). */
export const DRIVE: Box = { x: 300, y: 150, w: 360, h: 470 };
export const COVER = { top: 222, sideBottom: 430, bottom: 522, inset: 20 } as const;
export const DISPLAY: Box = { x: 345, y: 238, w: 270, h: 76 };
export const KEYS: Readonly<Record<'esc' | 'up' | 'ent' | 'down', Box>> = {
  esc: { x: 355, y: 334, w: 60, h: 44 },
  up: { x: 450, y: 334, w: 60, h: 44 },
  ent: { x: 545, y: 334, w: 60, h: 44 },
  down: { x: 450, y: 390, w: 60, h: 44 },
};
export const ROUTE: Point = { x: 480, y: 470 };

/** Control strip in the manufacturer's order; the unused position is omitted. */
export const CONTROL_TERMINALS = ['RC', 'RA', '0V', 'AI1', '+5V', 'DO', ...LOGIC_INPUTS, '+15V'] as const;
export type ControlTerminal = typeof CONTROL_TERMINALS[number];
export const POWER_OUTPUTS = ['PA/+', 'PC/-', ...PHASES] as const;
export type PowerOutput = typeof POWER_OUTPUTS[number];

export const STRIP_Y = 594;
export const CONTROL_STRIP: Box = { x: 310, y: 540, w: 224, h: 68 };
export const POWER_STRIP: Box = { x: 545, y: 540, w: 107, h: 68 };
export function controlTerminalX(index: number): number { return 322 + 20 * index; }
export function powerTerminalX(index: number): number { return 556 + 21 * index; }

/** Upper power terminals and the supply breaker. */
export const SUPPLY = {
  topY: 66, terminalY: 168,
  L: 480, N: 540, PE: 400,
  breaker: { x: 452, y: 88, w: 116, h: 52 } as Box,
  contactTop: 96, contactBottom: 132,
} as const;

/** Where each control conductor ends below the drive. */
export const CONTROL_TARGET: Readonly<Record<ControlTerminal, number>> = {
  RC: 26, RA: 58, '0V': 88, AI1: 128, '+5V': 168, DO: 205,
  LI1: 262, LI2: 330, LI3: 398, LI4: 466, '+15V': 522,
};
/** The first horizontal turn of the control fan; each further conductor turns lower. */
export const FAN_TOP = 634;
export const FAN_STEP = 9;
export const COMPONENT_TOP = 745;

export const RELAY = { y: 770, left: 26, right: 58 } as const;
export const POT = { y: 770, left: 88, right: 168, body: { x: 100, w: 56, h: 18 }, wiperBend: 742 } as const;
export const ANALOG_SLIDER: Box = { x: 70, y: 792, w: 116, h: 26 };
export const ANALOG_SELECT: Box = { x: 70, y: 852, w: 116, h: 32 };
export const DO_BOX: Box = { x: 188, y: 752, w: 36, h: 30 };
export const SWITCH = { top: 752, bottom: 806, width: 46 } as const;
export const BUS_Y = 818;
export const INPUT_LABEL_Y = 840;
export const MODE_BUTTON = { y: 852, h: 32, w: 66 } as const;

/** Motor leads leave the right strip, turn right at separate heights and cross the disconnects. */
export const PHASE_Y: Readonly<Record<Phase, number>> = { U: 708, V: 674, W: 640 };
export const DISCONNECT = { x: 676, w: 52, h: 30 } as const;
// Direct drive-output short, upstream of the removable motor connections.
export const SHORT_X = 666;
export const MOTOR_BOX: Box = { x: 880, y: 622, w: 44, h: 104 };
export const SHORT_BUTTON: Box = { x: 612, y: 744, w: 150, h: 40 };
export const BRAKE: Box = { x: 534, y: 690, w: 62, h: 92 };
export const BRAKE_TOP = 690;

export const PANEL_INFO: Box = { x: 22, y: 150, w: 262, h: 330 };
export const MOTOR_CANVAS: Box = { x: 700, y: 300, w: 412, h: 312 };
export const HOLD_BUTTON: Box = { x: 950, y: 644, w: 160, h: 64 };
export const HINT: Box = { x: 790, y: 772, w: 322, h: 116 };
export const READINGS: Box = { x: 700, y: 66, w: 412, h: 228 };
export const SETTINGS: Box = { x: 1134, y: 66, w: 450, h: 822 };

/** Input captions and supply editor share the stage's fixed geometry. */
export const SUPPLY_FIELD: Box = { x: 584, y: 66, w: 112, h: 76 };
export const INPUT_PURPOSE = { y: 826, w: 68, h: 22 } as const;
export function inputPurposeBox(id: LogicInputId): Box {
  return { x: CONTROL_TARGET[id] - INPUT_PURPOSE.w / 2, ...INPUT_PURPOSE };
}
