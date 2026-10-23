import type { FaultCode, ReadonlyEngineConfiguration } from './engine-types';
import { injectionTopology } from './electrical';
import { estimateMotorCircuit, makeMotorCircuit } from './motor-circuit';
import type { MotorCircuit } from './motor-circuit';
import { InductionMotorDynamics, MAX_ELECTRICAL_STEP } from './motor-dynamics';
import type { MotorExcitation } from './motor-dynamics';
import { DCLink } from './dc-link';
import { CurrentLimiter, DCInjectionController } from './drive-control';
import { stepShaftBrake, SHAFT_BRAKE_TORQUE_MULTIPLE } from './shaft-brake';
import type { ShaftBrakeStep } from './shaft-brake';
import type { ScopeSample } from './scope-history';

export interface PlantCommand {
    mode: 'off' | 'ac' | 'dc';
    frequency: number;
    /** Requested line-to-line rms AC voltage, before bus/current constraints. */
    voltage: number;
    currentLimit: number;
    injectionCurrent: number;
    running: boolean;
    fault: FaultCode | null;
}
// Original integration/control assumptions. Only the 5 W control-board demand
// is added to the physical motor losses; no semiconductor loss fit is claimed.
export const PLANT_ASSUMPTIONS = Object.freeze({
    boardPower: 5, boardStartVoltage: 30,
    currentMeasurementSeconds: .01, sampleInterval: .0005,
    energyReserveFraction: .05,
});

/** Couples electrical work, capacitor energy and finite mechanical motion.
 * Every internal step has fixed duration. Rendering never selects that step.
 * Circuit parameters are changed only through configureMotor at a stopped motor.
 */
