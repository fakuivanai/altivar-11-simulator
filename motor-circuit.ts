import type { MotorSpecification } from './engine-types';

/** Star-equivalent per-phase values, rotor referred to stator. SI units. */
export interface MotorCircuitParameters { Rs: number; Rr: number; Lls: number; Llr: number; Lm: number }
export const MOTOR_CIRCUIT_RANGES = {
  Rs: [0.001, 1000], Rr: [0.001, 1000], Lls: [0.000001, 10],
  Llr: [0.000001, 10], Lm: [0.00001, 100],
} as const satisfies Record<keyof MotorCircuitParameters, readonly [number, number]>;
export interface MotorCircuit {
  readonly statorResistance: number;
  readonly rotorResistance: number;
  readonly statorLeakageInductance: number;
  readonly rotorLeakageInductance: number;
  readonly magnetizingInductance: number;
  readonly statorInductance: number;
  readonly rotorInductance: number;
  /** Ls - Lm^2/Lr, evaluated without cancellation. */
  readonly leakageInductance: number;
  readonly polePairs: number;
  readonly transientTimeConstant: number;
  readonly rotorTimeConstant: number;
}
export function makeMotorCircuit(parameters: Readonly<MotorCircuitParameters>, polePairs: number): MotorCircuit {
  for (const key of Object.keys(MOTOR_CIRCUIT_RANGES) as Array<keyof MotorCircuitParameters>) {
    const value = parameters[key], [min, max] = MOTOR_CIRCUIT_RANGES[key];
    if (!Number.isFinite(value) || value < min || value > max) throw new RangeError('Invalid motor circuit parameter: ' + key);
  }
  if (!Number.isInteger(polePairs) || polePairs < 1 || polePairs > 6) throw new RangeError('Invalid motor pole pairs.');
  const { Rs, Rr, Lls, Llr, Lm } = parameters;
  const rotorInductance = Llr + Lm, leakageInductance = Lls + Lm * Llr / rotorInductance;
  const coupling = Lm / rotorInductance;
  return Object.freeze({ statorResistance: Rs, rotorResistance: Rr,
    statorLeakageInductance: Lls, rotorLeakageInductance: Llr, magnetizingInductance: Lm,
    statorInductance: Lls + Lm, rotorInductance, leakageInductance, polePairs,
    transientTimeConstant: leakageInductance / (Rs + Rr * coupling * coupling),
    rotorTimeConstant: rotorInductance / Rr });
}
export function circuitParameters(circuit: MotorCircuit): MotorCircuitParameters {
  return { Rs: circuit.statorResistance, Rr: circuit.rotorResistance,
    Lls: circuit.statorLeakageInductance, Llr: circuit.rotorLeakageInductance, Lm: circuit.magnetizingInductance };
}
interface Complex { re: number; im: number }
const add = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });
const multiply = (a: Complex, b: Complex): Complex => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const divide = (a: Complex, b: Complex): Complex => {
  const square = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / square, im: (a.im * b.re - a.re * b.im) / square };
};
const magnitudeSquared = (a: Complex): number => a.re * a.re + a.im * a.im;
const parallel = (a: Complex, b: Complex): Complex => divide(multiply(a, b), add(a, b));

export interface MotorOperatingPoint {
  readonly current: number;
  readonly torque: number;
  readonly inputPower: number;
  readonly statorCopperLoss: number;
  readonly rotorCopperLoss: number;
  readonly powerFactor: number;
  readonly slip: number;
}
/** Independent steady-state T-circuit calculation, for estimates and diagnostics.
 * Equations: Kirtley, MIT 6.685 notes 10, pp.1-5, equivalent circuit/maximum torque:
 * https://ocw.mit.edu/courses/6-685-electric-machines-fall-2013/d834469bd6c3f56c6bec451d76176156_MIT6_685F13_chapter10.pdf
 * This original implementation omits iron, saturation and mechanical losses. */
export function steadyStateMotor(c: MotorCircuit, lineVoltage: number, frequency: number, omega: number): MotorOperatingPoint {
  if (![lineVoltage, frequency, omega].every(Number.isFinite) || lineVoltage < 0 || frequency === 0)
    throw new RangeError('Steady-state AC needs finite values and nonzero frequency.');
  const w = 2 * Math.PI * frequency, slipSpeed = w - c.polePairs * omega, slip = slipSpeed / w;
  const zm = { re: 0, im: w * c.magnetizingInductance };
  const zs = { re: c.statorResistance, im: w * c.statorLeakageInductance };
  const voltage = { re: lineVoltage / Math.sqrt(3), im: 0 };
  const zr = slip === 0 ? null : { re: c.rotorResistance / slip, im: w * c.rotorLeakageInductance };
  const branch = zr === null ? zm : parallel(zm, zr);
  const current = divide(voltage, add(zs, branch));
  const rotor = zr === null ? { re: 0, im: 0 } : divide(multiply(current, branch), zr);
  const currentSquared = magnitudeSquared(current), rotorSquared = magnitudeSquared(rotor);
  const inputPower = 3 * voltage.re * current.re;
  return { current: Math.sqrt(currentSquared), torque: slipSpeed === 0 ? 0 : 3 * c.polePairs * c.rotorResistance * rotorSquared / slipSpeed,
    inputPower, statorCopperLoss: 3 * c.statorResistance * currentSquared,
    rotorCopperLoss: 3 * c.rotorResistance * rotorSquared,
    powerFactor: lineVoltage > 0 && currentSquared > 0 ? inputPower / (Math.sqrt(3) * lineVoltage * Math.sqrt(currentSquared)) : 0, slip };
}
export function breakdownSlip(c: MotorCircuit, frequency: number): number {
  const w = 2 * Math.PI * Math.abs(frequency);
  if (!(w > 0) || !Number.isFinite(w)) throw new RangeError('Breakdown slip needs nonzero finite frequency.');
  const zth = parallel({ re: c.statorResistance, im: w * c.statorLeakageInductance }, { re: 0, im: w * c.magnetizingInductance });
  return c.rotorResistance / Math.hypot(zth.re, zth.im + w * c.rotorLeakageInductance);
}
export interface MotorCircuitFit {
  readonly target: number;
  readonly achieved: number;
  readonly relativeError: number;
}
export interface MotorCircuitEstimate {
  readonly circuit: MotorCircuit;
  readonly parameters: MotorCircuitParameters;
  readonly rated: MotorOperatingPoint;
  readonly fits: {
    readonly ratedTorque: MotorCircuitFit;
    readonly ratedCurrent: MotorCircuitFit;
    readonly powerFactor: MotorCircuitFit;
    readonly noLoadCurrent: MotorCircuitFit;
    readonly lockedCurrent: MotorCircuitFit;
    readonly breakdownSlip: MotorCircuitFit;
  };
  readonly warnings: readonly string[];
}
const bounded = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
/** Deterministic teaching estimate, not parameter identification from measurements.
 * Priorities: rated shaft torque/slip, no-load 0.35 In, breakdown slip 4 sn.
 * Equal leakage inductances and Rs=0.05*(Vphase/In) are explicit assumptions.
 * Six-times locked current, nameplate current and cos(phi) are diagnostics, not
 * independent scales. A passive five-parameter circuit cannot generally fit all.
 */
