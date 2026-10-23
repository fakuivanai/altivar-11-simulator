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
  readonly noLoad: MotorOperatingPoint;
  readonly locked: MotorOperatingPoint;
  readonly breakdown: MotorOperatingPoint;
  readonly lossBalance: {
    readonly inputPower: number;
    readonly shaftPower: number;
    readonly airGapPower: number;
    readonly statorCopperLoss: number;
    readonly rotorCopperLoss: number;
    readonly efficiency: number;
    readonly residual: number;
  };
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
/** Nameplate fit of a passive five-parameter T circuit, not identification.
 * Pin=sqrt(3)*V*In*cos(phi), Pgap=Pshaft/(1-sn), Rs=(Pin-Pgap)/(3*In^2).
 * Thus every unspecified loss is represented as effective stator copper loss;
 * iron, friction and windage are not separately identified by this model.
 *
 * Equal leakage is the conventional unknown-design split described by IITG:
 * https://www.iitg.ac.in/cseweb/vlab/virtual-electrical-machine/Theory_blockr.html
 * Each leakage reactance starts at 0.1 pu on Vphase/In, a generic prior near
 * EPRI OpenDSS's 0.106/0.12 pu defaults, not data from the simulated motor:
 * https://opendss.epri.com/Properties8.html
 * It is reduced when necessary to leave a positive magnetizing susceptance.
 * No-load, locked current and breakdown-slip references are diagnostics only.
 */
export function estimateMotorCircuit(motor: Readonly<MotorSpecification>): MotorCircuitEstimate {
  const { voltage, frequency, current, speedRPM, poles, powerKW, cosPhi } = motor;
  if (![voltage, frequency, current, speedRPM, powerKW, cosPhi].every(value => Number.isFinite(value) && value > 0)
    || !Number.isInteger(poles) || poles < 2 || poles > 12 || poles % 2 || speedRPM >= 120 * frequency / poles || cosPhi > 1)
    throw new RangeError('Motor nameplate must have positive values and sub-synchronous rated speed.');
  const polePairs = poles / 2, w = 2 * Math.PI * frequency, omega = speedRPM * Math.PI / 30;
  const nominalSlip = 1 - polePairs * omega / w, phaseVoltage = voltage / Math.sqrt(3);
  const impedance = phaseVoltage / current;
  const inputPower = Math.sqrt(3) * voltage * current * cosPhi;
  const shaftPower = powerKW * 1000, airGapPower = shaftPower / (1 - nominalSlip);
  const Rs = bounded((inputPower - airGapPower) / (3 * current * current), ...MOTOR_CIRCUIT_RANGES.Rs);
  // The rated current phasor fixes the input impedance. After Rs and Xls,
  // invert its parallel branch to recover positive Rr/sn and Xm analytically.
  // Range-limited/inconsistent plates retain a passive circuit and report residuals.
  const branchResistance = Math.max(impedance * cosPhi - Rs, Number.EPSILON * impedance);
  const ratedReactance = Math.max(impedance * Math.sqrt(1 - cosPhi * cosPhi),
    4 * w * MOTOR_CIRCUIT_RANGES.Lls[0]);
  const leakage = bounded(Math.min(.1 * impedance, ratedReactance / 4) / w, ...MOTOR_CIRCUIT_RANGES.Lls);
  const leakageReactance = w * leakage, branchReactance = ratedReactance - leakageReactance;
  const square = branchResistance * branchResistance + branchReactance * branchReactance;
  const conductance = branchResistance / square;
  const discriminant = Math.max(0, 1 - 4 * conductance * conductance * leakageReactance * leakageReactance);
  const rotorRatedResistance = (1 + Math.sqrt(discriminant)) / (2 * conductance);
  const magnetizingSusceptance = branchReactance / square
    - leakageReactance / (rotorRatedResistance * rotorRatedResistance + leakageReactance * leakageReactance);
  const circuit = makeMotorCircuit({ Rs,
    Rr: bounded(nominalSlip * rotorRatedResistance, ...MOTOR_CIRCUIT_RANGES.Rr),
    Lls: leakage, Llr: leakage,
    Lm: bounded(1 / (w * magnetizingSusceptance), ...MOTOR_CIRCUIT_RANGES.Lm),
  }, polePairs);
  const rated = steadyStateMotor(circuit, voltage, frequency, omega);
  const noLoad = steadyStateMotor(circuit, voltage, frequency, w / polePairs);
  const locked = steadyStateMotor(circuit, voltage, frequency, 0);
  const peakSlip = breakdownSlip(circuit, frequency);
  const breakdown = steadyStateMotor(circuit, voltage, frequency, w / polePairs * (1 - peakSlip));
  const fit = (target: number, achieved: number): MotorCircuitFit => ({ target, achieved, relativeError: (achieved - target) / target });
  const fits = {
    ratedTorque: fit(shaftPower / omega, rated.torque), ratedCurrent: fit(current, rated.current),
    powerFactor: fit(cosPhi, rated.powerFactor),
    noLoadCurrent: fit(.35 * current, noLoad.current),
    lockedCurrent: fit(6 * current, locked.current),
    breakdownSlip: fit(4 * nominalSlip, peakSlip),
  };
  const lossBalance = {
    inputPower: rated.inputPower, shaftPower: rated.torque * omega,
    airGapPower: rated.torque * omega + rated.rotorCopperLoss,
    statorCopperLoss: rated.statorCopperLoss, rotorCopperLoss: rated.rotorCopperLoss,
    efficiency: rated.inputPower > 0 ? rated.torque * omega / rated.inputPower : 0,
    residual: rated.inputPower - rated.torque * omega - rated.statorCopperLoss - rated.rotorCopperLoss,
  };
  const warnings: string[] = [
    'The rated fit assigns all loss not fixed by slip to effective stator copper loss; iron and mechanical losses were not measured.',
    'No-load 0.35 In, locked current 6 In and breakdown slip 4 sn are unfitted diagnostic references, not measured ratings.',
  ];
  if (Math.abs(fits.ratedTorque.relativeError) > .02 || Math.abs(fits.ratedCurrent.relativeError) > .02 || Math.abs(fits.powerFactor.relativeError) > .02)
    warnings.push('The stated ratings exceed the positive circuit parameter ranges or passive loss balance; see achieved rated values.');
  if (airGapPower >= inputPower)
    warnings.push('Rated shaft power/slip require at least the stated electrical input before stator copper loss.');
  if (breakdown.torque < 2 * rated.torque || Math.abs(fits.lockedCurrent.relativeError) > .1)
    warnings.push('This all-copper-loss fit does not reproduce both a two-times breakdown torque and six-times locked current; loss and locked-rotor tests are needed to identify that shape.');
  return { circuit, parameters: circuitParameters(circuit), rated, noLoad, locked, breakdown, lossBalance, fits, warnings };
}
