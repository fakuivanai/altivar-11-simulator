import { invariant } from './invariant';
export { invariant } from './invariant';
// Original configuration model. Parameter facts and page locators come from the
// reviewed Schneider ATV11 E/U V1.2 IE >= 21 catalog, catalog-final.json.
// The extended V1.2 manual supplies PI details. See Fuentes.md for the sources
// and the documented interpretations of unspecified factory values and ranges.
import catalogData from './catalog-final.json';
import type { EngineConfiguration, Inputs, MotorSpecification, MechanicalLoad } from './engine-types';
import { PARAMETER_IDS, MONITORS } from './parameter-types';
import type { ParameterId, ParameterValues, CodeValue, MonitorCode, MonitorId } from './parameter-types';
export { MONITORS, PARAMETER_IDS } from './parameter-types';
export type { ParameterId, ParameterValues, CodeValue, MonitorCode, MonitorId } from './parameter-types';

export const MODEL = 'ATV11HU09M2E' as const;
export const PROFILE = 'V1.2-IE21' as const;
export type InputMode = 'switch' | 'button';
export interface Configuration extends EngineConfiguration {
  schema: 'variador-aula';
  version: 1;
  model: typeof MODEL;
  firmwareProfile: typeof PROFILE;
  inputModes: Record<'LI1' | 'LI2' | 'LI3' | 'LI4', InputMode>;
  driveMemory: {
    backupParameters: ParameterValues;
    backupValid: boolean;
    monitor: MonitorCode;
    firstBoot: boolean;
  };
}
declare const configurationValidated: unique symbol;
declare const parametersValidated: unique symbol;
export type ValidConfiguration = Configuration & { readonly [configurationValidated]: true };
export type ValidParameters = ParameterValues & { readonly [parametersValidated]: true };
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

