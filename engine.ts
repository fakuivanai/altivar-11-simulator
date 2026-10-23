import type { ParameterId, ParameterValues } from './parameter-types';
import type { AnalogReading, Direction, DriveState, EngineConfiguration, EngineConfigUpdate, FaultCode, Inputs, LogicInputAssignment, MonitorReadings, PhysicalReadings, RunningDirection } from './engine-types';
/* Original teaching model for ATV11HU09M2E. Parameter and I/O contracts are
   drawn from Schneider Electric ATV11 user manual V1.2 IE >=21, pp.26-33,
   https://se.my.site.com/ckmContent/sfc/servlet.shepherd/document/download/0698V00000lppRiQAI
   and technical manual ATV11 V1.2, pp.84,89-119,121-122.
   The motor equations are an original reduced model, not copied firmware. */
const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
// Explicit domain copies also work when a caller uses a Solid store.
function copyInputs(inputs: Inputs): Inputs {
    return { ...inputs, outputConnections: { ...inputs.outputConnections } };
}
function copyConfiguration(config: EngineConfiguration): EngineConfiguration {
    return {
        parameters: { ...config.parameters },
        motor: { ...config.motor },
        mechanical: { ...config.mechanical },
        inputs: copyInputs(config.inputs)
    };
}
const DRIVE_CURRENT = 2.1, FIXED_STEP = 0.005;
const AUTO_FAULTS = new Set<FaultCode>(['OHF', 'OLF', 'OLC', 'ULF', 'ObF', 'OSF', 'PHF']);
const POWER_RESET_FAULTS = new Set<FaultCode>(['OCF', 'SCF', 'InF', 'CrF', 'CFF']);
type RuntimeDriveState = Omit<DriveState, keyof PhysicalReadings>;
export class VFDDrive {
    static readonly DRIVE_CURRENT = DRIVE_CURRENT;
    static readonly FIXED_STEP = FIXED_STEP;
    config: EngineConfiguration;
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
    private electricalPhase = 0;
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
    private lastActiveDirection: RunningDirection = 1;
    get state(): Readonly<DriveState> { return this.snapshot(); }
    constructor(config: EngineConfiguration) {
        this.config = copyConfiguration(config);
        this.runtimeState = stoppedState(config);
        this.previousInputs = copyInputs(config.inputs);
        this.previousPower = config.inputs.powered;
        this.commandReady = !this.runSignalsPresent();
        this.referenceDemand = this.reference(0, 0);
        Object.assign(this.runtimeState, this.monitors());
    }
    private p<K extends ParameterId>(id: K): ParameterValues[K] {
        const value = this.config.parameters[id];
        if (value === undefined)
            throw new Error(`Missing required drive parameter: ${id}`);
        return value;
    }
    private input(id: LogicInputAssignment): boolean {
        return id !== 'nO' && this.config.inputs[id];
    }
    setConfig(config: EngineConfiguration, options: EngineConfigUpdate = {}): void {
        this.config = copyConfiguration(config);
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
        this.previousInputs = copyInputs(this.config.inputs);
        Object.assign(s, { running: false, direction: 0, frequency: 0, reference: 0, rampFrequency: 0, voltage: 0, current: 0, torque: 0, outputMode: 'off', currentLimited: false, referenceReached: false, piActive: false, armed: this.commandReady });
        this.referenceDemand = this.reference(0, 0);
        Object.assign(s, this.monitors());
        this.outputs();
        s.status = this.config.inputs.powered ? (s.fault || 'rdY') : '';
        return this.state;
    }
    setInputs(inputs: Partial<Inputs>): void {
        Object.assign(this.config.inputs, inputs);
        if (inputs.outputConnections) this.config.inputs.outputConnections = { ...inputs.outputConnections };
    }
    reset(): void {
        this.accumulator = 0;
        this.previousInputs = copyInputs(this.config.inputs);
        this.runtimeState = stoppedState(this.config);
        this.commandReady = !this.runSignalsPresent();
        this.directionLatch = 0;
        this.trnDirection = 0;
        this.piIntegral = 0;
        this.frequencyVelocity = 0;
        this.electricalPhase = 0;
        this.dcTime = Infinity;
        this.wasRunning = false;
        this.previousPower = !!this.config.inputs.powered;
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
        this.lastActiveDirection = 1;
        this.referenceDemand = this.reference(0, 0);
        Object.assign(this.runtimeState, this.monitors());
    }
    private runSignalsPresent(): boolean { const rr = this.p('FUn.rrS'); return this.input(this.p('FUn.tCC.ACt') === '3C' ? 'LI2' : 'LI1') || this.input(rr); }
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
        const i = this.config.inputs, pct = clamp(i.analogPosition, 0, 100) / 100;
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
            s.piReference = pr2 && pr4 ? this.p('FUn.PI.PI3') : pr4 ? this.p('FUn.PI.PI4') : pr2 ? this.p('FUn.PI.PI2') : this.p('FUn.PI.rPI');
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
        this.runtimeState.outputMode = 'off';
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
        const s = this.runtimeState, i = this.config.inputs, bus = i.supplyV * Math.SQRT2;
        if (code === 'OLF')
            return s.motorThermal < 100;
        if (code === 'OHF')
            return s.driveThermal < 80;
        if (code === 'OSF')
            return bus <= 415;
        if (code === 'ObF')
            return s.dcBus <= 415;
        if (code === 'USF')
            return !!i.powered && bus >= 230;
        if (code === 'SCF')
            return !i.shortCircuit;
        if (code === 'OLC')
            return !i.shaftHeld && Math.abs(this.config.mechanical.torque) + this.config.mechanical.friction * Math.abs(s.omega) <= this.motorTorqueAtCurrent(DRIVE_CURRENT * this.p('FUn.LOC') / 100);
        if (code === 'ULF')
            return this.connectedOutputCount() >= 2 && this.estimatedLoadCurrent() >= DRIVE_CURRENT * this.p('FUn.LUL') / 100;
        if (code === 'SOF')
            return Math.abs(s.rpm) < this.config.motor.speedRPM * 1.2;
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
    private nominalTorque(): number { return 1000 * this.config.motor.powerKW / Math.max(this.config.motor.speedRPM * Math.PI / 30, 0.01); }
    private motorTorqueAtCurrent(current: number): number { const ir = this.config.motor.current; return this.nominalTorque() * Math.sqrt(Math.max(0, current * current - (0.35 * ir) ** 2)) / (0.93675 * ir); }
    private estimatedLoadCurrent(): number { const m = this.config.motor, load = Math.abs(this.config.mechanical.torque) + this.config.mechanical.friction * m.speedRPM * Math.PI / 30; return Math.hypot(0.35 * m.current, 0.93675 * m.current * load / this.nominalTorque()); }
    private connectedOutputCount(): number {
        const wires = this.config.inputs.outputConnections;
        return Number(wires.U) + Number(wires.V) + Number(wires.W);
    }
    private automaticReset(dt: number): void {
        const s = this.runtimeState;
        if (!s.fault || !this.config.inputs.powered)
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
        const n = Math.floor((this.accumulator + 1e-10) / FIXED_STEP);
        this.accumulator -= n * FIXED_STEP;
        if (this.accumulator < 0)
            this.accumulator = 0;
        for (let k = 0; k < n; k++)
            this.tick(FIXED_STEP);
        return this.state;
    }
    step(dt: number): Readonly<DriveState> { return this.advance(dt); }
    private tick(dt: number): void {
        const s = this.runtimeState, i = this.config.inputs, m = this.config.motor, l = this.config.mechanical;
        // The external clamp absorbs the rotor's initial kinetic energy. That
        // impulse is mechanical work at the clamp, not regenerated bus energy.
        if (i.shaftHeld) s.omega = 0;
        const connectedOutputs = this.connectedOutputCount();
        const wasPowered = this.previousPower, power = !!i.powered;
        s.time += dt;
        if (!power) {
            this.powerOffTime += dt;
            if (wasPowered) {
                this.controlledPowerStop = this.p('FUn.StP') !== 'nO' && s.running;
                this.directionLatch = 0;
                this.trnDirection = 0;
            }
            if (this.powerOffTime > 0.4) {
                s.motorThermal = 0;
                this.commandReady = false;
            }
        }
        else if (!wasPowered) {
            const cycled = this.powerOffTime > 0.4;
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
        if (direction)
            this.lastActiveDirection = direction;
        let enable = power && !s.fault && !nst;
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
        }
        else {
            s.rampFrequency = 0;
            this.frequencyVelocity = 0;
            s.frequency = 0;
        }
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
        const inferredTorque = Math.abs(s.torque) / ratedTorque * m.current / Math.max(0.05, this.p('drC.nCr')) * m.cosPhi / this.p('drC.COS');
        let slipComp = controlVector ? this.p('drC.nSL') * this.p('drC.SLP') / 100 * inferredTorque * Math.sign(s.rampFrequency) : 0;
        slipComp = clamp(slipComp, -15, 15);
        const commandedFrequency = s.rampFrequency + slipComp;
        if (enable && s.running) {
            const gain = this.p('drC.FLG'), stability = this.p('drC.StA');
            const wn = controlVector ? 3 + gain * 0.28 : 20;
            const damping = controlVector ? 0.35 + stability * 0.0425 : 1;
            this.frequencyVelocity += (wn * wn * (commandedFrequency - s.frequency) - 2 * damping * wn * this.frequencyVelocity) * dt;
            this.frequencyVelocity = clamp(this.frequencyVelocity, -1000, 1000);
            s.frequency = clamp(s.frequency + this.frequencyVelocity * dt, -220, 220);
        }
        else {
            s.frequency = 0;
            this.frequencyVelocity = 0;
        }
        this.electricalPhase = (this.electricalPhase + 2 * Math.PI * s.frequency * dt) % (2 * Math.PI);
        let voltage = 0, flux = 0, te = 0, requestCurrent = 0, lag = s.currentLag;
        if (enable && s.running) {
            const f = Math.abs(s.frequency);
            const boost = this.p('drC.UFr') / 50 * 6 * Math.exp(-f / 8);
            voltage = Math.min(i.supplyV, this.p('drC.UnS') * Math.min(f / frs, 1) + boost);
            flux = clamp(voltage / Math.max(f, 2) / (m.voltage / m.frequency), 0, 1.6);
        }
        if (enable && s.running && connectedOutputs >= 2) {
            const slip = s.frequency - rotorHz, breakdown = actualSlip * 4;
            const curve = (slip / actualSlip) / (1 + (slip / breakdown) ** 2) * (1 + 1 / 16);
            te = ratedTorque * curve * flux * flux;
            let mag = 0.35 * m.current * flux;
            requestCurrent = Math.hypot(mag, 0.93675 * m.current * te / (ratedTorque * Math.max(flux, 0.05)));
            const lockedCurrent = 6 * m.current * flux * Math.min(Math.abs(s.frequency) / m.frequency, 1);
            if (connectedOutputs === 2) {
                /* Original single-phase teaching approximation. Two equal
                   counter-rotating fields cancel exactly at rest. A spinning
                   rotor has reduced mean torque and twice-frequency ripple.
                   Coefficients 0.55, 1.4, 6 and 0.18 are model choices, not
                   Schneider protection settings or measured motor constants. */
                const backwardSlip = -s.frequency - rotorHz;
                const backwardCurve = (backwardSlip / actualSlip) / (1 + (backwardSlip / breakdown) ** 2) * (1 + 1 / 16);
                const forwardTorque = te / 2;
                const backwardTorque = ratedTorque * backwardCurve * flux * flux / 2;
                const moving = clamp(Math.abs(rotorHz) / Math.max(Math.abs(s.frequency), 1), 0, 1);
                const ripple = 0.18 * ratedTorque * flux * flux * moving * Math.sin(2 * this.electricalPhase);
                te = forwardTorque + backwardTorque + ripple;
                mag = 0.55 * m.current * flux;
                const fieldCurrent = 1.4 * 0.93675 * m.current * Math.hypot(forwardTorque, backwardTorque) / (ratedTorque * Math.max(flux, 0.05));
                requestCurrent = Math.hypot(mag, fieldCurrent, lockedCurrent * (1 - moving));
            }
            const blockedByLoad = Math.abs(s.omega) < 0.01 && l.torque > 0 && Math.abs(te) <= l.torque;
            if (i.shaftHeld || blockedByLoad) requestCurrent = Math.max(requestCurrent, lockedCurrent);
            const available = ratedTorque * Math.sqrt(Math.max(0, aggregateLimit * aggregateLimit - mag * mag)) / (0.93675 * m.current) * flux;
            s.currentLimited = requestCurrent > aggregateLimit + 0.015;
            if (connectedOutputs === 2 && requestCurrent > aggregateLimit)
                te *= aggregateLimit / requestCurrent;
            te = clamp(te, -available, available);
            requestCurrent = Math.min(requestCurrent, connectedOutputs === 2 ? aggregateLimit : Math.max(driveLimit, mag));
            /* Ramp adaptation spends only a small braking power in motor and drive losses. */
            if (te * s.omega < 0 && te * s.frequency < 0 && this.p('FUn.brA') === 'YES' && !i.brakeModule) {
                const allowedTorque = 35 / Math.max(Math.abs(s.omega), 5);
                te = clamp(te, -allowedTorque, allowedTorque);
                const minFollowing = rotorHz - Math.sign(s.omega) * allowedTorque / ratedTorque * actualSlip;
                if (s.omega > 0)
                    s.rampFrequency = Math.max(s.rampFrequency, minFollowing);
                else
                    s.rampFrequency = Math.min(s.rampFrequency, minFollowing);
                if (connectedOutputs === 3 && !i.shaftHeld)
                    requestCurrent = Math.hypot(mag, 0.93675 * m.current * te / (ratedTorque * Math.max(flux, 0.05)));
            }
            /* Displacement of the fundamental current: the torque-producing part is in
               phase with the voltage and the magnetizing part lags it by 90 degrees.
               Teaching approximation from the same split used for the magnitude. */
            // times synchronous rotation direction, including reverse motoring.
            const sequence = Math.sign(s.frequency) || this.lastActiveDirection;
            const active = clamp(0.93675 * m.current * te * sequence / (ratedTorque * Math.max(flux, 0.05)), -requestCurrent, requestCurrent);
            if (requestCurrent > 0) lag = Math.atan2(Math.sqrt(Math.max(0, requestCurrent * requestCurrent - active * active)), active);
            if (mag > aggregateLimit * 1.15)
                this.overcurrentTime += dt;
            else
                this.overcurrentTime = 0;
            if (this.overcurrentTime > 0.08) {
                this.trip('OCF');
                te = 0;
                voltage = 0;
                requestCurrent = 0;
            }
        }
        else if (dc && connectedOutputs >= 2) {
            // SdC is the injected conductor current. This teaching topology uses
            // the first connected leg and equal returns through the others.
            // LCr and heating use the RMS magnitude across all three conductors.
            const injectionCurrent = Math.min(this.p('FUn.AdC.SdC'), driveLimit);
            requestCurrent = injectionCurrent * (connectedOutputs === 3 ? Math.SQRT1_2 : Math.sqrt(2 / 3));
            voltage = Math.min(i.supplyV, injectionCurrent / m.current * 20);
            te = -Math.sign(s.omega) * ratedTorque * (injectionCurrent / m.current) ** 2 * clamp(Math.abs(s.omega) / 5, 0, 1);
            if (connectedOutputs === 2) te *= 0.5;
            s.currentLimited = false;
        }
        else {
            s.currentLimited = false;
        }
        const rotatingSign = Math.abs(s.omega) > 0.01 ? Math.sign(s.omega) : Math.sign(te) || this.lastActiveDirection;
        const load = l.torque * rotatingSign;
        let net = te - load - l.friction * s.omega;
        if (Math.abs(s.omega) < 0.01 && l.torque >= 0 && Math.abs(te) <= l.torque)
            net = 0;
        const inertia = Math.max(0.0001, m.inertia + l.inertia);
        const oldOmega = s.omega;
        /* Local implicit damping keeps small allowed rotor inertias stable at a 5 ms step. */
        const electricalSlope = s.running && connectedOutputs >= 2 ? ratedTorque / actualSlip * m.poles / (4 * Math.PI) * flux * flux : 0;
        s.omega = i.shaftHeld ? 0 : clamp(s.omega + net * dt / (inertia + dt * (l.friction + electricalSlope)), -4000, 4000);
        // A passive resisting load can stop the shaft, but cannot drive a
        // reversal. An opposing motor torque above the load can reverse it.
        if (oldOmega * s.omega < 0 && l.torque >= 0 && (!s.running || Math.abs(te) <= l.torque))
            s.omega = 0;
        s.rpm = s.omega * 30 / Math.PI;
        s.angle = (s.angle + s.omega * dt) % (2 * Math.PI);
        s.torque = te;
        s.voltage = voltage;
        s.currentLag = lag;
        s.outputMode = enable && s.running ? 'ac' : dc ? 'dc' : 'off';
        s.current += (requestCurrent - s.current) * (1 - Math.exp(-dt / 0.03));
        if (connectedOutputs === 2) s.current = Math.min(s.current, aggregateLimit);
        if (!enable || connectedOutputs < 2)
            s.current = 0;
        const sf = this.p('FUn.SFt.ACt'), configured = this.p('FUn.SFt.SFr');
        s.switchingFrequency = sf === 'HF' && s.driveThermal > 90 ? 4 : configured === 2 && Math.abs(s.frequency) > 100 ? 4 : configured;
        if (sf === 'LFr')
            s.switchingFrequency *= 1 + 0.12 * Math.sin(s.time * 37) + 0.05 * Math.sin(s.time * 83);
        const switchingHeating = 1 + 0.025 * (s.switchingFrequency - 4);
        const ratio = s.current / Math.max(0.01, this.p('ItH'));
        s.motorThermal += (Math.min(10000, 100 * ratio * ratio) - s.motorThermal) * (1 - Math.exp(-dt / 45));
        s.actualMotorThermal += (100 * (s.current / m.current) ** 2 - s.actualMotorThermal) * (1 - Math.exp(-dt / 45));
        const ambient = Math.max(0, (i.ambient - 25) * 1.5), cooling = 0.15 + 0.85 * i.ventilation;
        const driveTarget = power ? ambient + 100 * (s.current / DRIVE_CURRENT) ** 2 * switchingHeating / cooling : 0;
        s.driveThermal += (driveTarget - s.driveThermal) * (1 - Math.exp(-dt / 60));
        // A stationary DC field dissipates braking energy in the motor, not the
        // DC link. AC regeneration requires negative synchronous-field power;
        // opposite rotor/field directions instead describe plugging.
        s.regenerativePower = s.outputMode === 'ac' && te * s.frequency < 0 ? Math.max(0, -te * s.omega) : 0;
        const base = power ? i.supplyV * Math.SQRT2 : 0;
        if (power) {
            if (s.dcBus < base)
                s.dcBus += (base - s.dcBus) * (1 - Math.exp(-dt / 0.025));
            const regen = Math.max(0, s.regenerativePower - 35);
            const dissipation = i.brakeModule ? clamp((s.dcBus - 350) * 20, 0, 1800) : Math.max(0, (s.dcBus - base) * 1.2);
            const v2 = s.dcBus * s.dcBus + 2 * (regen - dissipation) * dt / 0.0006;
            s.dcBus = Math.max(base, Math.sqrt(Math.max(0, v2)));
        }
        else if (this.controlledPowerStop && enable) {
            const electricalLoss = 20 + 12 * s.current * s.current;
            s.dcBus = Math.sqrt(Math.max(0, s.dcBus * s.dcBus + 2 * (s.regenerativePower - electricalLoss) * dt / 0.0006));
            if (!s.running)
                this.controlledPowerStop = false;
        }
        else
            s.dcBus *= Math.exp(-dt / 0.15);
        if (s.dcBus > 415 && s.regenerativePower > 35) {
            this.brakingOvervoltageTime += dt;
            if (this.brakingOvervoltageTime > 0.01)
                this.trip('ObF');
        }
        else
            this.brakingOvervoltageTime = 0;
        if (s.motorThermal > 118)
            this.trip('OLF');
        if (s.driveThermal > 118)
            this.trip('OHF');
        const reachedBand = s.piActive ? this.p('FUn.AP1') : 0.1;
        const difference = Math.abs(s.frequency - (s.reference + slipComp));
        if (!s.running)
            s.referenceReached = false;
        else if (difference <= Math.max(0, reachedBand - (s.piActive ? 0.2 : 0)))
            s.referenceReached = true;
        else if (difference > reachedBand)
            s.referenceReached = false;
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
        if (!this.config.inputs.powered)
            out = 0;
        s.DO = out;
        s.DOvoltage = 15 * out;
    }
    monitors(): Readonly<MonitorReadings> {
        const s = this.runtimeState;
        // FrH is the selected demand, also visible while stopped (tech p.119).
        // s.reference is the signed run/stop target consumed by the ramps.
        return { FrH: this.referenceDemand, rFr: Math.abs(s.frequency), LCr: s.current, ULn: this.config.inputs.powered ? this.config.inputs.supplyV : 0, tHr: s.motorThermal, tHd: s.driveThermal, rPF: s.piFeedback };
    }
    private physicalReadings(): PhysicalReadings {
        const s = this.runtimeState, i = this.config.inputs, l = this.config.mechanical;
        const count = this.connectedOutputCount();
        // LCr is the RMS over three phase currents. Two remaining equal line
        // currents are sqrt(3/2) times LCr; the open conductor carries zero.
        const phaseCurrent = count === 3 ? s.current : count === 2 ? Math.sqrt(3 / 2) * s.current : 0;
        const dcThree = s.outputMode === 'dc' && count === 3;
        const U = i.outputConnections.U ? dcThree ? Math.SQRT2 * s.current : phaseCurrent : 0;
        const V = i.outputConnections.V ? dcThree ? Math.SQRT1_2 * s.current : phaseCurrent : 0;
        const W = i.outputConnections.W ? dcThree ? Math.SQRT1_2 * s.current : phaseCurrent : 0;
        const average = (U + V + W) / 3;
        const currentImbalance = average > 0 ? 100 * Math.max(Math.abs(U - average), Math.abs(V - average), Math.abs(W - average)) / average : 0;
        const sign = Math.abs(s.omega) > 0.01 ? Math.sign(s.omega) : Math.sign(s.torque) || this.lastActiveDirection;
        return {
            phaseCurrentU: U,
            phaseCurrentV: V,
            phaseCurrentW: W,
            currentImbalance,
            shaftReactionTorque: i.shaftHeld ? l.torque * sign + l.friction * s.omega - s.torque : 0
        };
    }
    snapshot(): Readonly<DriveState> { return { ...this.runtimeState, ...this.physicalReadings() }; }
}
// A newly loaded setup starts with zero motion and accumulated heat. These are
// physical initial conditions, not replacements for absent configuration fields.
function stoppedState(config: EngineConfiguration): RuntimeDriveState {
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
        outputMode: 'off',
        regenerativePower: 0,
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
