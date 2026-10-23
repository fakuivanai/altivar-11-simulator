/** Original finite Coulomb brake model: J*d(omega)/dt = applied + reaction.
 * Physical provenance: Oriental Motor's AC brake characteristics relate braking
 * time/overrun to load inertia, rather than an instantaneous speed constraint:
 * https://www.orientalmotor.co.jp/ja/products/ac-motors/electromagnetic-brake?tabNum=tab-4
 * The 3x rated-torque capacity below is a teaching assumption for the external
 * shaft restraint, not a fitted motor brake or an ATV11 function.
 */
export const SHAFT_BRAKE_TORQUE_MULTIPLE = 3;
export interface ShaftBrakeInput {
    /** Angular velocity in rad/s. */
    omega: number;
    /** Net motor/load torque before the shaft brake, N m. */
    appliedTorque: number;
    /** Total mechanical inertia, kg m^2. */
    inertia: number;
    ratedTorque: number;
    engaged: boolean;
}
export interface ShaftBrakeStep {
    omega: number;
    /** Signed step-average reaction, N m, including any static hold interval. */
    reactionTorque: number;
    /** Angular displacement over the step, rad. */
    angleDelta: number;
    dissipatedEnergy: number;
    locked: boolean;
}

export function stepShaftBrake(input: Readonly<ShaftBrakeInput>, dt: number): ShaftBrakeStep {
    const { omega, appliedTorque, inertia, ratedTorque, engaged } = input;
    if (![omega, appliedTorque, inertia, ratedTorque, dt].every(Number.isFinite) ||
        inertia <= 0 || ratedTorque < 0 || dt < 0 || dt > 600)
        throw new RangeError('Invalid shaft-brake step');
    const capacity = engaged ? SHAFT_BRAKE_TORQUE_MULTIPLE * ratedTorque : 0;
    const canHold = engaged && Math.abs(appliedTorque) <= capacity;
    if (dt === 0) return {
        omega, reactionTorque: omega === 0 && canHold ? -appliedTorque : -Math.sign(omega || appliedTorque) * capacity,
        angleDelta: 0, dissipatedEnergy: 0, locked: omega === 0 && canHold,
    };
    if (!engaged) {
        const next = omega + appliedTorque * dt / inertia;
        return { omega: next, reactionTorque: 0, angleDelta: (omega + next) * dt / 2,
            dissipatedEnergy: 0, locked: false };
    }
    if (omega === 0 && canHold)
        return { omega: 0, reactionTorque: -appliedTorque, angleDelta: 0, dissipatedEnergy: 0, locked: true };

    const direction = Math.sign(omega || appliedTorque);
    const reaction = -direction * capacity;
    const acceleration = (appliedTorque + reaction) / inertia;
    const stopTime = omega * acceleration < 0 ? -omega / acceleration : Infinity;
    if (stopTime <= dt) {
        const beforeStop = omega * stopTime / 2;
        const remaining = dt - stopTime;
        // Once at zero, finite static friction either balances the applied
        // torque or yields and permits motion in the applied-torque direction.
        const afterReaction = canHold ? -appliedTorque : -Math.sign(appliedTorque) * capacity;
        const afterAcceleration = (appliedTorque + afterReaction) / inertia;
        const next = afterAcceleration * remaining;
        const afterStop = afterAcceleration * remaining * remaining / 2;
        return {
            omega: next,
            reactionTorque: (reaction * stopTime + afterReaction * remaining) / dt,
            angleDelta: beforeStop + afterStop,
            dissipatedEnergy: capacity * (Math.abs(beforeStop) + Math.abs(afterStop)),
            locked: canHold,
        };
    }
    const next = omega + acceleration * dt;
    const angleDelta = (omega + next) * dt / 2;
    return { omega: next, reactionTorque: reaction, angleDelta,
        dissipatedEnergy: capacity * Math.abs(angleDelta), locked: false };
}