interface MetadataBase {
  code: string;
  path: string[];
  label: string;
  source: { manual: 'user' | 'technical'; page: number };
  unit?: string;
  note?: string;
  condition?: string;
  aliases?: string[][];
  holdSeconds?: number;
  fixed?: boolean;
  action?: boolean;
  special?: boolean;
  rangeBasis?: string;
}
export interface NumericParameterMetadata extends MetadataBase {
  kind: 'numeric';
  id: ParameterId;
  readonly?: false;
  runEditable: boolean;
  default: number;
  min: number;
  max: number;
  step: number;
  choices?: undefined;
}
export interface ChoiceParameterMetadata extends MetadataBase {
  kind: 'choice';
  id: ParameterId;
  readonly?: false;
  runEditable: boolean;
  default: CodeValue;
  choices: CodeValue[];
  min?: undefined;
  max?: undefined;
  step?: undefined;
}
export interface MonitorMetadata extends MetadataBase {
  kind: 'monitor';
  id: MonitorId;
  readonly: true;
  runEditable?: undefined;
  default?: undefined;
  choices?: undefined;
  min?: undefined;
  max?: undefined;
  step: number;
}
export type CatalogItem = NumericParameterMetadata | ChoiceParameterMetadata | MonitorMetadata;
export type ParameterMetadata = NumericParameterMetadata | ChoiceParameterMetadata;


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const parameterIds: ReadonlySet<string> = new Set(PARAMETER_IDS);
const monitorCodes: ReadonlySet<string> = new Set(MONITORS);
export function isParameterId(value: string): value is ParameterId { return parameterIds.has(value); }
export function isMonitorCode(value: unknown): value is MonitorCode {
  return typeof value === 'string' && monitorCodes.has(value);
}
function isMonitorId(value: string): value is MonitorId {
  return value.startsWith('SUP.') && isMonitorCode(value.slice(4));
}
function isCodeValue(value: unknown): value is CodeValue {
  return typeof value === 'string' || typeof value === 'number' && Number.isFinite(value);
}
function catalogString(value: unknown, name: string): string {
  invariant(typeof value === 'string', name + ' debe contener texto.');
  return value;
}
function catalogNumber(value: unknown, name: string): number {
  invariant(typeof value === 'number' && Number.isFinite(value), name + ' debe contener un número finito.');
  return value;
}
function catalogStrings(value: unknown, name: string): string[] {
  invariant(Array.isArray(value) && value.every((item: unknown) => typeof item === 'string'), name + ' debe contener una lista de texto.');
  return value as string[];
}
function readCatalog(source: unknown): CatalogItem[] {
  invariant(Array.isArray(source), 'El catálogo debe ser una lista.');
  const items: CatalogItem[] = source.map((entry: unknown): CatalogItem => {
    invariant(isRecord(entry), 'La entrada del catálogo debe ser un objeto.');
    invariant(isRecord(entry.source), 'La referencia del catálogo debe ser un objeto.');
    const manual = entry.source.manual;
    invariant(manual === 'user' || manual === 'technical', 'El catálogo tiene una fuente desconocida.');
    const page = catalogNumber(entry.source.page, 'Página');
    invariant(Number.isInteger(page) && page > 0, 'La página de referencia debe ser positiva.');
    const base: MetadataBase = {
      code: catalogString(entry.code, 'Código'),
      path: catalogStrings(entry.path, 'Ruta'),
      label: catalogString(entry.label, 'Nombre'),
      source: { manual, page },
    };
    for (const key of ['unit', 'note', 'condition', 'rangeBasis'] as const) {
      if (entry[key] !== undefined) base[key] = catalogString(entry[key], key);
    }
    for (const key of ['fixed', 'action', 'special'] as const) {
      if (entry[key] !== undefined) {
        invariant(typeof entry[key] === 'boolean', key + ' debe ser lógico.');
        base[key] = entry[key];
      }
    }
    if (entry.holdSeconds !== undefined) base.holdSeconds = catalogNumber(entry.holdSeconds, 'Tiempo ENT');
    if (entry.aliases !== undefined) {
      invariant(Array.isArray(entry.aliases), 'Los accesos alternativos deben ser una lista.');
      base.aliases = entry.aliases.map((route: unknown) => catalogStrings(route, 'Acceso alternativo'));
    }
    const id = catalogString(entry.id, 'Identificador');
    if (entry.readonly === true) {
      invariant(isMonitorId(id), 'Monitor desconocido: ' + id);
      return { ...base, kind: 'monitor', id, readonly: true, step: catalogNumber(entry.step, 'Paso de monitor') };
    }
    invariant(isParameterId(id), 'Parámetro desconocido: ' + id);
    invariant(typeof entry.runEditable === 'boolean', 'Falta la restricción de marcha: ' + id);
    if (entry.choices !== undefined) {
      invariant(Array.isArray(entry.choices) && entry.choices.every(isCodeValue), 'Opciones inválidas: ' + id);
      invariant(isCodeValue(entry.default), 'Valor inicial inválido: ' + id);
      invariant(entry.choices.includes(entry.default), 'El valor inicial no está en las opciones: ' + id);
      return { ...base, kind: 'choice', id, runEditable: entry.runEditable, default: entry.default, choices: entry.choices as CodeValue[] };
    }
    const min = catalogNumber(entry.min, 'Mínimo');
    const max = catalogNumber(entry.max, 'Máximo');
    const step = catalogNumber(entry.step, 'Paso');
    const initial = catalogNumber(entry.default, 'Valor inicial');
    invariant(min <= initial && initial <= max && step > 0, 'Intervalo inválido: ' + id);
    return { ...base, kind: 'numeric', id, runEditable: entry.runEditable, default: initial, min, max, step };
  });
  const ids = items.map(item => item.id);
  invariant(new Set(ids).size === ids.length, 'Hay identificadores duplicados en el catálogo.');
  invariant(items.filter(item => item.kind !== 'monitor').length === PARAMETER_IDS.length, 'El catálogo no contiene los 74 parámetros.');
  invariant(items.filter(item => item.kind === 'monitor').length === MONITORS.length, 'El catálogo no contiene los 8 monitores.');
  return items;
}
export const CATALOG: CatalogItem[] = readCatalog(catalogData);
export const paramById: Readonly<Record<string, CatalogItem | undefined>> = Object.fromEntries(CATALOG.map(item => [item.id, item]));
const editableCatalog = CATALOG.filter((item): item is ParameterMetadata => item.kind !== 'monitor');