export function estimateMotorCircuit(motor: Readonly<MotorSpecification>): MotorCircuitEstimate {
  const { voltage, frequency, current, speedRPM, poles, powerKW, cosPhi } = motor;
  if (![voltage, frequency, current, speedRPM, powerKW, cosPhi].every(value => Number.isFinite(value) && value > 0)
    || !Number.isInteger(poles) || poles < 2 || poles > 12 || poles % 2 || speedRPM >= 120 * frequency / poles || cosPhi > 1)
    throw new RangeError('Motor nameplate must have positive values and sub-synchronous rated speed.');
  const polePairs = poles / 2, w = 2 * Math.PI * frequency, omega = speedRPM * Math.PI / 30;
  const nominalSlip = 1 - polePairs * omega / w, targetSlip = 4 * nominalSlip;
  const phaseVoltage = voltage / Math.sqrt(3), targetNoLoad = 0.35 * current;
  const Rs = bounded(0.05 * phaseVoltage / current, ...MOTOR_CIRCUIT_RANGES.Rs);
  const total = Math.sqrt(Math.max((phaseVoltage / targetNoLoad) ** 2 - Rs * Rs, 0)) / w;
  const targetTorque = powerKW * 1000 / omega;
  const candidate = (leakage: number): MotorCircuit => {
    const Lm = bounded(total - leakage, ...MOTOR_CIRCUIT_RANGES.Lm);
    const zth = parallel({ re: Rs, im: w * leakage }, { re: 0, im: w * Lm });
    const Rr = bounded(targetSlip * Math.hypot(zth.re, zth.im + w * leakage), ...MOTOR_CIRCUIT_RANGES.Rr);
    return makeMotorCircuit({ Rs, Rr, Lls: leakage, Llr: leakage, Lm }, polePairs);
  };
  let low: number = MOTOR_CIRCUIT_RANGES.Lls[0];
  let high = bounded(total * 0.95, low, MOTOR_CIRCUIT_RANGES.Lls[1]);
  // Increasing equal leakage lowers rated torque. Endpoint clipping is reported.
  for (let iteration = 0; iteration < 64; iteration++) {
    const middle = (low + high) / 2;
    if (steadyStateMotor(candidate(middle), voltage, frequency, omega).torque > targetTorque) low = middle;
    else high = middle;
  }
  const circuit = candidate((low + high) / 2), rated = steadyStateMotor(circuit, voltage, frequency, omega);
  const fit = (target: number, achieved: number): MotorCircuitFit => ({ target, achieved, relativeError: (achieved - target) / target });
  const fits = {
    ratedTorque: fit(targetTorque, rated.torque), ratedCurrent: fit(current, rated.current),
    powerFactor: fit(cosPhi, rated.powerFactor),
    noLoadCurrent: fit(targetNoLoad, steadyStateMotor(circuit, voltage, frequency, w / polePairs).current),
    lockedCurrent: fit(6 * current, steadyStateMotor(circuit, voltage, frequency, 0).current),
    breakdownSlip: fit(targetSlip, breakdownSlip(circuit, frequency)),
  };
  const warnings: string[] = [];
  if (Math.abs(fits.ratedTorque.relativeError) > 0.02 || Math.abs(fits.noLoadCurrent.relativeError) > 0.02 || Math.abs(fits.breakdownSlip.relativeError) > 0.02)
    warnings.push('The nameplate and assumed torque/current shape exceed the supported passive circuit fit; see achieved values.');
  if (Math.abs(fits.ratedCurrent.relativeError) > 0.1 || Math.abs(fits.powerFactor.relativeError) > 0.1 || Math.abs(fits.lockedCurrent.relativeError) > 0.1)
    warnings.push('Rated current, power factor and six-times locked current are not simultaneously fitted; torque, no-load current and breakdown slip take priority.');
  if (powerKW * 1000 / (1 - nominalSlip) >= Math.sqrt(3) * voltage * current * cosPhi)
    warnings.push('Rated shaft power/slip require more air-gap power than the stated electrical input.');
  return { circuit, parameters: circuitParameters(circuit), rated, fits, warnings };
}
