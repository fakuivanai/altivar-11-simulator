/** Reduced single-phase diode bridge and DC-link energy model.
 * Circuit/energy provenance: TI TIDUF73, section 2.2.1 (passive RC precharge),
 * https://www.ti.com/lit/ug/tiduf73/tiduf73.pdf ; ABB Technical guide No. 8,
 * https://library.e.abb.com/public/20be376000f34dd6b9c513580cf56423/Technical_guide_No_8_3AFE64362534_RevC.pdf
 * (diode front end, capacitor energy and resistor braking). Equations below are
 * an original lumped simulation, not identified ATV11 components or firmware.
 */
export interface DCLinkComponents {
    capacitance: number;
    lineFrequency: number;
    sourceResistance: number;
    prechargeResistance: number;
    prechargeSeconds: number;
    prechargeFraction: number;
    bleedResistance: number | null;
    brakeResistance: number;
    brakeOnVoltage: number;
    brakeOffVoltage: number;
}
export const DC_LINK_DEFAULTS: Readonly<DCLinkComponents> = Object.freeze({
    // 600 uF is an inferred teaching value retained from the earlier model.
    capacitance: 0.0006,
    lineFrequency: 50,
    // Finite wiring/bridge resistance and a timed precharge bypass are model
    // assumptions. Ideal diodes omit their small forward drop and reverse loss.
    sourceResistance: 2,
    prechargeResistance: 47,
    prechargeSeconds: 0.15,
    prechargeFraction: 0.9,
    bleedResistance: 22000,
    // Optional external chopper/resistor assumptions, not ATV11 ratings.
    brakeResistance: 68,
    brakeOnVoltage: 360,
    brakeOffVoltage: 350,
});
export type DCLinkOptions = Partial<DCLinkComponents>;
export interface DCLinkInput {
    powered: boolean;
    /** Single-phase line voltage, V rms. */
    supplyV: number;
    /** Signed DC demand in W: positive motoring/losses, negative regeneration. */
    electricalPower: number;
    brakeModule: boolean;
}
export interface DCLinkStep {
    voltage: number;
    energy: number;
    /** True while the precharge bypass is open, including while unpowered. */
    precharging: boolean;
    /** Energy delivered to the capacitor by the rectifier, after series loss. */
    rectifierEnergy: number;
    sourceLossEnergy: number;
    loadEnergy: number;
    regeneratedEnergy: number;
    brakeEnergy: number;
    bleedEnergy: number;
    /** Demand that an empty capacitor could not supply, not fabricated energy. */
    unservedEnergy: number;
}
// 100 us resolves a 10 ms rectified-line period, independently of engine ticks.
const MAX_STEP = 0.0001;
const TAU = 2 * Math.PI;

export class DCLink {
    private readonly options: Readonly<DCLinkComponents>;
    private storedEnergy = 0;
    private phase = 0;
    private poweredTime = 0;
    private bypassed = false;
    private braking = false;

    constructor(initialVoltage = 0, options: DCLinkOptions = {}) {
        this.options = Object.freeze({ ...DC_LINK_DEFAULTS, ...options });
        for (const [name, value] of Object.entries(this.options)) {
            if (name === 'bleedResistance' && value === null) continue;
            if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
                throw new RangeError(`Invalid DC-link option: ${name}`);
        }
        const components = this.options;
        if (components.capacitance === 0 || components.lineFrequency === 0 || components.sourceResistance === 0 ||
            components.bleedResistance === 0 || components.brakeResistance === 0 || components.brakeOffVoltage === 0 ||
            components.brakeOnVoltage <= components.brakeOffVoltage || components.prechargeFraction > 1)
            throw new RangeError('Invalid DC-link component values');
        this.reset(initialVoltage);
    }

    get voltage(): number { return Math.sqrt(2 * this.storedEnergy / this.options.capacitance); }
    get energy(): number { return this.storedEnergy; }
    get precharging(): boolean { return !this.bypassed; }

    reset(initialVoltage = 0): void {
        const energy = 0.5 * this.options.capacitance * initialVoltage * initialVoltage;
        if (!Number.isFinite(initialVoltage) || initialVoltage < 0 || !Number.isFinite(energy))
            throw new RangeError('Invalid initial DC-link voltage');
        this.storedEnergy = energy;
        this.phase = 0;
        this.poweredTime = 0;
        this.bypassed = false;
        this.braking = false;
    }

