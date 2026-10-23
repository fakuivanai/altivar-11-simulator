// Browser and Solid adapter for the drive, panel, file input and animation clock.
// Components read its state and call its actions.
import { batch, createMemo, createSignal, onCleanup } from 'solid-js';
import { createMutable, unwrap } from 'solid-js/store';
import VFDDrive from './engine';
import { estimateMotorCircuit, makeMotorCircuit } from './motor-circuit';
import type { MotorCircuitParameters } from './motor-circuit';
import { createScopeHistory } from './scope-history';
import {
  CATALOG, clone, initialConfig, invariant, parseConfiguration, validateConfig, visible,
} from './configuration';
import type {
  Configuration, ParameterId, ParameterValues, ValidConfiguration, ValidationResult,
} from './configuration';
import type { DriveState, Phase } from './engine-types';
import { createPanel, initialPanelState } from './panel';
import type { PanelModelState, PanelSnapshot } from './panel';
export { catalogItem, faultText } from './panel';
export type { PanelSnapshot, DisplayView, MenuItem } from './panel';

/** Configuration sections that the bench (not the keypad) changes. */
export type ExternalSection = 'motor' | 'mechanical' | 'inputs' | 'inputModes';
/** Boolean bench inputs other than the logic inputs. */
export type BooleanInput = 'powered' | 'shortCircuit' | 'brakeModule' | 'shaftHeld';
export type LiveReadings = Omit<DriveState, 'angle'>;
export type NumericKey<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T] & string;
interface UIState extends PanelModelState {
  message: string;
  /** Name of the last configuration file chosen for loading. */
  fileName: string;
  simulationLag: number;
}
interface SimulatorAPI {
  getConfig(): Configuration;
  getState(): Readonly<DriveState>;
  importText(text: string): ValidationResult<Configuration>;
  exportText(): string;
  validateConfig: typeof validateConfig;
  key(direction: 1 | -1): void;
  enter(held?: number): void;
  escapeKey(): void;
  panel(): PanelSnapshot;
  navigate(id: string): void;
  advance(seconds: number): void;
  saveParameter<K extends ParameterId>(id: K, value: ParameterValues[NoInfer<K>], held?: number): boolean;
  visible: typeof visible;
  CATALOG: typeof CATALOG;
}
declare global { interface Window { VFDSimulator: SimulatorAPI } }

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'No se pudo completar la operación.';
}

export type Simulator = ReturnType<typeof createSimulator>;

