// Slider scales for the mechanical load, relative to the motor's own nameplate so
// that the whole travel is useful for any motor. The configuration still stores
// SI values (N m, kg m2, N m s/rad); these functions only map slider positions.
import type { ValidConfiguration } from './configuration';

type Motor = ValidConfiguration['motor'];
/** Limits enforced by configuration.ts for the stored values. */
const LIMITS = { torque: 20, friction: 0.2, inertia: 2 } as const;

export function ratedSpeed(motor: Motor): number { return motor.speedRPM * Math.PI / 30; }
/** Rated torque from the nameplate: P / omega. */
export function ratedTorque(motor: Motor): number { return 1000 * motor.powerKW / Math.max(ratedSpeed(motor), 0.01); }

function clamp(value: number, low: number, high: number): number { return Math.min(high, Math.max(low, value)); }

export interface Scale {
  /** Slider travel, in its own units. */
  min: number; max: number; step: number;
  toPosition(value: number): number;
  fromPosition(position: number): number;
  /** Tick labels under the slider, by position. */
  ticks: ReadonlyArray<readonly [number, string]>;
}

/** Load torque as a percentage of rated torque. Negative values drive the motor. */
export function torqueScale(motor: Motor): Scale {
  const rated = ratedTorque(motor);
  const min = Math.max(-100, -100 * LIMITS.torque / rated);
  const max = Math.min(200, 100 * LIMITS.torque / rated);
  return {
    min, max, step: Math.min(1, (max - min) / 300),
    toPosition: torque => 100 * torque / rated,
    fromPosition: percent => clamp(Math.round(percent * rated) / 100, -LIMITS.torque, LIMITS.torque),
    ticks: [[min, `${Number(min.toFixed(1))} %`], [0, '0'],
      ...(max > 100 ? [[100, '100 %'] as const] : []), [max, `${Number(max.toFixed(1))} %`]],
  };
}

/**
 * Viscous friction as the braking torque it produces at rated speed, in percent of
 * rated torque: b = percent x Tn / omega_n.
 */
export function frictionScale(motor: Motor): Scale {
  const perPercent = ratedTorque(motor) / Math.max(ratedSpeed(motor), 0.01) / 100;
  const max = Math.min(100, LIMITS.friction / perPercent);
  return {
    min: 0, max, step: Math.min(1, max / 100),
    toPosition: friction => friction / perPercent,
    fromPosition: percent => clamp(Math.round(percent * perPercent * 1e6) / 1e6, 0, LIMITS.friction),
    ticks: [[0, '0'], [max / 2, `${Number((max / 2).toFixed(1))} %`], [max, `${Number(max.toFixed(1))} %`]],
  };
}

/** Added inertia on a logarithmic scale, in multiples of the motor's own inertia; position 0 is none. */
export function inertiaScale(motor: Motor): Scale {
  const own = motor.inertia, low = 0.1;
  const high = Math.min(1000, LIMITS.inertia / own);
  const decades = Math.log10(high / low);
  const span = 100;
  const position = (multiple: number): number => 1 + (span - 1) * Math.log10(multiple / low) / decades;
  return {
    min: 0, max: span, step: 1,
    toPosition: inertia => inertia <= 0 ? 0 : clamp(1 + (span - 1) * Math.log10(inertia / own / low) / decades, 1, span),
    fromPosition: position => position <= 0 ? 0
      : clamp(Number((own * low * 10 ** (decades * (position - 1) / (span - 1))).toPrecision(3)), 0, LIMITS.inertia),
    ticks: [[0, '0'], ...[1, 10, 100].filter(multiple => multiple < high && position(multiple) < 88)
      .map(multiple => [position(multiple), `${multiple}x`] as const), [span, `${Number(high.toPrecision(3))}x`]],
  };
}

/** Time to reach rated speed from rest with rated torque and no load: (J motor + J load) omega_n / Tn. */
export function startTime(motor: Motor, addedInertia: number): number {
  return (motor.inertia + addedInertia) * ratedSpeed(motor) / ratedTorque(motor);
}

/** A plain 0 to 100 % slider over a stored 0 to 1 fraction. */
export function percentScale(step = 5): Scale {
  return {
    min: 0, max: 100, step,
    toPosition: fraction => 100 * fraction,
    fromPosition: percent => clamp(percent / 100, 0, 1),
    ticks: [[0, '0'], [50, '50 %'], [100, '100 %']],
  };
}