    step(dt: number, input: Readonly<DCLinkInput>): DCLinkStep {
        if (!Number.isFinite(dt) || dt < 0 || dt > 600 ||
            !Number.isFinite(input.supplyV) || input.supplyV < 0 ||
            !Number.isFinite(input.electricalPower))
            throw new RangeError('Invalid DC-link step');
        const result: DCLinkStep = {
            voltage: this.voltage, energy: this.energy, precharging: this.precharging,
            rectifierEnergy: 0, sourceLossEnergy: 0, loadEnergy: 0,
            regeneratedEnergy: 0, brakeEnergy: 0, bleedEnergy: 0, unservedEnergy: 0,
        };
        if (dt === 0) return result;
        const components = this.options;
        if (!input.powered) {
            this.poweredTime = 0;
            this.bypassed = false;
        }
        const count = Math.ceil(dt / MAX_STEP);
        const stepSeconds = dt / count;
        const peak = Math.SQRT2 * input.supplyV;
        for (let step = 0; step < count; step++) {
            // Symmetric energy demand around RC charging avoids a voltage/power
            // singularity at an empty bus. Report any unsupplied demand.
            this.exchangePower(input.electricalPower, stepSeconds / 2, result);
            if (input.powered) {
                this.poweredTime += stepSeconds;
                if (this.poweredTime >= components.prechargeSeconds && peak > 0 &&
                    this.voltage >= components.prechargeFraction * peak)
                    this.bypassed = true;
                const sourceV = peak * Math.abs(Math.sin(this.phase + Math.PI * components.lineFrequency * stepSeconds));
                const beforeV = this.voltage;
                if (sourceV > beforeV) {
                    const resistance = components.sourceResistance + (this.bypassed ? 0 : components.prechargeResistance);
                    // Exact RC charge for the midpoint-held rectified source.
                    const afterV = beforeV + (sourceV - beforeV) * -Math.expm1(-stepSeconds / (resistance * components.capacitance));
                    const afterEnergy = 0.5 * components.capacitance * afterV * afterV;
                    const added = afterEnergy - this.storedEnergy;
                    const sourceEnergy = sourceV * components.capacitance * (afterV - beforeV);
                    this.storedEnergy = afterEnergy;
                    result.rectifierEnergy += added;
                    result.sourceLossEnergy += Math.max(0, sourceEnergy - added);
                }
            }
            this.dissipate(stepSeconds, input.brakeModule, result);
            this.exchangePower(input.electricalPower, stepSeconds / 2, result);
            this.phase = (this.phase + TAU * components.lineFrequency * stepSeconds) % TAU;
        }
        result.voltage = this.voltage;
        result.energy = this.energy;
        result.precharging = this.precharging;
        return result;
    }

    private exchangePower(power: number, dt: number, result: DCLinkStep): void {
        const demand = power * dt;
        if (demand < 0) {
            this.storedEnergy -= demand;
            result.regeneratedEnergy -= demand;
        } else {
            const supplied = Math.min(this.storedEnergy, demand);
            this.storedEnergy -= supplied;
            result.loadEnergy += supplied;
            result.unservedEnergy += demand - supplied;
        }
    }

    private dissipate(dt: number, available: boolean, result: DCLinkStep): void {
        const components = this.options;
        if (!available || this.voltage <= components.brakeOffVoltage) this.braking = false;
        else if (this.voltage >= components.brakeOnVoltage) this.braking = true;
        const bleed = components.bleedResistance === null ? 0 : 1 / components.bleedResistance;
        let remaining = dt;
        if (this.braking) {
            const brake = 1 / components.brakeResistance;
            const conductance = brake + bleed;
            // Stop chopper conduction at its lower hysteresis threshold; the
            // unused part of this substep still dissipates in the bleeder.
            const untilOff = components.capacitance / conductance * Math.log(this.voltage / components.brakeOffVoltage);
            const active = Math.min(dt, untilOff);
            const loss = this.storedEnergy * -Math.expm1(-2 * conductance * active / components.capacitance);
            this.storedEnergy -= loss;
            result.brakeEnergy += loss * brake / conductance;
            result.bleedEnergy += loss * bleed / conductance;
            remaining -= active;
            if (untilOff <= dt) this.braking = false;
        }
        if (bleed > 0 && remaining > 0) {
            const loss = this.storedEnergy * -Math.expm1(-2 * bleed * remaining / components.capacitance);
            this.storedEnergy -= loss;
            result.bleedEnergy += loss;
        }
    }
}
