import type { OutputConnections, Phase } from './engine-types';
import type { MotorCircuit } from './motor-circuit';

export interface AlphaBeta { alpha: number; beta: number }
export type PhaseValues = Record<Phase, number>;
interface ConnectionInput { readonly connected?: Readonly<OutputConnections> }
export type MotorExcitation =
  | (ConnectionInput & { readonly mode: 'ac'; readonly frequency: number; readonly voltage: number })
  | (ConnectionInput & { readonly mode: 'dc'; readonly voltages: Readonly<PhaseValues> })
  | { readonly mode: 'off' };
export interface MotorAdvanceInput { readonly omega: number; readonly excitation: MotorExcitation }
export interface MotorReadings {
  readonly time: number;
  readonly electricalAngle: number;
  /** Time-mean electromagnetic torque over advance(), for mechanical integration. */
  readonly torque: number;
  readonly instantaneousTorque: number;
  readonly phaseCurrent: Readonly<PhaseValues>;
  /** Winding-to-floating-star voltages, including induced voltage in open coils. */
  readonly phaseVoltage: Readonly<PhaseValues>;
  readonly statorFlux: Readonly<AlphaBeta>;
  readonly rotorFlux: Readonly<AlphaBeta>;
  readonly currentMagnitude: number;
  /** |i_alpha,beta|/sqrt(2): balanced-AC RMS; instantaneous three-conductor
   * aggregate under unbalance/DC. Temporal phase RMS needs a measurement window. */
  readonly currentRms: number;
  readonly inputPower: number;
  /** Signed interval-mean instantaneous alpha/beta reactive power. */
  readonly reactivePower: number;
  readonly statorCopperLoss: number;
  readonly rotorCopperLoss: number;
  readonly magneticEnergy: number;
  /** Joules removed on ideal conductor opening during this advance(). */
  readonly switchingLoss: number;
  /** Joules dissipated by the L-stable fallback, zero for implicit midpoint. */
  readonly numericalLoss: number;
}
/** Reusable exact transaction record. Its numeric storage is owned by the
 * caller; use it with the circuit that created it, and do not edit its values. */
export interface MotorCheckpoint {
  readonly circuit: MotorCircuit;
  readonly values: Float64Array;
}
export const MAX_ELECTRICAL_STEP = 0.0001;
const SQRT3 = Math.sqrt(3), TAU = 2 * Math.PI;
const ALL_CONNECTED = { U: true, V: true, W: true } as const;

/** Original stationary-frame, amplitude-invariant Clarke implementation of the
 * flux equations in Kirtley, MIT 6.685 notes 10 pp.6-8 (reference speed zero):
 * https://ocw.mit.edu/courses/6-685-electric-machines-fall-2013/d834469bd6c3f56c6bec451d76176156_MIT6_685F13_chapter10.pdf
 * psi_s'=v_s-Rs*i_s; psi_r'=-Rr*i_r+polePairs*omega*J*psi_r.
 * psi_s=Ls*i_s+Lm*i_r; psi_r=Lm*i_s+Lr*i_r.
 * T=3/2*polePairs*cross(psi_s,i_s), W=3/4*(psi_s.i_s+psi_r.i_r).
 *
 * The linear electrical step is solved implicitly at midpoint. At very short
 * resistive time constants, backward Euler avoids unresolved stiff ringing.
 * Its energy defect is reported, rather than counted as mechanical work.
 *
 * Open conductors constrain stator current, not merely the displayed current.
 * A topology change retains rotor flux and projects forbidden leakage current
 * away; lost leakage energy is reported as ideal contact/transient dissipation.
 * Off means ideal open stator, without an inverter diode/arc model. Rotor flux
 * continues to rotate and decay. Core losses and saturation are not included.
 */
