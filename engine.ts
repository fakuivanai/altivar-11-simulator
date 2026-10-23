import type { ParameterId, ParameterValues } from './parameter-types';
import { conductorMagnitudes, injectionTopology } from './electrical';
import { PhysicalPlant } from './physical-plant';
import { breakdownSlip, steadyStateMotor } from './motor-circuit';
import type { ScopeSample } from './scope-history';
import type {
    AnalogReading, Direction, DriveState, ElectricalOutput, EngineConfiguration, EngineConfigUpdate, FaultCode,
    Inputs, LogicInputAssignment, MonitorReadings, PhysicalReadings, ReadonlyEngineConfiguration,
} from './engine-types';
/* Original teaching model for ATV11HU09M2E. Parameter and I/O contracts are
   drawn from Schneider Electric ATV11 user manual V1.2 IE >=21, pp.26-33,
   https://se.my.site.com/ckmContent/sfc/servlet.shepherd/document/download/0698V00000lppRiQAI
   and technical manual ATV11 V1.2, pp.84,89-119,121-122.
   Electrical and mechanical dynamics are implemented in physical-plant.ts.
   Control/protection timing is a teaching model, not copied firmware. */
const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
// Explicit domain copies also work when a caller uses a Solid store.
function copyInputs(inputs: ReadonlyEngineConfiguration['inputs']): Inputs {
    return { ...inputs, outputConnections: { ...inputs.outputConnections } };
}
function copyConfiguration(config: ReadonlyEngineConfiguration): EngineConfiguration {
    return {
        parameters: { ...config.parameters },
        motor: { ...config.motor },
        ...(config.motorElectrical ? { motorElectrical: config.motorElectrical.mode === 'manual'
            ? { mode: 'manual' as const, parameters: { ...config.motorElectrical.parameters } }
            : { mode: 'estimated' as const } } : {}),
        mechanical: { ...config.mechanical },
        inputs: copyInputs(config.inputs)
    };
}
// ATV11HU09M2E nominal current, technical manual p.69. Integration uses a teaching 5 ms step.
const DRIVE_CURRENT = 2.1, FIXED_STEP = 0.005;
// Thermal time constants are teaching assumptions, not identified firmware data.
export const THERMAL_MODEL = Object.freeze({ motorSeconds: 45, driveSeconds: 60,
    tripPercent: 118, motorResetPercent: 100, driveResetPercent: 80, memoryResetSeconds: .4 });