export function clone<T>(value: T): T { return structuredClone(value); }
function failure<T>(error: string): ValidationResult<T> { return { ok: false, error }; }
function exactKeys(value: unknown, keys: readonly string[], name: string): ValidationResult<Record<string, unknown>> {
  if (!isRecord(value)) return failure(name + ': se esperaba un objeto.');
  const actual = Object.keys(value).sort();
  if (actual.join('\n') !== [...keys].sort().join('\n')) return failure(name + ': campos incompletos o desconocidos.');
  return { ok: true, value };
}
function numberIssue(value: unknown, min: number, max: number, name: string, step?: number): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return name + ': valor fuera de rango.';
  if (step && value !== min && value !== max && Math.abs(value / step - Math.round(value / step)) > 1e-6) return name + ': resolución incorrecta.';
  return undefined;
}
function booleanIssue(value: unknown, name: string): string | undefined {
  return typeof value === 'boolean' ? undefined : name + ': se esperaba verdadero o falso.';
}
export function validateParameters(value: unknown): ValidationResult<ValidParameters> {
  const keys = exactKeys(value, PARAMETER_IDS, 'Parámetros');
  if (!keys.ok) return keys;
  const input = keys.value;
  for (const metadata of editableCatalog) {
    const candidate = input[metadata.id];
    if (metadata.kind === 'choice') {
      if (!isCodeValue(candidate) || !metadata.choices.includes(candidate)) return failure(metadata.id + ': opción inválida.');
    } else {
      const issue = numberIssue(candidate, metadata.min, metadata.max, metadata.id, metadata.step);
      if (issue) return failure(issue);
    }
  }
  // The catalog is checked against the generated exact identities at startup.
  // Only this constructor may attach the validated brand after every field has
  // passed its type/range test and before the dependent constraints below.
  const p = input as unknown as ParameterValues;
  if (p.LSP > p.HSP) return failure('LSP debe ser menor o igual que HSP.');
  for (const id of ['SP2', 'SP3', 'SP4'] as const) if (p[id] > p.HSP) return failure(id + ' supera HSP.');
  for (const id of ['FUn.HSP.HS2', 'FUn.HSP.HS3', 'FUn.HSP.HS4'] as const) if (p[id] < p.LSP) return failure(id.split('.').at(-1) + ' es menor que LSP.');
  if (p['AIt.CrL'] >= p['AIt.CrH']) return failure('CrL debe ser menor que CrH.');
  for (const group of ['PS2', 'HSP'] as const) {
    if (p[`FUn.${group}.LIA`] === 'nO' && p[`FUn.${group}.LIb`] !== 'nO') return failure(group + ': asigne LIA antes de LIb.');
  }
  if (p['FUn.PI.Pr2'] === 'nO' && p['FUn.PI.Pr4'] !== 'nO') return failure('PI: asigne Pr2 antes de Pr4.');
  if (p['FUn.PI.PIF'] === 'AI1' && (p['FUn.rrS'] !== 'nO' || p['FUn.PS2.LIA'] !== 'LI1')) return failure('PI requiere rrS=nO y PS2/LIA=LI1.');
  const level = p['FUn.tCC.ACt'] === '2C' && p['FUn.tCC.tCt'] !== 'trn';
  if (p['FUn.Atr'] === 'YES' && !level) return failure('Atr requiere mando de 2 hilos con LEL o PFO.');
  if (p['FUn.FLr'] === 'YES' && (!level || p['FUn.AdC.ACt'] === 'Ct')) return failure('FLr requiere LEL o PFO y AdC diferente de Ct.');
  const frequencies: readonly number[] = p['FUn.SFt.ACt'] === 'HF' ? [8, 12, 16] : [2, 4];
  if (!frequencies.includes(p['FUn.SFt.SFr'])) return failure('SFr no corresponde al rango SFt.');
  if (p['FUn.SCS'] !== 'nO' || p['FUn.FCS'] !== 'nO') return failure('SCS y FCS deben estar inactivos en un archivo.');
  if (p['SUP.COd'] === 1) return failure('COd admite OFF o un código de 2 a 999.');
  return { ok: true, value: clone(p) as ValidParameters };
}
const motorRanges = {
  powerKW: [.05, 3], voltage: [100, 500], frequency: [40, 200], current: [.1, 20],
  speedRPM: [50, 12000], poles: [2, 12], cosPhi: [.1, 1], inertia: [.0001, 2],
} as const satisfies Record<keyof MotorSpecification, readonly [number, number]>;
const mechanicalRanges = { torque: [-20, 20], friction: [0, .2], inertia: [0, 2] } as const satisfies Record<keyof MechanicalLoad, readonly [number, number]>;
const inputKeys = {
  powered: true, supplyV: true, LI1: true, LI2: true, LI3: true, LI4: true,
  analogType: true, analogPosition: true, outputConnections: true, shaftHeld: true,
  shortCircuit: true, brakeModule: true, ambient: true, ventilation: true,
} as const satisfies Record<keyof Inputs, true>;
const inputBooleans = ['powered', 'LI1', 'LI2', 'LI3', 'LI4', 'shaftHeld', 'shortCircuit', 'brakeModule'] as const;
const inputRanges = { supplyV: [0, 350], analogPosition: [0, 100], ambient: [0, 60], ventilation: [0, 1] } as const;
const outputPhases = ['U', 'V', 'W'] as const;
const logicInputs = ['LI1', 'LI2', 'LI3', 'LI4'] as const;
export function validateConfig(value: unknown): ValidationResult<ValidConfiguration> {
  const keys = exactKeys(value, ['schema', 'version', 'model', 'firmwareProfile', 'parameters', 'motor', 'mechanical', 'inputs', 'inputModes', 'driveMemory'], 'Archivo');
  if (!keys.ok) return keys;
  const c = keys.value;
  if (c.schema !== 'variador-aula' || c.version !== 1 || c.model !== MODEL || c.firmwareProfile !== PROFILE) return failure('Archivo incompatible con este modelo o versión.');
  const parameters = validateParameters(c.parameters);
  if (!parameters.ok) return parameters;
  const motor = exactKeys(c.motor, Object.keys(motorRanges), 'Motor');
  if (!motor.ok) return motor;
  for (const key of Object.keys(motorRanges) as (keyof MotorSpecification)[]) {
    const issue = numberIssue(motor.value[key], motorRanges[key][0], motorRanges[key][1], 'Motor ' + key);
    if (issue) return failure(issue);
  }
  const actualMotor = motor.value as unknown as MotorSpecification;
  if (actualMotor.poles % 2) return failure('El número de polos debe ser par.');
  if (actualMotor.speedRPM >= 120 * actualMotor.frequency / actualMotor.poles) return failure('La velocidad nominal debe ser menor que la sincrónica.');
  const mechanical = exactKeys(c.mechanical, Object.keys(mechanicalRanges), 'Carga');
  if (!mechanical.ok) return mechanical;
  for (const key of Object.keys(mechanicalRanges) as (keyof MechanicalLoad)[]) {
    const issue = numberIssue(mechanical.value[key], mechanicalRanges[key][0], mechanicalRanges[key][1], key === 'torque' ? 'Par de carga' : key === 'friction' ? 'Fricción' : 'Inercia de carga');
    if (issue) return failure(issue);
  }
  const inputs = exactKeys(c.inputs, Object.keys(inputKeys), 'Entradas');
  if (!inputs.ok) return inputs;
  for (const key of inputBooleans) {
    const issue = booleanIssue(inputs.value[key], key);
    if (issue) return failure(issue);
  }
  const connections = exactKeys(inputs.value.outputConnections, outputPhases, 'Conexiones de salida');
  if (!connections.ok) return connections;
  for (const phase of outputPhases) {
    const issue = booleanIssue(connections.value[phase], 'Conexión ' + phase);
    if (issue) return failure(issue);
  }
  const rangeNames = { supplyV: 'Tensión de red', analogPosition: 'Posición AI1', ambient: 'Temperatura ambiente', ventilation: 'Ventilación' } as const;
  for (const key of Object.keys(inputRanges) as (keyof typeof inputRanges)[]) {
    const issue = numberIssue(inputs.value[key], inputRanges[key][0], inputRanges[key][1], rangeNames[key]);
    if (issue) return failure(issue);
  }
  if (!['5V', '10V', '20mA'].includes(String(inputs.value.analogType)) || typeof inputs.value.analogType !== 'string') return failure('Fuente AI1 inválida.');
  const modes = exactKeys(c.inputModes, logicInputs, 'Mandos');
  if (!modes.ok) return modes;
  for (const key of logicInputs) if (modes.value[key] !== 'switch' && modes.value[key] !== 'button') return failure(key + ': tipo de mando inválido.');
  const memory = exactKeys(c.driveMemory, ['backupParameters', 'backupValid', 'monitor', 'firstBoot'], 'Memoria');
  if (!memory.ok) return memory;
  const backup = validateParameters(memory.value.backupParameters);
  if (!backup.ok) return backup;
  const backupIssue = booleanIssue(memory.value.backupValid, 'Respaldo');
  if (backupIssue) return failure(backupIssue);
  const bootIssue = booleanIssue(memory.value.firstBoot, 'Primer encendido');
  if (bootIssue) return failure(bootIssue);
  if (!isMonitorCode(memory.value.monitor)) return failure('Monitor inválido.');
  if (memory.value.monitor === 'rPF' && parameters.value['FUn.PI.PIF'] !== 'AI1') return failure('El monitor rPF requiere PI activo.');
  // The complete input is copied only after validation. Callers receive a new
  // object and may replace their current configuration atomically.
  const configuration: Configuration = {
    schema: 'variador-aula', version: 1, model: MODEL, firmwareProfile: PROFILE,
    parameters: parameters.value,
    motor: clone(actualMotor),
    mechanical: clone(mechanical.value) as unknown as MechanicalLoad,
    inputs: clone(inputs.value) as unknown as Inputs,
    inputModes: clone(modes.value) as Configuration['inputModes'],
    driveMemory: {
      backupParameters: backup.value,
      backupValid: memory.value.backupValid as boolean,
      monitor: memory.value.monitor,
      firstBoot: memory.value.firstBoot as boolean,
    },
  };
  return { ok: true, value: configuration as ValidConfiguration };
}
export function parseConfiguration(text: string): ValidationResult<ValidConfiguration> {
  if (typeof text !== 'string') return failure('Se esperaba texto JSON.');
  if (text.length > 262144) return failure('Archivo demasiado grande.');
  let candidate: unknown;
  try { candidate = JSON.parse(text) as unknown; }
  catch (error: unknown) {
    if (error instanceof SyntaxError) return failure('El archivo no contiene JSON válido.');
    throw error;
  }
  return validateConfig(candidate);
}
export function defaults(): ValidParameters {
  const candidate = Object.fromEntries(editableCatalog.map(metadata => [metadata.id, metadata.default]));
  const result = validateParameters(candidate);
  invariant(result.ok, result.ok ? '' : 'El catálogo contiene valores iniciales incompatibles. ' + result.error);
  return result.value;
}
export function initialConfig(): ValidConfiguration {
  const parameters = defaults();
  const candidate: Configuration = {
    schema: 'variador-aula', version: 1, model: MODEL, firmwareProfile: PROFILE, parameters,
    motor: { powerKW: .37, voltage: 230, frequency: 50, current: 2.1, speedRPM: 1420, poles: 4, cosPhi: .8, inertia: .002 },
    mechanical: { torque: 1.2, friction: .002, inertia: .008 },
    inputs: { powered: true, supplyV: 230, LI1: false, LI2: false, LI3: false, LI4: false, analogType: '5V', analogPosition: 50, outputConnections: { U: true, V: true, W: true }, shaftHeld: false, shortCircuit: false, brakeModule: false, ambient: 25, ventilation: 1 },
    inputModes: { LI1: 'switch', LI2: 'switch', LI3: 'switch', LI4: 'switch' },
    driveMemory: { backupParameters: clone(parameters), backupValid: false, monitor: 'FrH', firstBoot: true },
  };
  const result = validateConfig(candidate);
  invariant(result.ok, result.ok ? '' : 'La configuración inicial es incompatible. ' + result.error);
  return result.value;
}
export function visible(id: string, p: ParameterValues): boolean {
  const assigned = (key: ParameterId): boolean => p[key] !== 'nO';
  const pi = p['FUn.PI.PIF'] === 'AI1';
  if (id === 'AIt.CrL' || id === 'AIt.CrH') return p['AIt.ACt'] === 'CUS';
  if (id === 'FUn.tCC.tCt') return p['FUn.tCC.ACt'] === '2C';
  if (id === 'SP2') return assigned('FUn.PS2.LIA');
  if (id === 'SP3' || id === 'SP4') return assigned('FUn.PS2.LIA') && assigned('FUn.PS2.LIb');
  if (id === 'FUn.PS2.LIb') return assigned('FUn.PS2.LIA');
  if (id === 'FUn.HSP.LIb' || id === 'FUn.HSP.HS2') return assigned('FUn.HSP.LIA');
  if (id === 'FUn.HSP.HS3' || id === 'FUn.HSP.HS4') return assigned('FUn.HSP.LIA') && assigned('FUn.HSP.LIb');
  if (id.startsWith('FUn.PI.') && id !== 'FUn.PI.PIF') {
    if (!pi) return false;
    if (id === 'FUn.PI.Pr4' || id === 'FUn.PI.PI2') return assigned('FUn.PI.Pr2');
    if (id === 'FUn.PI.PI3' || id === 'FUn.PI.PI4') return assigned('FUn.PI.Pr2') && assigned('FUn.PI.Pr4');
    if (id === 'FUn.PI.rSL') return p['FUn.tLS'] > 0;
  }
  if (id === 'FUn.rP2.AC2' || id === 'FUn.rP2.dE2') return assigned('FUn.rP2.LI');
  if (id === 'FUn.LC2.CL2') return assigned('FUn.LC2.LI');
  if (id === 'FUn.AdC.tdC') return p['FUn.AdC.ACt'] === 'YES';
  if (id === 'FUn.AdC.SdC') return p['FUn.AdC.ACt'] !== 'nO';
  if (id === 'FUn.FLr') return p['FUn.tCC.ACt'] === '2C' && p['FUn.tCC.tCt'] !== 'trn' && p['FUn.AdC.ACt'] !== 'Ct';
  if (id === 'FUn.Atr') return p['FUn.tCC.ACt'] === '2C' && p['FUn.tCC.tCt'] !== 'trn';
  if (id === 'FUn.dO.Ftd') return p['FUn.dO.ACt'] === 'FtA';
  if (id === 'FUn.dO.Ctd') return p['FUn.dO.ACt'] === 'CtA';
  if (id === 'SUP.rPF') return pi;
  return true;
}
