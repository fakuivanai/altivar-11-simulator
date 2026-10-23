import type { ParameterValues } from './parameter-types';
export type { CodeValue, ParameterId, ParameterValues } from './parameter-types';
export const PHASES = ['U', 'V', 'W'] as const;
export type Phase = typeof PHASES[number];
export const LOGIC_INPUTS = ['LI1', 'LI2', 'LI3', 'LI4'] as const;
export type LogicInputId = typeof LOGIC_INPUTS[number];
export type LogicInputAssignment = LogicInputId | 'nO';
export type AnalogSource = '5V' | '10V' | '20mA';
export type Direction = -1 | 0 | 1;
export type RunningDirection = -1 | 1;
export type FaultCode = 'OHF' | 'OLF' | 'OLC' | 'ULF' | 'ObF' | 'OSF' | 'PHF' | 'OCF' | 'SCF' | 'InF' | 'CrF' | 'CFF' | 'USF' | 'SOF';
export type DriveStatus = '' | 'rdY' | 'nSt' | 'dcb' | 'run' | FaultCode;
export interface MotorSpecification {
    powerKW: number;
    voltage: number;
    frequency: number;
    current: number;
    speedRPM: number;
    poles: number;
    cosPhi: number;
    inertia: number;
}
export interface MechanicalLoad {
    torque: number;
    friction: number;
    inertia: number;
}
export interface OutputConnections {
    U: boolean;
    V: boolean;
    W: boolean;
}
export interface Inputs {
    powered: boolean;
    supplyV: number;
    LI1: boolean;
    LI2: boolean;
    LI3: boolean;
    LI4: boolean;
    analogType: AnalogSource;
    analogPosition: number;
    outputConnections: OutputConnections;
    shaftHeld: boolean;
    shortCircuit: boolean;
    brakeModule: boolean;
    ambient: number;
    ventilation: number;
}
export interface EngineConfiguration {
    parameters: ParameterValues;
    motor: MotorSpecification;
    mechanical: MechanicalLoad;
    inputs: Inputs;
}
export interface MonitorReadings {
    FrH: number;
    rFr: number;
    LCr: number;
    ULn: number;
    tHr: number;
    tHd: number;
    rPF: number;
}
export interface PhysicalReadings {
    phaseCurrentU: number;
    phaseCurrentV: number;
    phaseCurrentW: number;
    currentImbalance: number;
    shaftReactionTorque: number;
}
export interface DriveState extends MonitorReadings, PhysicalReadings {
    time: number;
    omega: number;
    rpm: number;
    angle: number;
    frequency: number;
    reference: number;
    rampFrequency: number;
    voltage: number;
    current: number;
    torque: number;
    dcBus: number;
    motorThermal: number;
    actualMotorThermal: number;
    driveThermal: number;
    fault: FaultCode | null;
    status: DriveStatus;
    relay: boolean;
    DO: number;
    DOType: 'analog' | 'logic';
    DOvoltage: number;
    running: boolean;
    direction: Direction;
    currentLimited: boolean;
    referenceReached: boolean;
    piFeedback: number;
    piReference: number;
    piError: number;
    piActive: boolean;
    activeHighSpeed: number;
    activeCurrentLimit: number;
    switchingFrequency: number;
    /** How far the fundamental current lags the voltage, rad: 0 pure active, pi/2 magnetizing only, over pi/2 regenerating. */
    currentLag: number;
    /** off: no output; ac: modulated output; dc: DC injection at standstill. */
    outputMode: 'off' | 'ac' | 'dc';
    regenerativePower: number;
    armed: boolean;
    HSU: number;
}
export type EngineConfigUpdate = {
    reset?: false;
    resetControl?: false;
} | {
    reset: true;
    resetControl?: never;
} | {
    reset?: false;
    resetControl: true;
};
export interface AnalogReading {
    normalized: number;
    voltage: number;
    current: number;
}