function frozenConfiguration(config: ReadonlyEngineConfiguration): ReadonlyEngineConfiguration {
    const copy = copyConfiguration(config);
    Object.freeze(copy.parameters);
    Object.freeze(copy.motor);
    if (copy.motorElectrical?.mode === 'manual') Object.freeze(copy.motorElectrical.parameters);
    if (copy.motorElectrical) Object.freeze(copy.motorElectrical);
    Object.freeze(copy.mechanical);
    Object.freeze(copy.inputs.outputConnections);
    Object.freeze(copy.inputs);
    return Object.freeze(copy);
}
const AUTO_FAULTS = new Set<FaultCode>(['OHF', 'OLF', 'OLC', 'ULF', 'ObF', 'OSF', 'PHF']);
const POWER_RESET_FAULTS = new Set<FaultCode>(['OCF', 'SCF', 'InF', 'CrF', 'CFF']);
type RuntimeDriveState = Omit<DriveState, keyof PhysicalReadings | 'output' | 'outputMode'>;
interface DriveCommand {
    direction: Direction;
    nst: boolean;
    enable: boolean;
}
interface OutputControl {
    voltage: number;
    driveLimit: number;
    aggregateLimit: number;
    slipComp: number;
    dc: boolean;
}
export class VFDDrive {
    static readonly DRIVE_CURRENT = DRIVE_CURRENT;
    static readonly FIXED_STEP = FIXED_STEP;
    private configuration: ReadonlyEngineConfiguration;
    private electricalMode: ElectricalOutput['mode'] = 'off';
    get config(): ReadonlyEngineConfiguration { return this.configuration; }
    private runtimeState: RuntimeDriveState;
    private previousInputs: Inputs;
    private previousPower: boolean;
    private accumulator = 0;
    private commandReady: boolean;
    private directionLatch: Direction = 0;
    private trnDirection: Direction = 0;
    private piIntegral = 0;
    private frequencyVelocity = 0;
    private referenceDemand = 0;
    private readonly plant: PhysicalPlant;
    private dcTime = Infinity;
    private wasRunning = false;
    private lowSpeedTime = 0;
    private lowSpeedSleeping = false;
    private overloadTime = 0;
    private underloadTime = 0;
    private overcurrentTime = 0;
    private overspeedTime = 0;
    private brakingOvervoltageTime = 0;
    private autoElapsed = 0;
    private autoNext = 1;
    private autoAttempts = 0;
    private autoAborted = false;
    private powerOffTime = 0;
    private controlledPowerStop = false;
    get state(): Readonly<DriveState> { return this.snapshot(); }
    constructor(config: ReadonlyEngineConfiguration) {
        this.configuration = frozenConfiguration(config);
        this.plant = new PhysicalPlant(this.configuration);
        this.runtimeState = stoppedState(config);
        this.previousInputs = copyInputs(config.inputs);
        this.previousPower = config.inputs.powered;
        this.commandReady = !this.runSignalsPresent();
        this.referenceDemand = this.reference(0, 0);
        Object.assign(this.runtimeState, this.monitors());
    }
    private p<K extends ParameterId>(id: K): ParameterValues[K] {
        const value = this.configuration.parameters[id];
        if (value === undefined)
            throw new Error(`Missing required drive parameter: ${id}`);
        return value;
    }
    private input(id: LogicInputAssignment): boolean {
        return id !== 'nO' && this.configuration.inputs[id];
    }
    setConfig(config: ReadonlyEngineConfiguration, options: EngineConfigUpdate = {}): void {
        const next = frozenConfiguration(config);
        const motorChanged = JSON.stringify(next.motor) !== JSON.stringify(this.configuration.motor)
            || JSON.stringify(next.motorElectrical ?? { mode: 'estimated' })
                !== JSON.stringify(this.configuration.motorElectrical ?? { mode: 'estimated' });
        if (!options.reset && motorChanged && (this.electricalMode !== 'off' || Math.abs(this.runtimeState.omega) > .05))
            throw new RangeError('Desactive la salida y detenga el eje para cambiar el motor.');
        this.plant.configureMotor(next, options.reset || this.electricalMode === 'off' && Math.abs(this.runtimeState.omega) <= .05);
        this.configuration = next;
        if (options.reset) this.reset();
        else if (options.resetControl) this.inhibitCommands();
    }
    inhibitCommands(): Readonly<DriveState> {
        const s = this.runtimeState;
        this.commandReady = !this.runSignalsPresent();
        this.directionLatch = 0;
        this.trnDirection = 0;
        this.piIntegral = 0;
        this.frequencyVelocity = 0;
        this.dcTime = Infinity;
        this.wasRunning = false;
        this.lowSpeedTime = 0;
        this.lowSpeedSleeping = false;
        this.overloadTime = 0;
        this.underloadTime = 0;
        this.overcurrentTime = 0;
        this.overspeedTime = 0;
        this.previousInputs = copyInputs(this.configuration.inputs);
        this.electricalMode = 'off';
        Object.assign(s, { running: false, direction: 0, frequency: 0, reference: 0, rampFrequency: 0,
            voltage: 0, current: 0, torque: 0, currentLimited: false, referenceReached: false,
            piActive: false, armed: this.commandReady });
        this.referenceDemand = this.reference(0, 0);
        Object.assign(s, this.monitors());
        this.outputs();
        s.status = this.configuration.inputs.powered ? (s.fault || 'rdY') : '';
        return this.state;
    }
    setInputs(inputs: Partial<Inputs>): void {
        this.setConfig({ ...this.configuration, inputs: {
            ...this.configuration.inputs, ...inputs,
            outputConnections: inputs.outputConnections ?? this.configuration.inputs.outputConnections,
        } });
    }
    reset(): void {
        this.accumulator = 0;
        this.previousInputs = copyInputs(this.configuration.inputs);
        this.runtimeState = stoppedState(this.configuration);
        this.electricalMode = 'off';
        this.commandReady = !this.runSignalsPresent();
        this.directionLatch = 0;
        this.trnDirection = 0;
        this.piIntegral = 0;
        this.frequencyVelocity = 0;
        this.plant.reset();
        this.dcTime = Infinity;
        this.wasRunning = false;
        this.previousPower = !!this.configuration.inputs.powered;
        this.lowSpeedTime = 0;
        this.lowSpeedSleeping = false;
        this.overloadTime = 0;
        this.underloadTime = 0;
        this.overcurrentTime = 0;
        this.overspeedTime = 0;
        this.brakingOvervoltageTime = 0;
        this.autoElapsed = 0;
        this.autoNext = 1;
        this.autoAttempts = 0;
        this.autoAborted = false;
        this.powerOffTime = 0;
        this.controlledPowerStop = false;
        this.referenceDemand = this.reference(0, 0);
        Object.assign(this.runtimeState, this.monitors());
    }
    private runSignalsPresent(): boolean {
        const reverseInput = this.p('FUn.rrS');
        return this.input(this.p('FUn.tCC.ACt') === '3C' ? 'LI2' : 'LI1') || this.input(reverseInput);
    }
    private rising(id: LogicInputAssignment): boolean { return id !== 'nO' && this.input(id) && !this.previousInputs[id]; }
    private command(): Direction {
        const mode = this.p('FUn.tCC.ACt'), type = this.p('FUn.tCC.tCt');
        const forward = this.input(mode === '3C' ? 'LI2' : 'LI1'), reverse = this.input(this.p('FUn.rrS'));
        if (!forward && !reverse) {
            this.commandReady = true;
            this.trnDirection = 0;
        }
        if (!this.commandReady)
            return 0;
        if (mode === '3C') {
            if (!this.input('LI1')) {
                this.directionLatch = 0;
                this.commandReady = !forward && !reverse;
                return 0;
            }
            if (this.rising('LI2'))
                this.directionLatch = 1;
            if (this.rising(this.p('FUn.rrS')))
                this.directionLatch = -1;
            return this.directionLatch;
        }
        if (type === 'trn') {
            if (this.rising('LI1'))
                this.trnDirection = 1;
            if (this.rising(this.p('FUn.rrS')))
                this.trnDirection = -1;
            if (this.trnDirection === 1 && !forward)
                this.trnDirection = reverse ? -1 : 0;
            if (this.trnDirection === -1 && !reverse)
                this.trnDirection = forward ? 1 : 0;
            return this.trnDirection;
        }
        if (type === 'PFO' && forward)
            return 1;
        return reverse ? -1 : forward ? 1 : 0;
    }
    analog(): AnalogReading {
        const i = this.configuration.inputs, pct = clamp(i.analogPosition, 0, 100) / 100;
        const type = this.p('AIt.ACt');
        const voltage = i.analogType === '5V' ? 5 * pct : i.analogType === '10V' ? 10 * pct : 0;
        const current = i.analogType === '20mA' ? 20 * pct : 0;
        let normalized = 0;
        if (type === '5U')
            normalized = voltage / 5;
        else if (type === '10U')
            normalized = voltage / 10;
        else if (type === '0A')
            normalized = current / 20;
        else if (type === '4A')
            normalized = (current - 4) / 16;
        else
            normalized = (current - this.p('AIt.CrL')) / (this.p('AIt.CrH') - this.p('AIt.CrL'));
        return { normalized: clamp(normalized, 0, 1), voltage, current };
    }
    private highSpeed(): number {
        const a = this.input(this.p('FUn.HSP.LIA')), b = this.input(this.p('FUn.HSP.LIb'));
        return a && b ? this.p('FUn.HSP.HS4') : b ? this.p('FUn.HSP.HS3') : a ? this.p('FUn.HSP.HS2') : this.p('HSP');
    }
    private reference(dt: number, direction: Direction): number {
        const s = this.runtimeState, hi = this.highSpeed(), lo = this.p('LSP'), ai = this.analog();
        s.activeHighSpeed = hi;
        s.piFeedback = ai.normalized * 100 * this.p('FUn.PI.FbS');
        const pi = this.p('FUn.PI.PIF') === 'AI1';
        const automatic = pi && (this.p('FUn.PI.PAU') === 'nO' || this.input(this.p('FUn.PI.PAU')));
        s.piActive = automatic && direction !== 0;
        let ref = lo + ai.normalized * (hi - lo);
        const a = this.input(this.p('FUn.PS2.LIA')), b = this.input(this.p('FUn.PS2.LIb'));
        if (pi) {
            const pr2 = this.input(this.p('FUn.PI.Pr2')), pr4 = this.input(this.p('FUn.PI.Pr4'));
            /* Technical manual p.102: 11 = PI3, 10 = PI4, unlike speed preset binary order. */
            s.piReference = pr2 && pr4 ? this.p('FUn.PI.PI3')
                : pr4 ? this.p('FUn.PI.PI4') : pr2 ? this.p('FUn.PI.PI2') : this.p('FUn.PI.rPI');
            s.piError = (s.piReference - s.piFeedback) / 100 * (this.p('FUn.PI.PIC') === 'YES' ? -1 : 1);
            const proportional = this.p('FUn.PI.rPG') * s.piError;
            const manual = b ? this.p('SP4') : this.p('SP2');
            if (automatic) {
                const raw = proportional + this.piIntegral;
                if (direction && ((raw > 0 && raw < 1) || (raw <= 0 && s.piError > 0) || (raw >= 1 && s.piError < 0)))
                    this.piIntegral += this.p('FUn.PI.rIG') * s.piError * dt;
                this.piIntegral = clamp(this.piIntegral, -10, 10);
                ref = clamp((proportional + this.piIntegral) * hi, lo, hi);
            }
            else {
                ref = manual;
                this.piIntegral = ref / Math.max(hi, 0.1) - proportional;
            }
        }
        else {
            s.piReference = 0;
            s.piError = 0;
            if (a && b)
                ref = this.p('SP4');
            else if (b)
                ref = this.p('SP3');
            else if (a)
                ref = this.p('SP2');
        }
        return clamp(ref, 0, hi);
    }
    private trip(code: FaultCode): void {
        if (this.runtimeState.fault)
            return;
        this.runtimeState.fault = code;
        this.electricalMode = 'off';
        this.runtimeState.running = false;
        this.runtimeState.piActive = false;
        this.runtimeState.current = 0;
        this.runtimeState.voltage = 0;
        this.runtimeState.torque = 0;
        this.runtimeState.frequency = 0;
        this.runtimeState.rampFrequency = 0;
        this.frequencyVelocity = 0;
        this.directionLatch = 0;
        this.trnDirection = 0;
        this.commandReady = false;
        this.autoElapsed = 0;
        this.autoNext = 1;
        this.autoAttempts = 0;
        this.autoAborted = false;
    }
    private faultCauseGone(code: FaultCode): boolean {
        const s = this.runtimeState, i = this.configuration.inputs, bus = i.supplyV * Math.SQRT2;
        if (code === 'OLF')
            return s.motorThermal < THERMAL_MODEL.motorResetPercent;
        if (code === 'OHF')
            return s.driveThermal < THERMAL_MODEL.driveResetPercent;
        if (code === 'OSF')
            return bus <= 415;
        if (code === 'ObF')
            return s.dcBus <= 415;
        if (code === 'USF')
            return !!i.powered && bus >= 230 && !this.plant.dcLink.precharging && s.dcBus >= 230;
        if (code === 'SCF')
            return !i.shortCircuit;
        if (code === 'OLC')
            return !i.shaftHeld && this.estimatedLoadCurrent() <= DRIVE_CURRENT * this.p('FUn.LOC') / 100;
        if (code === 'ULF')
            return this.connectedOutputCount() >= 2 && this.estimatedLoadCurrent() >= DRIVE_CURRENT * this.p('FUn.LUL') / 100;
        if (code === 'SOF')
            return Math.abs(s.rpm) < this.configuration.motor.speedRPM * 1.2;
        return true;
    }
    resetFault(powerCycle = false, automatic = false): boolean {
        const code = this.runtimeState.fault;
        if (!code)
            return false;
        // User p.64 / technical p.115: an aborted six-minute restart sequence
        // remains locked until the drive is disconnected and reconnected.
        if (this.autoAborted && !powerCycle)
            return false;
        if (!powerCycle && POWER_RESET_FAULTS.has(code))
            return false;
        if (!this.faultCauseGone(code))
            return false;
        this.runtimeState.fault = null;
        this.runtimeState.frequency = 0;
        this.runtimeState.rampFrequency = 0;
        this.frequencyVelocity = 0;
        this.directionLatch = 0;
        this.trnDirection = 0;
        this.commandReady = automatic || !this.runSignalsPresent();
        this.overloadTime = 0;
        this.underloadTime = 0;
        this.overcurrentTime = 0;
        this.overspeedTime = 0;
        this.lowSpeedTime = 0;
        this.lowSpeedSleeping = false;
        return true;
    }
    private nominalTorque(): number {
        const motor = this.configuration.motor;
        return 1000 * motor.powerKW / Math.max(motor.speedRPM * Math.PI / 30, 0.01);
    }
    // With the bridge off there is no measured load current. Reset eligibility
    // uses the balanced steady-state circuit at rated frequency, not the old
    // independent torque/current scale. This is a diagnostic assumption.
    private estimatedLoadCurrent(): number {
        const { motor: m, mechanical: load, inputs } = this.configuration;
        const circuit = this.plant.circuit, synchronous = 2 * Math.PI * m.frequency / circuit.polePairs;
        const demand = Math.abs(load.torque) + load.friction * m.speedRPM * Math.PI / 30;
        const voltage = Math.min(inputs.supplyV, this.p('drC.UnS'));
        const point = (slip: number) => steadyStateMotor(circuit, voltage, m.frequency, synchronous * (1 - slip));
        let low = 0, high = Math.min(1, breakdownSlip(circuit, m.frequency));
        if (point(high).torque < demand) return Infinity;
        for (let iteration = 0; iteration < 28; iteration++) {
            const middle = (low + high) / 2;
            if (point(middle).torque < demand) low = middle;
            else high = middle;
        }
        return point((low + high) / 2).current;
    }
    private connectedOutputCount(): number {
        const wires = this.configuration.inputs.outputConnections;
        return Number(wires.U) + Number(wires.V) + Number(wires.W);
    }
    private automaticReset(dt: number): void {
        const s = this.runtimeState;
        if (!s.fault || !this.configuration.inputs.powered)
            return;
        if (s.fault === 'USF' && this.faultCauseGone('USF')) {
            this.resetFault(false, false);
            return;
        }
        if (this.p('FUn.Atr') !== 'YES' || !AUTO_FAULTS.has(s.fault) || this.autoAborted)
            return;
        this.autoElapsed += dt;
        if (this.autoElapsed >= 360) {
            this.autoAborted = true;
            return;
        }
        if (this.autoElapsed >= this.autoNext) {
            this.autoAttempts++;
            const nst = this.p('FUn.nSt');
            // Tech p.115: the run order must still be present and the other
            // operating conditions must permit restart. A zero demand remains
            // a valid frequency reference; no analog-loss detector is modeled.
            if (this.faultCauseGone(s.fault) && this.runSignalsPresent() && (nst === 'nO' || this.input(nst))) {
                this.resetFault(false, true);
                return;
            }
            this.autoNext += this.autoAttempts === 1 ? 5 : this.autoAttempts === 2 ? 10 : 60;
        }
    }
    advance(dt: number): Readonly<DriveState> {
        if (!Number.isFinite(dt) || dt < 0 || dt > 600)
            throw new Error('Invalid elapsed time');
        this.accumulator += dt;
        const stepCount = Math.floor((this.accumulator + 1e-10) / FIXED_STEP);
        this.accumulator -= stepCount * FIXED_STEP;
        if (this.accumulator < 0)
            this.accumulator = 0;
        for (let step = 0; step < stepCount; step++)
            this.tick(FIXED_STEP);
        return this.state;
    }
    step(dt: number): Readonly<DriveState> { return this.advance(dt); }
    onPhysicalSample(listener: ((sample: ScopeSample) => void) | undefined): void { this.plant.setSampleListener(listener); }
    /** A rendering slice may leave time queued; fixed physics steps stay intact. */
    advanceBudget(dt: number, budgetMs = 8, now: () => number = () => performance.now()): { steps: number; backlog: number } {
        if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(budgetMs) || budgetMs <= 0)
            throw new RangeError('Invalid elapsed time or frame budget');
        this.accumulator += dt;
        const available = Math.floor((this.accumulator + 1e-10) / FIXED_STEP), start = now();
        let steps = 0;
        while (steps < available && (steps === 0 || now() - start < budgetMs)) { this.tick(FIXED_STEP); steps++; }
        this.accumulator = Math.max(0, this.accumulator - steps * FIXED_STEP);
        return { steps, backlog: this.accumulator };
    }
    private tick(dt: number): void {
        const power = this.configuration.inputs.powered;
        this.runtimeState.time += dt;
        this.updatePowerState(dt, power);
        const command = this.readCommand(dt, power);
        const control = this.controlOutput(dt, power, command);
        this.advancePlant(dt, control);
        this.updateElectricalProtections(dt, power, control.aggregateLimit);
        this.updateReferenceReached(control.slipComp);
        this.updateLoadProtections(dt);
        this.publishReadings(power, command.nst, control.dc);
    }
    private updatePowerState(dt: number, power: boolean): void {
        const s = this.runtimeState, wasPowered = this.previousPower;
        if (!power) {
            this.powerOffTime += dt;
            if (wasPowered) {
                this.controlledPowerStop = this.p('FUn.StP') !== 'nO' && s.running;
                this.directionLatch = 0;
                this.trnDirection = 0;
            }
            if (this.powerOffTime > THERMAL_MODEL.memoryResetSeconds) {
                s.motorThermal = 0;
                this.commandReady = false;
            }
        }
        else if (!wasPowered) {
            const cycled = this.powerOffTime > THERMAL_MODEL.memoryResetSeconds;
            this.powerOffTime = 0;
            if (cycled) {
                this.resetFault(true, false);
                // The power cycle releases an aborted restart procedure even
                // when a still-present cause prevents clearing the fault.
                this.autoElapsed = 0;
                this.autoNext = 1;
                this.autoAttempts = 0;
                this.autoAborted = false;
                s.motorThermal = 0;
            }
            this.commandReady = this.p('FUn.Atr') === 'YES' || !this.runSignalsPresent();
            this.controlledPowerStop = false;
        }
        if (this.rising(this.p('FUn.rSF')))
            this.resetFault(false, false);
        this.automaticReset(dt);
    }
    private readCommand(dt: number, power: boolean): DriveCommand {
        const s = this.runtimeState, i = this.configuration.inputs, m = this.configuration.motor;
        let direction = this.command();
        const nst = this.p('FUn.nSt') !== 'nO' && !this.input(this.p('FUn.nSt'));
        if (nst) {
            direction = 0;
            this.directionLatch = 0;
            this.trnDirection = 0;
            if (this.p('FUn.tCC.ACt') === '3C' || this.p('FUn.tCC.tCt') === 'trn')
                this.commandReady = !this.runSignalsPresent();
        }
        const reference = this.reference(dt, direction);
        this.referenceDemand = reference;
        if (reference <= this.p('LSP') + 0.001 && direction) {
            if (s.referenceReached && Math.abs(s.reference - direction * reference) < 0.05)
                this.lowSpeedTime += dt;
            if (this.p('FUn.tLS') > 0 && this.lowSpeedTime >= this.p('FUn.tLS'))
                this.lowSpeedSleeping = true;
        }
        else {
            this.lowSpeedTime = 0;
            // Tech pp.103/107 place PIC before the wake threshold. Comparing
            // the signed correction is a model interpretation: a negative
            // error requests less speed and does not itself wake the process.
            if (reference > this.p('LSP') + 0.001 && (!s.piActive || s.piError * 1000 >= this.p('FUn.PI.rSL')))
                this.lowSpeedSleeping = false;
        }
        if (this.lowSpeedSleeping)
            direction = 0;
        let enable = power && !s.fault && !nst && !this.plant.dcLink.precharging;
        if (!power && this.controlledPowerStop && s.dcBus >= 230 && !s.fault) {
            enable = true;
            direction = 0;
        }
        if (power && i.supplyV * Math.SQRT2 > 415)
            this.trip('OSF');
        if (power && i.supplyV * Math.SQRT2 < 230)
            this.trip('USF');
        if (s.fault)
            enable = false;
        if (direction && !this.wasRunning && enable) {
            if (this.p('FUn.FLr') === 'YES') {
                s.rampFrequency = s.omega * m.poles / (4 * Math.PI);
                s.frequency = s.rampFrequency;
            }
            this.dcTime = Infinity;
        }
        const target = direction * reference;
        s.reference = target;
        s.direction = direction;
        s.armed = this.commandReady;
        return { direction, nst, enable };
    }
    private controlOutput(dt: number, power: boolean, command: DriveCommand): OutputControl {
        const s = this.runtimeState, i = this.configuration.inputs, m = this.configuration.motor;
        const { direction, nst } = command;
        let { enable } = command;
        const connectedOutputs = this.connectedOutputCount();
        this.updateRamp(dt, power, direction, enable);
        const frs = this.p('drC.FrS');
        const wasRunning = this.wasRunning;
        s.running = enable && (direction !== 0 || Math.abs(s.rampFrequency) > 0.05);
        s.piActive = s.piActive && enable && s.running;
        if (wasRunning && !s.running && !s.fault && !nst && power)
            this.dcTime = 0;
        const dcMode = this.p('FUn.AdC.ACt');
        let dc = enable && !s.running && !nst && dcMode !== 'nO' &&
            (this.p('FUn.tCC.ACt') !== '3C' || this.input('LI1')) &&
            (dcMode === 'Ct' || this.dcTime < this.p('FUn.AdC.tdC'));
        // A passive bridge is exposed to SCF protection when AC output or DC
        // injection energizes it. An idle output has no short-circuit current.
        if (enable && i.shortCircuit && (s.running || dc)) {
            this.trip('SCF');
            enable = false;
            dc = false;
        }
        if (dc)
            this.dcTime += dt;
        const driveLimit = this.input(this.p('FUn.LC2.LI')) ? this.p('FUn.LC2.CL2') : this.p('drC.CLI');
        s.activeCurrentLimit = driveLimit;
        // CLI/CL2 constrain each conducting line. LCr is the three-line RMS,
        // so two equal conducting lines have a lower aggregate current cap.
        const aggregateLimit = connectedOutputs === 2 ? driveLimit * Math.sqrt(2 / 3) : driveLimit;
        const ratedTorque = this.nominalTorque(), rotorHz = s.omega * m.poles / (4 * Math.PI);
        const actualSlip = Math.max(0.2, m.frequency - m.speedRPM * m.poles / 120);
        const controlVector = this.p('drC.FLG') > 0 && this.p('drC.StA') > 0;
        const inferredTorque = Math.abs(s.torque) / ratedTorque * m.current
            / Math.max(0.05, this.p('drC.nCr')) * m.cosPhi / this.p('drC.COS');
        let slipComp = controlVector && direction !== 0
            ? this.p('drC.nSL') * this.p('drC.SLP') / 100 * inferredTorque * Math.sign(s.rampFrequency) : 0;
        slipComp = clamp(slipComp, -15, 15);
        let commandedFrequency = s.rampFrequency + slipComp;
        let brakingFloor: number | undefined;
        // brA changes the frequency demand before excitation. It does not
        // discard regenerated energy or override electromagnetic torque.
        if (enable && s.running && this.p('FUn.brA') === 'YES' && !i.brakeModule && s.omega * commandedFrequency >= 0
            && Math.abs(rotorHz) > Math.abs(commandedFrequency)) {
            const allowedSlip = actualSlip * .1 * clamp((350 - s.dcBus) / 30, 0, 1);
            const following = rotorHz - Math.sign(s.omega) * allowedSlip;
            commandedFrequency = s.omega > 0 ? Math.max(commandedFrequency, following) : Math.min(commandedFrequency, following);
            s.rampFrequency = commandedFrequency - slipComp;
            brakingFloor = following;
        }
        if (enable && s.running) {
            const gain = this.p('drC.FLG'), stability = this.p('drC.StA');
            const wn = controlVector ? 3 + gain * 0.28 : 20;
            const damping = controlVector ? 0.35 + stability * 0.0425 : 1;
            this.frequencyVelocity += (wn * wn * (commandedFrequency - s.frequency) - 2 * damping * wn * this.frequencyVelocity) * dt;
            this.frequencyVelocity = clamp(this.frequencyVelocity, -1000, 1000);
            s.frequency = clamp(s.frequency + this.frequencyVelocity * dt, -220, 220);
            // The adapted demand already follows the changing rotor speed.
            // Filtering it again leaves positive slip during deceleration and
            // makes the field keep motoring. Track that active limit directly;
            // voltage, flux and current still evolve in the physical motor.
            if (brakingFloor !== undefined) {
                s.frequency = commandedFrequency;
                this.frequencyVelocity = 0;
            }
        }
        else {
            s.frequency = 0;
            this.frequencyVelocity = 0;
        }
        let voltage = 0;
        if (enable && s.running) {
            const f = Math.abs(s.frequency);
            const boost = this.p('drC.UFr') / 50 * 6 * Math.exp(-f / 8);
            voltage = Math.min(i.supplyV, this.p('drC.UnS') * Math.min(f / frs, 1) + boost);
        }
        this.electricalMode = enable && s.running ? 'ac' : dc ? 'dc' : 'off';
        return { voltage, driveLimit, aggregateLimit, slipComp, dc };
    }
    private updateRamp(dt: number, power: boolean, direction: Direction, enable: boolean): void {
        const s = this.runtimeState, m = this.configuration.motor;
        const target = s.reference, connectedOutputs = this.connectedOutputCount();
        const secondRamp = this.input(this.p('FUn.rP2.LI'));
        const acc = this.p(secondRamp ? 'FUn.rP2.AC2' : 'ACC');
        let dec = this.p(secondRamp ? 'FUn.rP2.dE2' : 'dEC');
        if (!power && this.p('FUn.StP') === 'FSt')
            dec = 0.1;
        const frs = this.p('drC.FrS'), oldRamp = s.rampFrequency;
        const reversing = oldRamp * target < 0;
        const intermediate = reversing ? 0 : target;
        const accelerating = Math.abs(intermediate) > Math.abs(oldRamp);
        const rampTime = accelerating ? acc : dec;
        const maxDelta = rampTime === 0 ? Infinity : frs / rampTime * dt;
        if (enable) {
            const delta = clamp(intermediate - oldRamp, -maxDelta, maxDelta);
            if (!(s.currentLimited && accelerating))
                s.rampFrequency += delta;
            // A frozen high-frequency demand cannot restart a stalled physical
            // motor when CLI leaves less locked-rotor torque than the load.
            // This teaching controller folds frequency back along the configured
            // ramp toward rated slip above the shaft, without assigning torque.
            const rotorFrequency = s.omega * m.poles / (4 * Math.PI);
            const nominalSlip = Math.max(.2, m.frequency - m.speedRPM * m.poles / 120);
            if (direction && s.currentLimited && connectedOutputs >= 2
                && (s.frequency - rotorFrequency) * direction > nominalSlip) {
                const recover = rotorFrequency + direction * nominalSlip;
                s.rampFrequency = direction > 0
                    ? Math.max(recover, s.rampFrequency - maxDelta)
                    : Math.min(recover, s.rampFrequency + maxDelta);
            }
        }
        else {
            s.rampFrequency = 0;
            this.frequencyVelocity = 0;
            s.frequency = 0;
        }
    }
    private advancePlant(dt: number, control: OutputControl): void {
        const s = this.runtimeState;
        const { voltage, driveLimit } = control;
        this.plant.advance(dt, { mode: this.electricalMode, frequency: s.frequency,
            voltage, currentLimit: driveLimit, injectionCurrent: this.p('FUn.AdC.SdC'),
            running: s.running, fault: s.fault }, this.configuration, s.time - dt);
        const physical = this.plant, electrical = physical.instantaneous;
        Object.assign(s, {
            omega: physical.omega, rpm: physical.omega * 30 / Math.PI, angle: physical.angle,
            torque: physical.torque, voltage: physical.voltage, current: physical.current,
            currentLag: physical.currentLag, currentLimited: physical.currentLimited,
            dcBus: physical.dcLink.voltage, regenerativePower: physical.regenerativePower,
            statorFluxAlpha: electrical.statorFlux.alpha, statorFluxBeta: electrical.statorFlux.beta,
            rotorFluxAlpha: electrical.rotorFlux.alpha, rotorFluxBeta: electrical.rotorFlux.beta,
            magneticEnergy: electrical.magneticEnergy, inputPower: physical.inputPower,
            motorCopperLoss: physical.windingLoss, busPrecharging: physical.dcLink.precharging,
        });
    }
    private updateElectricalProtections(dt: number, power: boolean, aggregateLimit: number): void {
        const s = this.runtimeState, i = this.configuration.inputs, m = this.configuration.motor;
        const physical = this.plant;
        if (this.electricalMode === 'ac' && s.current > aggregateLimit * 1.15) this.overcurrentTime += dt;
        else this.overcurrentTime = 0;
        if (this.overcurrentTime > .08) this.trip('OCF');
        if (power && !physical.dcLink.precharging && s.dcBus < 230) this.trip('USF');
        const sf = this.p('FUn.SFt.ACt'), configured = this.p('FUn.SFt.SFr');
        s.switchingFrequency = sf === 'HF' && s.driveThermal > 90 ? 4 : configured === 2 && Math.abs(s.frequency) > 100 ? 4 : configured;
        if (sf === 'LFr')
            s.switchingFrequency *= 1 + 0.12 * Math.sin(s.time * 37) + 0.05 * Math.sin(s.time * 83);
        const switchingHeating = 1 + 0.025 * (s.switchingFrequency - 4);
        const ratio = s.current / Math.max(0.01, this.p('ItH'));
        s.motorThermal += (Math.min(10000, 100 * ratio * ratio) - s.motorThermal) * (1 - Math.exp(-dt / THERMAL_MODEL.motorSeconds));
        s.actualMotorThermal += (100 * (s.current / m.current) ** 2 - s.actualMotorThermal)
            * (1 - Math.exp(-dt / THERMAL_MODEL.motorSeconds));
        const ambient = Math.max(0, (i.ambient - 25) * 1.5), cooling = 0.15 + 0.85 * i.ventilation;
        const driveTarget = power ? ambient + 100 * (s.current / DRIVE_CURRENT) ** 2 * switchingHeating / cooling : 0;
        s.driveThermal += (driveTarget - s.driveThermal) * (1 - Math.exp(-dt / THERMAL_MODEL.driveSeconds));
        if (s.dcBus > 415) {
            this.brakingOvervoltageTime += dt;
            if (this.brakingOvervoltageTime > .01) this.trip('ObF');
        } else this.brakingOvervoltageTime = 0;
        if (s.motorThermal > THERMAL_MODEL.tripPercent)
            this.trip('OLF');
        if (s.driveThermal > THERMAL_MODEL.tripPercent)
            this.trip('OHF');
    }
    private updateReferenceReached(slipComp: number): void {
        const s = this.runtimeState;
        const reachedBand = s.piActive ? this.p('FUn.AP1') : 0.1;
        const difference = Math.abs(s.frequency - (s.reference + slipComp));
        if (!s.running)
            s.referenceReached = false;
        else if (difference <= Math.max(0, reachedBand - (s.piActive ? 0.2 : 0)))
            s.referenceReached = true;
        else if (difference > reachedBand)
            s.referenceReached = false;
    }
    private updateLoadProtections(dt: number): void {
        const s = this.runtimeState, m = this.configuration.motor;
        /* Compare with the frequency demand including the modeled slip compensation. */
        if (s.running && s.referenceReached && !s.fault) {
            const loc = DRIVE_CURRENT * this.p('FUn.LOC') / 100, lul = DRIVE_CURRENT * this.p('FUn.LUL') / 100;
            if (s.current < loc - 0.1 * DRIVE_CURRENT)
                this.overloadTime = 0;
            else if (s.current > loc || this.overloadTime > 0)
                this.overloadTime += dt;
            if (s.current > lul + 0.1 * DRIVE_CURRENT)
                this.underloadTime = 0;
            else if (s.current < lul || this.underloadTime > 0)
                this.underloadTime += dt;
            if (this.p('FUn.tOL') > 0 && this.overloadTime >= this.p('FUn.tOL'))
                this.trip('OLC');
            if (this.p('FUn.tUL') > 0 && this.underloadTime >= this.p('FUn.tUL'))
                this.trip('ULF');
        }
        else if (!s.running) {
            this.overloadTime = 0;
            this.underloadTime = 0;
        }
        if (s.running && Math.abs(s.rpm) > Math.max(1, s.activeHighSpeed) * 120 / m.poles * 1.2)
            this.overspeedTime += dt;
        else
            this.overspeedTime = 0;
        if (this.overspeedTime > 0.3)
            this.trip('SOF');
    }
    private publishReadings(power: boolean, nst: boolean, dc: boolean): void {
        const s = this.runtimeState, i = this.configuration.inputs;
        this.wasRunning = s.running && !s.fault;
        s.status = !power ? '' : s.fault ? s.fault : nst ? 'nSt' : dc ? 'dcb' : s.running ? 'run' : 'rdY';
        s.relay = power && (!s.fault || this.p('FUn.Atr') === 'YES' && AUTO_FAULTS.has(s.fault) && !this.autoAborted);
        this.outputs();
        Object.assign(s, this.monitors());
        s.HSU = s.activeHighSpeed;
        this.previousInputs = copyInputs(i);
        this.previousPower = power;
    }
    private outputs(): void {
        const s = this.runtimeState, code = this.p('FUn.dO.ACt');
        s.DOType = code === 'OCr' || code === 'rFr' ? 'analog' : 'logic';
        let out = 0;
        if (code === 'OCr')
            out = clamp(s.current / (2 * DRIVE_CURRENT), 0, 1);
        if (code === 'rFr')
            out = clamp(Math.abs(s.frequency) / Math.max(0.1, this.p('HSP')), 0, 1);
        if (code === 'FtA')
            out = Number(Math.abs(s.frequency) > this.p('FUn.dO.Ftd'));
        if (code === 'SrA')
            out = Number(s.referenceReached);
        if (code === 'CtA')
            out = Number(s.current > this.p('FUn.dO.Ctd'));
        if (code === 'PI')
            out = Number(s.piActive && s.running && !s.fault);
        if (!this.configuration.inputs.powered)
            out = 0;
        s.DO = out;
        s.DOvoltage = 15 * out;
    }
    monitors(): Readonly<MonitorReadings> {
        const s = this.runtimeState;
        // FrH is the selected demand, also visible while stopped (tech p.119).
        // s.reference is the signed run/stop target consumed by the ramps.
        return { FrH: this.referenceDemand, rFr: Math.abs(s.frequency), LCr: s.current,
            ULn: this.configuration.inputs.powered ? this.configuration.inputs.supplyV : 0,
            tHr: s.motorThermal, tHd: s.driveThermal, rPF: s.piFeedback };
    }
    private physicalReadings(): PhysicalReadings {
        const s = this.runtimeState, i = this.configuration.inputs;
        const { U, V, W } = conductorMagnitudes(this.electricalMode, s.current, i.outputConnections);
        const average = (U + V + W) / 3;
        const currentImbalance = average > 0
            ? 100 * Math.max(Math.abs(U - average), Math.abs(V - average), Math.abs(W - average)) / average : 0;
        return {
            phaseCurrentU: U,
            phaseCurrentV: V,
            phaseCurrentW: W,
            currentImbalance,
            shaftReactionTorque: i.shaftHeld ? this.plant.shaftReactionTorque : 0
        };
    }
    private electricalOutput(physical: PhysicalReadings): ElectricalOutput {
        const s = this.runtimeState;
        const common = { dcBus: s.dcBus, switchingKHz: s.switchingFrequency,
            connected: { ...this.configuration.inputs.outputConnections } };
        if (this.electricalMode === 'off') return { ...common, mode: 'off' };
        const active = { ...common, voltage: s.voltage, aggregateCurrent: s.current,
            current: { U: physical.phaseCurrentU, V: physical.phaseCurrentV, W: physical.phaseCurrentW } };
        return this.electricalMode === 'ac'
            ? { ...active, mode: 'ac', frequency: s.frequency, currentLag: s.currentLag }
            : { ...active, mode: 'dc', topology: injectionTopology(common.connected) };
    }
    snapshot(): Readonly<DriveState> {
        const physical = this.physicalReadings(), output = this.electricalOutput(physical);
        return { ...this.runtimeState, ...physical, output, outputMode: output.mode };
    }
}
// A newly loaded setup starts with zero motion and accumulated heat. These are
// physical initial conditions, not replacements for absent configuration fields.
function stoppedState(config: ReadonlyEngineConfiguration): RuntimeDriveState {
    return {
        time: 0,
        omega: 0,
        rpm: 0,
        angle: 0,
        frequency: 0,
        reference: 0,
        rampFrequency: 0,
        voltage: 0,
        current: 0,
        torque: 0,
        dcBus: 0,
        motorThermal: 0,
        actualMotorThermal: 0,
        driveThermal: 0,
        fault: null,
        status: 'rdY',
        relay: false,
        DO: 0,
        DOType: 'analog',
        DOvoltage: 0,
        running: false,
        direction: 0,
        currentLimited: false,
        referenceReached: false,
        piFeedback: 0,
        piReference: 0,
        piError: 0,
        piActive: false,
        activeHighSpeed: config.parameters.HSP,
        activeCurrentLimit: config.parameters['drC.CLI'],
        switchingFrequency: config.parameters['FUn.SFt.SFr'],
        currentLag: Math.PI / 2,
        regenerativePower: 0,
        statorFluxAlpha: 0, statorFluxBeta: 0, rotorFluxAlpha: 0, rotorFluxBeta: 0,
        magneticEnergy: 0, inputPower: 0, motorCopperLoss: 0, busPrecharging: true,
        armed: false,
        FrH: 0,
        rFr: 0,
        LCr: 0,
        ULn: config.inputs.powered ? config.inputs.supplyV : 0,
        tHr: 0,
        tHd: 0,
        rPF: 0,
        HSU: config.parameters.HSP
    };
}
export default VFDDrive;