export class PhysicalPlant {
    readonly dcLink = new DCLink();
    private motor: InductionMotorDynamics;
    private motorKey: string;
    private saved: ReturnType<InductionMotorDynamics['checkpoint']>;
    private readonly currentLimiter = new CurrentLimiter();
    private readonly injectionController = new DCInjectionController();
    private meanCurrentSquared = 0;
    private sampleCount = 0;
    private previousMode: PlantCommand['mode'] = 'off';
    private listener: ((sample: ScopeSample) => void) | undefined;
    omega = 0;
    angle = 0;
    torque = 0;
    current = 0;
    voltage = 0;
    currentLag = Math.PI / 2;
    currentLimited = false;
    shaftReactionTorque = 0;
    regenerativePower = 0;
    inputPower = 0;
    windingLoss = 0;
    brakeHeat = 0;
    numericalLoss = 0;
    switchingLoss = 0;
    get circuit(): MotorCircuit { return this.motor.circuit; }
    get instantaneous() { return this.motor.readings; }
    constructor(config: ReadonlyEngineConfiguration) {
        this.motorKey = this.key(config);
        this.motor = new InductionMotorDynamics(this.resolve(config));
        this.saved = this.motor.checkpoint();
    }
    private key(config: ReadonlyEngineConfiguration): string {
        const m = config.motor;
        return JSON.stringify([m.powerKW, m.voltage, m.frequency, m.current, m.speedRPM,
            m.poles, m.cosPhi, config.motorElectrical ?? { mode: 'estimated' }]);
    }
    private resolve(config: ReadonlyEngineConfiguration): MotorCircuit {
        return config.motorElectrical?.mode === 'manual'
            ? makeMotorCircuit(config.motorElectrical.parameters, config.motor.poles / 2)
            : estimateMotorCircuit(config.motor).circuit;
    }
    configureMotor(config: ReadonlyEngineConfiguration, reset = false): void {
        const key = this.key(config);
        if (key === this.motorKey) return;
        if (!reset && (Math.abs(this.omega) > .05 || this.previousMode !== 'off'))
            throw new RangeError('El circuito del motor sólo puede cambiar con el eje detenido y la salida desactivada.');
        const motor = new InductionMotorDynamics(this.resolve(config));
        this.motor = motor;
        this.motorKey = key;
        this.saved = motor.checkpoint();
        this.meanCurrentSquared = this.current = 0;
        this.currentLimiter.reset();
        this.injectionController.reset();
    }
    setSampleListener(listener: ((sample: ScopeSample) => void) | undefined): void { this.listener = listener; }
    reset(): void {
        this.motor.reset(); this.dcLink.reset();
        this.currentLimiter.reset(); this.injectionController.reset();
        this.meanCurrentSquared = this.sampleCount = 0;
        this.previousMode = 'off';
        this.omega = this.angle = this.torque = this.current = this.voltage = 0;
        this.shaftReactionTorque = this.regenerativePower = this.inputPower = this.windingLoss = 0;
        this.brakeHeat = this.numericalLoss = this.switchingLoss = 0;
        this.currentLag = Math.PI / 2; this.currentLimited = false;
    }
    advance(dt: number, command: Readonly<PlantCommand>, config: ReadonlyEngineConfiguration, startTime: number): void {
        const { inputs: i, motor: m, mechanical: load } = config;
        const circuit = this.circuit, topology = injectionTopology(i.outputConnections);
        const connected = Object.values(i.outputConnections).filter(Boolean).length;
        const inertia = m.inertia + load.inertia;
        const ratedTorque = m.powerKW * 1000 / (m.speedRPM * Math.PI / 30);
        const steps = Math.round(dt / MAX_ELECTRICAL_STEP), h = dt / steps;
        if (steps < 1 || Math.abs(h - MAX_ELECTRICAL_STEP) > 1e-10) throw new RangeError('Plant requires fixed 100 us steps.');
        if (command.mode !== this.previousMode) {
            this.currentLimiter.reset(); this.injectionController.reset();
            this.previousMode = command.mode;
        }
        let torqueSum = 0, voltageSum = 0, powerSum = 0, reactiveSum = 0, lossSum = 0;
        this.currentLimited = false;
        for (let index = 0; index < steps; index++) {
            const before = this.motor.readings;
            const measured = connected === 2
                ? Math.max(this.current * Math.sqrt(3 / 2),
                    Math.max(Math.abs(before.phaseCurrent.U), Math.abs(before.phaseCurrent.V), Math.abs(before.phaseCurrent.W)) / Math.SQRT2)
                : before.currentRms;
            let voltage = 0;
            let excitation: MotorExcitation = command.mode === 'ac'
                ? { mode: 'ac', frequency: command.frequency, voltage: 0, connected: i.outputConnections }
                : command.mode === 'dc'
                    ? { mode: 'dc', voltages: { U: 0, V: 0, W: 0 }, connected: i.outputConnections }
                    : { mode: 'off' };
            if (excitation.mode === 'ac') {
                const factor = this.currentLimiter.step(h, measured, command.currentLimit);
                voltage = Math.min(command.voltage, this.dcLink.voltage / Math.SQRT2) * factor;
                // This controller constrains excitation, never physical current.
                this.currentLimited ||= factor < .995;
                excitation = { ...excitation, voltage };
            } else if (excitation.mode === 'dc' && topology.source && topology.returns.length) {
                voltage = this.injectionController.step(h, {
                    measuredCurrent: before.phaseCurrent[topology.source],
                    targetCurrent: Math.min(command.injectionCurrent, command.currentLimit),
                    statorResistance: circuit.statorResistance, returns: topology.returns.length,
                    loopInductance: circuit.leakageInductance * (1 + 1 / topology.returns.length),
                    maxVoltage: this.dcLink.voltage,
                });
                excitation = { ...excitation, voltages: { U: 0, V: 0, W: 0, [topology.source]: voltage } };
            }
            const board = this.dcLink.voltage >= PLANT_ASSUMPTIONS.boardStartVoltage ? PLANT_ASSUMPTIONS.boardPower : 0;
            this.motor.checkpoint(this.saved);
            const oldOmega = this.omega;
            // Positive load torque is passive Coulomb resistance. Combining it
            // with the finite shaft brake gives an exact stop/hold event rather
            // than stepping through zero and creating a reversal. Static load
            // sharing is indeterminate; split reaction/heat by their capacities.
            const passiveCapacity = Math.max(0, load.torque);
            const shaftCapacity = i.shaftHeld ? SHAFT_BRAKE_TORQUE_MULTIPLE * ratedTorque : 0;
            const capacity = passiveCapacity + shaftCapacity;
            const drivingTorque = load.torque < 0
                ? -load.torque * (Math.sign(oldOmega) || Math.sign(command.frequency) || 1) : 0;
            const coupled = (source: MotorExcitation) => {
                let brake: ShaftBrakeStep;
                const evaluate = (averageOmega: number): number => {
                    this.motor.restore(this.saved);
                    const result = this.motor.advance(h, { omega: averageOmega, excitation: source });
                    brake = stepShaftBrake({ omega: oldOmega,
                        appliedTorque: result.torque + drivingTorque - load.friction * averageOmega,
                        inertia, ratedTorque: capacity / SHAFT_BRAKE_TORQUE_MULTIPLE,
                        engaged: capacity > 0 }, h);
                    return averageOmega - brake.angleDelta / h;
                };
                // The electrical conversion work T*omega*h must equal the
                // mechanical work T*angleDelta, including a mid-step stop. A
                // secant solve normally converges in 2-3 trials. Bracketing is
                // the fallback for tiny inertia and extreme manual circuits;
                // there is no artificial physical speed ceiling.
                let x = oldOmega, residual = evaluate(x);
                let previousX = x, previousResidual = residual;
                const tolerance = (value: number) => 2e-12 * Math.max(1, Math.abs(value), Math.abs(oldOmega));
                for (let trial = 0; trial < 10 && Math.abs(residual) > tolerance(x); trial++) {
                    const denominator = residual - previousResidual;
                    const next = trial === 0 || Math.abs(denominator) < 1e-20
                        ? x - residual : x - residual * (x - previousX) / denominator;
                    if (!Number.isFinite(next)) break;
                    previousX = x; previousResidual = residual;
                    x = next; residual = evaluate(x);
                }
                if (Math.abs(residual) > tolerance(x)) {
                    let span = Math.max(1, Math.abs(x - oldOmega), Math.abs(previousX - oldOmega));
                    let low = oldOmega - span, high = oldOmega + span;
                    let left = evaluate(low), right = evaluate(high);
                    for (let trial = 0; (left > 0 || right < 0) && trial < 60; trial++) {
                        span *= 2; low = oldOmega - span; high = oldOmega + span;
                        left = evaluate(low); right = evaluate(high);
                    }
                    if (!(left <= 0 && right >= 0)) throw new Error('Could not bracket coupled motor motion.');
                    for (let trial = 0; trial < 80; trial++) {
                        x = (low + high) / 2; residual = evaluate(x);
                        if (Math.abs(residual) <= tolerance(x)) break;
                        if (residual < 0) low = x; else high = x;
                    }
                    if (Math.abs(residual) > 4 * tolerance(x)) throw new Error('Coupled motor motion did not converge.');
                }
                return { electrical: this.motor.readings, brake: brake! };
            };
            let accepted = coupled(excitation);
            const maximumWork = Math.max(0, this.dcLink.energy * (1 - PLANT_ASSUMPTIONS.energyReserveFraction) - board * h);
            if (accepted.electrical.inputPower * h > maximumWork && excitation.mode !== 'off') {
                // An empty finite capacitor cannot create motor flux. Every
                // voltage trial rolls back both flux/topology and shaft motion.
                // At zero applied voltage stator input work is exactly zero,
                // even while retained flux dissipates or exchanges shaft work.
                let low = 0, high = 1;
                const scaled = (factor: number): MotorExcitation => excitation.mode === 'ac'
                    ? { ...excitation, voltage: voltage * factor }
                    : { ...excitation, voltages: { U: 0, V: 0, W: 0, [topology.source!]: voltage * factor } };
                for (let trial = 0; trial < 18; trial++) {
                    const middle = (low + high) / 2;
                    const candidate = coupled(scaled(middle));
                    if (candidate.electrical.inputPower * h <= maximumWork) low = middle; else high = middle;
                }
                accepted = coupled(scaled(low));
                voltage *= low;
            }
            const { electrical, brake } = accepted;
            this.omega = brake.omega;
            this.angle = (this.angle + brake.angleDelta) % (2 * Math.PI);
            const shaftShare = capacity > 0 ? shaftCapacity / capacity : 0;
            this.shaftReactionTorque = brake.reactionTorque * shaftShare;
            this.brakeHeat += brake.dissipatedEnergy * shaftShare;
            this.numericalLoss += electrical.numericalLoss;
            this.switchingLoss += electrical.switchingLoss;
            this.meanCurrentSquared += (electrical.currentRms ** 2 - this.meanCurrentSquared)
                * -Math.expm1(-h / PLANT_ASSUMPTIONS.currentMeasurementSeconds);
            this.current = Math.sqrt(Math.max(0, this.meanCurrentSquared));
            const link = this.dcLink.step(h, { powered: i.powered, supplyV: i.supplyV,
                electricalPower: electrical.inputPower + board, brakeModule: i.brakeModule });
            // The reserve covers simultaneous bleeder/chopper dissipation.
            if (link.unservedEnergy > 1e-7) throw new Error('Unserved inverter energy: reduce the electrical integration step.');
            torqueSum += electrical.torque; voltageSum += voltage; powerSum += electrical.inputPower;
            lossSum += electrical.statorCopperLoss + electrical.rotorCopperLoss;
            reactiveSum += electrical.reactivePower;
            if (++this.sampleCount % 5 === 0 && this.listener) this.listener({
                time: startTime + (index + 1) * h, voltage: electrical.phaseVoltage, current: electrical.phaseCurrent,
                torque: electrical.instantaneousTorque, rpm: this.omega * 30 / Math.PI,
                flux: Math.hypot(electrical.rotorFlux.alpha, electrical.rotorFlux.beta), dcBus: link.voltage,
                running: command.running, fault: command.fault, loadTorque: load.torque,
            });
        }
        this.torque = torqueSum / steps; this.voltage = voltageSum / steps;
        this.inputPower = powerSum / steps; this.windingLoss = lossSum / steps;
        this.regenerativePower = Math.max(0, -this.inputPower);
        this.currentLag = Math.atan2(Math.abs(reactiveSum), powerSum);
        if (command.mode === 'off' || connected < 2) this.current = this.meanCurrentSquared = 0;
    }
}