export class InductionMotorDynamics {
  private sa = 0;
  private sb = 0;
  private ra = 0;
  private rb = 0;
  private angle = 0;
  private connection = -1;
  private readonly sample = {
    time: 0, electricalAngle: 0, torque: 0, instantaneousTorque: 0,
    phaseCurrent: { U: 0, V: 0, W: 0 }, phaseVoltage: { U: 0, V: 0, W: 0 },
    statorFlux: { alpha: 0, beta: 0 }, rotorFlux: { alpha: 0, beta: 0 },
    currentMagnitude: 0, currentRms: 0, inputPower: 0, reactivePower: 0, statorCopperLoss: 0,
    rotorCopperLoss: 0, magneticEnergy: 0, switchingLoss: 0, numericalLoss: 0,
  };
  constructor(readonly circuit: MotorCircuit) {}
  /** Borrowed view, overwritten on the next advance. Its objects are not flux
   * state owners. Capture scalars or use snapshot() when retaining history. */
  get readings(): MotorReadings { return this.sample; }
  snapshot(): MotorReadings {
    return { ...this.sample, phaseCurrent: { ...this.sample.phaseCurrent }, phaseVoltage: { ...this.sample.phaseVoltage },
      statorFlux: { ...this.sample.statorFlux }, rotorFlux: { ...this.sample.rotorFlux } };
  }
  /** Pass a previous checkpoint to avoid allocating in the coupled fast loop. */
  checkpoint(target?: MotorCheckpoint): MotorCheckpoint {
    const saved = target ?? { circuit: this.circuit, values: new Float64Array(29) };
    if (saved.circuit !== this.circuit || saved.values.length !== 29) throw new RangeError('Motor checkpoint belongs to another circuit.');
    const v = saved.values, r = this.sample;
    v[0] = this.sa; v[1] = this.sb; v[2] = this.ra; v[3] = this.rb;
    v[4] = this.angle; v[5] = this.connection;
    v[6] = r.time; v[7] = r.electricalAngle; v[8] = r.torque; v[9] = r.instantaneousTorque;
    v[10] = r.phaseCurrent.U; v[11] = r.phaseCurrent.V; v[12] = r.phaseCurrent.W;
    v[13] = r.phaseVoltage.U; v[14] = r.phaseVoltage.V; v[15] = r.phaseVoltage.W;
    v[16] = r.statorFlux.alpha; v[17] = r.statorFlux.beta; v[18] = r.rotorFlux.alpha; v[19] = r.rotorFlux.beta;
    v[20] = r.currentMagnitude; v[21] = r.currentRms; v[22] = r.inputPower;
    v[23] = r.statorCopperLoss; v[24] = r.rotorCopperLoss; v[25] = r.magneticEnergy;
    v[26] = r.switchingLoss; v[27] = r.numericalLoss; v[28] = r.reactivePower;
    return saved;
  }
  /** Restore physical state and the existing borrowed output objects exactly. */
  restore(saved: MotorCheckpoint): MotorReadings {
    const v = saved.values;
    if (saved.circuit !== this.circuit || v.length !== 29 || !v.every(Number.isFinite))
      throw new RangeError('Invalid motor checkpoint.');
    this.sa = v[0]!; this.sb = v[1]!; this.ra = v[2]!; this.rb = v[3]!;
    this.angle = v[4]!; this.connection = v[5]!;
    const r = this.sample;
    r.time = v[6]!; r.electricalAngle = v[7]!; r.torque = v[8]!; r.instantaneousTorque = v[9]!;
    r.phaseCurrent.U = v[10]!; r.phaseCurrent.V = v[11]!; r.phaseCurrent.W = v[12]!;
    r.phaseVoltage.U = v[13]!; r.phaseVoltage.V = v[14]!; r.phaseVoltage.W = v[15]!;
    r.statorFlux.alpha = v[16]!; r.statorFlux.beta = v[17]!; r.rotorFlux.alpha = v[18]!; r.rotorFlux.beta = v[19]!;
    r.currentMagnitude = v[20]!; r.currentRms = v[21]!; r.inputPower = v[22]!;
    r.statorCopperLoss = v[23]!; r.rotorCopperLoss = v[24]!; r.magneticEnergy = v[25]!;
    r.switchingLoss = v[26]!; r.numericalLoss = v[27]!; r.reactivePower = v[28]!;
    return r;
  }
  reset(): void {
    this.sa = this.sb = this.ra = this.rb = this.angle = 0;
    this.connection = -1;
    this.sample.time = 0;
    this.advance(0, { omega: 0, excitation: { mode: 'off' } });
  }
  advance(seconds: number, input: MotorAdvanceInput): MotorReadings {
    const { omega, excitation } = input;
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 60 || !Number.isFinite(omega))
      throw new RangeError('Motor advance needs finite speed and 0..60 seconds.');
    if (excitation.mode === 'ac' && (!Number.isFinite(excitation.frequency) || !Number.isFinite(excitation.voltage) || excitation.voltage < 0))
      throw new RangeError('Invalid AC motor excitation.');
    if (excitation.mode === 'dc' && ![excitation.voltages.U, excitation.voltages.V, excitation.voltages.W].every(Number.isFinite))
      throw new RangeError('Invalid DC motor excitation.');
    // An exactly unenergized stopped motor has no electrical evolution. Keep
    // its clock/borrowed readings current without solving an all-zero system.
    if (excitation.mode === 'off' && omega === 0 && this.sa === 0 && this.sb === 0 && this.ra === 0 && this.rb === 0) {
      const out = this.sample;
      out.time += seconds; out.electricalAngle = this.angle; this.connection = 0;
      out.torque = out.instantaneousTorque = out.currentMagnitude = out.currentRms = out.inputPower = out.reactivePower = 0;
      out.statorCopperLoss = out.rotorCopperLoss = out.magneticEnergy = out.switchingLoss = out.numericalLoss = 0;
      out.phaseCurrent.U = out.phaseCurrent.V = out.phaseCurrent.W = out.phaseVoltage.U = out.phaseVoltage.V = out.phaseVoltage.W = 0;
      out.statorFlux.alpha = out.statorFlux.beta = out.rotorFlux.alpha = out.rotorFlux.beta = 0;
      return out;
    }
    const c = this.circuit, k = c.magnetizingInductance / c.rotorInductance, sigma = c.leakageInductance;
    const connected = excitation.mode === 'off' ? null : excitation.connected ?? ALL_CONNECTED;
    const mask = connected ? (connected.U ? 1 : 0) + (connected.V ? 2 : 0) + (connected.W ? 4 : 0) : 0;
    const count = (mask & 1 ? 1 : 0) + (mask & 2 ? 1 : 0) + (mask & 4 ? 1 : 0);
    // Unit permitted current direction when exactly two line conductors remain.
    // U open: beta. V/W open: perpendicular to that winding's Clarke axis.
    const da = mask === 6 ? 0 : SQRT3 / 2;
    const db = mask === 3 ? -0.5 : mask === 5 ? 0.5 : 1;
    let switchingLoss = 0;
    if (mask !== this.connection) {
      const ia = (this.sa - k * this.ra) / sigma, ib = (this.sb - k * this.rb) / sigma;
      const along = count === 2 ? da * ia + db * ib : 0;
      const pa = count === 3 ? ia : count === 2 ? da * along : 0;
      const pb = count === 3 ? ib : count === 2 ? db * along : 0;
      switchingLoss = Math.max(0, 0.75 * sigma * (ia * ia + ib * ib - pa * pa - pb * pb));
      this.sa = k * this.ra + sigma * pa;
      this.sb = k * this.rb + sigma * pb;
      this.connection = mask;
    }
    let dcA = 0, dcB = 0;
    if (excitation.mode === 'dc') {
      dcA = (2 * excitation.voltages.U - excitation.voltages.V - excitation.voltages.W) / 3;
      dcB = (excitation.voltages.V - excitation.voltages.W) / SQRT3;
    }
    const sourceFrequency = excitation.mode === 'ac' ? TAU * excitation.frequency : 0;
    const peakVoltage = excitation.mode === 'ac' ? Math.sqrt(2 / 3) * excitation.voltage : 0;
    const wr = c.polePairs * omega, gamma = c.rotorResistance / c.rotorInductance;
    const steps = Math.max(1, Math.ceil(seconds / MAX_ELECTRICAL_STEP - 1e-10));
    const h = seconds / steps;
    // Midpoint is A-stable but not L-stable. Resolve ordinary time constants;
    // dissipate unresolved fast modes with backward Euler instead of ringing.
    const theta = h > c.transientTimeConstant || h > c.rotorTimeConstant ? 1 : 0.5;
    const q = theta * h, Rs = c.statorResistance, Rr = c.rotorResistance;
    const sdiag = 1 + q * Rs / sigma, b = q * Rs * k / sigma, d = q * Rr * k / sigma;
    const rbase = 1 + q * gamma, rotation = q * wr;
    const rdiag = rbase + q * Rr * k * k / sigma - d * b / sdiag;
    let torqueIntegral = 0, inputIntegral = 0, reactiveIntegral = 0, statorLossIntegral = 0, rotorLossIntegral = 0, numericalLoss = 0;
    for (let n = 0; n < steps && h > 0; n++) {
      const sourceAngle = this.angle + theta * sourceFrequency * h;
      const va = excitation.mode === 'ac' ? peakVoltage * Math.sin(sourceAngle) : dcA;
      const vb = excitation.mode === 'ac' ? -peakVoltage * Math.cos(sourceAngle) : dcB;
      const oldSa = this.sa, oldSb = this.sb, oldRa = this.ra, oldRb = this.rb;
      let ma: number, mb: number, mra: number, mrb: number;
      if (count === 3) {
        const a = oldSa + q * va, z = oldSb + q * vb;
        const rha = oldRa + d * a / sdiag, rhb = oldRb + d * z / sdiag;
        const denominator = rdiag * rdiag + rotation * rotation;
        mra = (rdiag * rha - rotation * rhb) / denominator;
        mrb = (rotation * rha + rdiag * rhb) / denominator;
        ma = (a + b * mra) / sdiag;
        mb = (z + b * mrb) / sdiag;
      } else if (count === 2) {
        const oldQ = da * oldSa + db * oldSb, oldD = da * oldRa + db * oldRb, oldE = -db * oldRa + da * oldRb;
        const a = oldQ + q * (da * va + db * vb), rhs = oldD + d * a / sdiag;
        const denominator = rdiag * rbase + rotation * rotation;
        const md = (rbase * rhs - rotation * oldE) / denominator;
        const me = (rotation * rhs + rdiag * oldE) / denominator;
        const ms = (a + b * md) / sdiag;
        mra = da * md - db * me; mrb = db * md + da * me;
        ma = da * ms - db * k * me; mb = db * ms + da * k * me;
      } else {
        const denominator = rbase * rbase + rotation * rotation;
        mra = (rbase * oldRa - rotation * oldRb) / denominator;
        mrb = (rotation * oldRa + rbase * oldRb) / denominator;
        ma = k * mra; mb = k * mrb;
      }
      const ia = (ma - k * mra) / sigma, ib = (mb - k * mrb) / sigma;
      const ira = (mra - c.magnetizingInductance * ia) / c.rotorInductance;
      const irb = (mrb - c.magnetizingInductance * ib) / c.rotorInductance;
      const torque = 1.5 * c.polePairs * (ma * ib - mb * ia);
      torqueIntegral += torque * h;
      inputIntegral += 1.5 * (va * ia + vb * ib) * h;
      reactiveIntegral += 1.5 * (vb * ia - va * ib) * h;
      statorLossIntegral += 1.5 * Rs * (ia * ia + ib * ib) * h;
      rotorLossIntegral += 1.5 * Rr * (ira * ira + irb * irb) * h;
      this.sa = oldSa + (ma - oldSa) / theta; this.sb = oldSb + (mb - oldSb) / theta;
      this.ra = oldRa + (mra - oldRa) / theta; this.rb = oldRb + (mrb - oldRb) / theta;
      if (theta > 0.5) {
        const dra = this.ra - oldRa, drb = this.rb - oldRb;
        const dia = (this.sa - oldSa - k * dra) / sigma, dib = (this.sb - oldSb - k * drb) / sigma;
        numericalLoss += 0.75 * (sigma * (dia * dia + dib * dib) + (dra * dra + drb * drb) / c.rotorInductance);
      }
      this.angle = (this.angle + sourceFrequency * h) % TAU;
    }
    const ia = (this.sa - k * this.ra) / sigma, ib = (this.sb - k * this.rb) / sigma;
    const ira = (this.ra - c.magnetizingInductance * ia) / c.rotorInductance;
    const irb = (this.rb - c.magnetizingInductance * ib) / c.rotorInductance;
    const torque = 1.5 * c.polePairs * (this.sa * ib - this.sb * ia);
    const va = excitation.mode === 'ac' ? peakVoltage * Math.sin(this.angle) : dcA;
    const vb = excitation.mode === 'ac' ? -peakVoltage * Math.cos(this.angle) : dcB;
    // Voltage across an open coil is induced by the surviving rotor flux.
    const dra = -Rr * ira - wr * this.rb, drb = -Rr * irb + wr * this.ra;
    const pv = count === 2 ? da * va + db * vb : 0;
    const dr = count === 2 ? da * dra + db * drb : 0;
    const effectiveA = count === 3 ? va : count === 2 ? da * pv + k * (dra - da * dr) : k * dra;
    const effectiveB = count === 3 ? vb : count === 2 ? db * pv + k * (drb - db * dr) : k * drb;
    const out = this.sample;
    out.time += seconds; out.electricalAngle = this.angle;
    out.torque = seconds > 0 ? torqueIntegral / seconds : torque; out.instantaneousTorque = torque;
    out.phaseCurrent.U = ia; out.phaseCurrent.V = -ia / 2 + SQRT3 * ib / 2; out.phaseCurrent.W = -ia / 2 - SQRT3 * ib / 2;
    out.phaseVoltage.U = effectiveA; out.phaseVoltage.V = -effectiveA / 2 + SQRT3 * effectiveB / 2; out.phaseVoltage.W = -effectiveA / 2 - SQRT3 * effectiveB / 2;
    out.statorFlux.alpha = this.sa; out.statorFlux.beta = this.sb; out.rotorFlux.alpha = this.ra; out.rotorFlux.beta = this.rb;
    out.currentMagnitude = Math.hypot(ia, ib); out.currentRms = out.currentMagnitude / Math.SQRT2;
    out.inputPower = seconds > 0 ? inputIntegral / seconds : 1.5 * (effectiveA * ia + effectiveB * ib);
    out.reactivePower = seconds > 0 ? reactiveIntegral / seconds : 1.5 * (effectiveB * ia - effectiveA * ib);
    out.statorCopperLoss = seconds > 0 ? statorLossIntegral / seconds : 1.5 * Rs * (ia * ia + ib * ib);
    out.rotorCopperLoss = seconds > 0 ? rotorLossIntegral / seconds : 1.5 * Rr * (ira * ira + irb * irb);
    // Decomposed form avoids cancellation when Lm is much larger than leakage.
    out.magneticEnergy = 0.75 * (sigma * (ia * ia + ib * ib) + (this.ra * this.ra + this.rb * this.rb) / c.rotorInductance);
    out.switchingLoss = switchingLoss; out.numericalLoss = numericalLoss;
    return out;
  }
}
