/** Original bounded PI voltage controllers. Conditional integration follows the
 * anti-windup and reset principles described in imperix TN105:
 * https://imperix.com/doc/implementation/pi-controller
 * Gains/bandwidth below are teaching choices, not Schneider firmware settings.
 * Physical current and torque belong to the motor model and are never clipped.
 */
export const CURRENT_LIMITER_GAINS = Object.freeze({ proportional: 0.15, integral: 120 });
export const DC_CURRENT_BANDWIDTH = 200; // rad/s, for the averaged electrical loop.
const bounded = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
const canIntegrate = (raw: number, change: number, maximum: number): boolean =>
    change > 0 ? raw < maximum : change < 0 && raw > 0;

function validTime(dt: number): void {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Invalid current-controller time step');
}

/** Attenuates a requested AC voltage when balanced-vector RMS exceeds CLI.
 * Normalized error makes the same gains usable across the supported CLI range.
 * Intended for the 100 us electrical step; stored integral survives limit changes.
 */
export class CurrentLimiter {
    private integral = 1;
    private voltageFactor = 1;
    get factor(): number { return this.voltageFactor; }

    reset(): void {
        this.integral = 1;
        this.voltageFactor = 1;
    }

    step(dt: number, measuredRms: number, limit: number): number {
        validTime(dt);
        if (!Number.isFinite(measuredRms) || measuredRms < 0 || !Number.isFinite(limit) || limit < 0)
            throw new RangeError('Invalid AC current feedback or limit');
        if (limit === 0) {
            this.integral = this.voltageFactor = 0;
            return 0;
        }
        const error = (limit - measuredRms) / limit;
        const proportional = CURRENT_LIMITER_GAINS.proportional * error;
        const raw = this.integral + proportional;
        const change = CURRENT_LIMITER_GAINS.integral * error * dt;
        if (canIntegrate(raw, change, 1))
            this.integral = bounded(this.integral + change, 0, 1);
        this.voltageFactor = bounded(this.integral + proportional, 0, 1);
        return this.voltageFactor;
    }
}

export interface DCInjectionInput {
    /** Signed source-conductor current in A, positive into the chosen source. */
    measuredCurrent: number;
    targetCurrent: number;
    statorResistance: number;
    /** Number of connected return conductors, one or two. */
    returns: number;
    /** Source-to-parallel-return transient inductance in H. */
    loopInductance: number;
    /** Available source-to-return inverter voltage, V. */
    maxVoltage: number;
}

/** Regulates SdC with a source conductor and one or two equal return paths.
 * Rs*(1+1/N)*SdC is the DC steady-state winding drop. The PI corrects physical
 * transients/induced voltage. Kp=L*w and Ki=R*w cancel the surrogate RL pole;
 * the bandwidth is reduced for a coarse caller step to retain sampling margin.
 */
export class DCInjectionController {
    private integral = 0;
    private outputVoltage = 0;
    get voltage(): number { return this.outputVoltage; }

    reset(): void {
        this.integral = 0;
        this.outputVoltage = 0;
    }

    step(dt: number, input: Readonly<DCInjectionInput>): number {
        validTime(dt);
        const { measuredCurrent, targetCurrent, statorResistance, returns, loopInductance, maxVoltage } = input;
        if (![measuredCurrent, targetCurrent, statorResistance, loopInductance, maxVoltage].every(Number.isFinite) ||
            targetCurrent < 0 || statorResistance <= 0 || loopInductance <= 0 || maxVoltage < 0 ||
            (returns !== 1 && returns !== 2))
            throw new RangeError('Invalid DC injection feedback or circuit');
        if (targetCurrent === 0 || maxVoltage === 0) {
            this.reset();
            return 0;
        }
        const resistance = statorResistance * (1 + 1 / returns);
        const feedforward = resistance * targetCurrent;
        const bandwidth = dt > 0 ? Math.min(DC_CURRENT_BANDWIDTH, 0.25 / dt) : DC_CURRENT_BANDWIDTH;
        const error = targetCurrent - measuredCurrent;
        const proportional = loopInductance * bandwidth * error;
        // Integral bounds cover correction in either direction. Conditional
        // integration blocks further windup at the actual voltage limits.
        this.integral = bounded(this.integral, -maxVoltage, maxVoltage);
        const raw = feedforward + proportional + this.integral;
        const change = resistance * bandwidth * error * dt;
        if (canIntegrate(raw, change, maxVoltage))
            this.integral = bounded(this.integral + change, -maxVoltage, maxVoltage);
        this.outputVoltage = bounded(feedforward + proportional + this.integral, 0, maxVoltage);
        return this.outputVoltage;
    }
}