/** Must run inside a Solid root; the clock stops when the root is disposed. */
export function createSimulator() {
  const initial = initialConfig();
  const drive = new VFDDrive(initial);
  let previousFrameTime = performance.now();
  const scopeHistory = createScopeHistory();
  drive.onPhysicalSample(sample => scopeHistory.push(sample));
  const state = createMutable<UIState>({
    config: initial,
    ...initialPanelState(initial),
    message: 'Listo. Arranque con Marcha (LI1).',
    fileName: '',
    simulationLag: 0,
  });
  // The shaft angle changes every frame; it goes to frame listeners, not to a signal.
  const frameListeners = new Set<(angle: number) => void>();
  function captureReadings(): LiveReadings {
    const { angle, ...readings } = drive.snapshot();
    for (const listener of frameListeners) listener(angle);
    return readings;
  }
  const [readings, setReadings] = createSignal<Readonly<LiveReadings>>(captureReadings());
  function commitReadings(): void { setReadings(captureReadings()); }
  function onFrame(listener: (angle: number) => void): () => void {
    frameListeners.add(listener);
    listener(drive.snapshot().angle);
    return () => frameListeners.delete(listener);
  }
  function status(message: string): void { state.message = message; }
  function rawConfiguration(): Configuration { return clone(unwrap(state.config)); }
  function installConfiguration(next: ValidConfiguration, reset = false, inhibit = false): void {
    batch(() => {
      drive.setConfig(next, reset ? { reset: true } : {});
      if (reset) { scopeHistory.clear(); state.simulationLag = 0; previousFrameTime = performance.now(); }
      if (inhibit) drive.inhibitCommands();
      state.config = next;
      commitReadings();
    });
  }
  function applyConfiguration(candidate: unknown, inhibit = false): boolean {
    const result = validateConfig(candidate);
    if (!result.ok) { status(result.error); return false; }
    installConfiguration(result.value, false, inhibit);
    return true;
  }
  const panel = createPanel(state, { readings, rawConfiguration, applyConfiguration, status, now: () => performance.now() });
  const { resetPanel, isStopped, items, selected, panelSnapshot, canNavigate, monitorLabel, inputRole, operatorNote } = panel;
  const key = (direction: 1 | -1): void => batch(() => panel.key(direction));
  const enter = (held = 0): void => batch(() => panel.enter(held));
  const escapeKey = (): void => batch(() => panel.escapeKey());
  const navigate = (id: string): void => batch(() => panel.navigate(id));
  function saveParameter<K extends ParameterId>(id: K, value: ParameterValues[NoInfer<K>], held = 0): boolean {
    return batch(() => panel.saveParameter(id, value, held));
  }
  const motorEstimate = createMemo(() => estimateMotorCircuit(state.config.motor));
  const motorCircuit = createMemo(() => state.config.motorElectrical.mode === 'manual'
    ? makeMotorCircuit(state.config.motorElectrical.parameters, state.config.motor.poles / 2)
    : motorEstimate().circuit);
  function motorCanChange(): boolean {
    const r = readings();
    return isStopped() && Math.abs(r.omega) <= .05 && r.output.mode === 'off';
  }
  function setMotorElectrical(parameters: MotorCircuitParameters | null): boolean {
    if (!motorCanChange()) { status('Desactive la salida y espere que se detenga el eje para cambiar el motor.'); return false; }
    const next = rawConfiguration();
    next.motorElectrical = parameters === null ? { mode: 'estimated' } : { mode: 'manual', parameters: { ...parameters } };
    if (!applyConfiguration(next)) return false;
    status('');
    return true;
  }
  function importText(text: string): ValidationResult<Configuration> {
    const result = parseConfiguration(text);
    if (!result.ok) return result;
    batch(() => {
      installConfiguration(result.value, true);
      state.locked = result.value.parameters['SUP.COd'] !== 0;
      resetPanel();
      const legacy = !Object.hasOwn(JSON.parse(text), 'motorElectrical');
      status((legacy ? 'Archivo anterior: circuito eléctrico estimado desde la placa. ' : '') + 'Configuración cargada. Libere los mandos de marcha antes de arrancar.');
    });
    return { ok: true, value: rawConfiguration() };
  }
  function exportText(): string {
    const result = validateConfig(unwrap(state.config));
    invariant(result.ok, 'la configuración actual no es exportable');
    return JSON.stringify(result.value, null, 2) + '\n';
  }
  function advance(seconds: number): void { drive.advance(seconds); commitReadings(); }
  function beginClock(): void {
    let animationFrame: number;
    const visibilityChanged = (): void => { previousFrameTime = performance.now(); };
    document.addEventListener('visibilitychange', visibilityChanged);
    const frame = (time: number): void => {
      const remaining = Math.max(0, (time - previousFrameTime) / 1000);
      previousFrameTime = time;
      if (!document.hidden) {
        state.simulationLag = drive.advanceBudget(remaining, 8).backlog;
        commitReadings();
      }
      animationFrame = requestAnimationFrame(frame);
    };
    animationFrame = requestAnimationFrame(frame);
    onCleanup(() => { cancelAnimationFrame(animationFrame); document.removeEventListener('visibilitychange', visibilityChanged); });
  }

  const display = createMemo(panel.computeDisplay, undefined, {
    equals: (a, b) => a.text === b.text && a.caption === b.caption && a.fault === b.fault && a.route === b.route,
  });
  /** The display blanks briefly after a value is saved. */
  const flashing = createMemo(() => { readings(); return performance.now() < state.flashUntil; });
  function analogReading(): string {
    const inputs = state.config.inputs;
    const scale = inputs.analogType === '5V' ? .05 : inputs.analogType === '10V' ? .1 : .2;
    return 'AI1 ' + (inputs.analogPosition * scale).toFixed(1) + (inputs.analogType === '20mA' ? ' mA' : ' V');
  }
  /** All bench changes pass through the same configuration validation. */
  function commitField<S extends ExternalSection>(section: S, key: keyof Configuration[S] & string, value: unknown): boolean {
    return batch(() => {
      if (section === 'motor' && !motorCanChange()) {
        status('Desactive la salida y espere que se detenga el eje para cambiar el motor.');
        return false;
      }
      const previous = rawConfiguration();
      const next = { ...previous, [section]: { ...previous[section], [key]: value } };
      if (section === 'inputs' && key === 'powered' && value === false) next.driveMemory.firstBoot = false;
      if (!applyConfiguration(next)) return false;
      if (section === 'inputs' && key === 'powered') {
        state.locked = state.config.parameters['SUP.COd'] !== 0;
        resetPanel();
      }
      status('');
      return true;
    });
  }
  function commitExternal<S extends ExternalSection, K extends keyof Configuration[S] & string>(
    section: S, key: K, value: Configuration[S][K]): boolean {
    return commitField(section, key, value);
  }
  function commitNumber<S extends 'motor' | 'inputs'>(section: S, key: NumericKey<Configuration[S]>, value: number): boolean {
    return commitField(section, key, value);
  }
  /** Flips one of the bench switches (supply, short, brake module, shaft clamp). */
  function toggleInput(key: BooleanInput): boolean {
    return commitExternal('inputs', key, !state.config.inputs[key]);
  }
  function togglePhase(phase: Phase): void {
    const next = rawConfiguration();
    next.inputs.outputConnections[phase] = !next.inputs.outputConnections[phase];
    if (applyConfiguration(next)) status('');
  }
  function download(): void {
    const url = URL.createObjectURL(new Blob([exportText()], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Configuración del variador.json';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    status('Configuración descargada.');
  }
  async function importFile(file: File): Promise<void> {
    if (file.size > 262144) { status('Archivo demasiado grande.'); return; }
    let text: string;
    try { text = await file.text(); }
    catch (error: unknown) { status(errorMessage(error)); return; }
    const result = importText(text);
    if (!result.ok) status(result.error);
    else state.fileName = file.name;
  }

  window.VFDSimulator = {
    getConfig: rawConfiguration, getState: () => drive.snapshot(), importText, exportText,
    validateConfig,
    key, enter, escapeKey, panel: panelSnapshot, navigate, advance, saveParameter, visible, CATALOG,
  };
  beginClock();
  return {
    state, readings, scopeHistory, motorCircuit, motorEstimate, setMotorElectrical, motorCanChange, onFrame, display, flashing, selected, items, panelSnapshot, isStopped,
    key, enter, escapeKey, navigate, canNavigate, commitExternal, commitNumber, toggleInput, togglePhase, inputRole, operatorNote, analogReading,
    download, importFile, status, monitorLabel,
  };
}
