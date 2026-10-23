import { LOGIC_INPUTS, PHASES } from './engine-types';
// Simulator controller: the drive model, the validated configuration and the
// keypad logic, with no DOM. Components read its state and call its actions.
// Manufacturer facts and source locators are recorded in Fuentes.md.
import { batch, createMemo, createSignal, onCleanup } from 'solid-js';
import { createMutable, unwrap } from 'solid-js/store';
import VFDDrive from './engine';
import {
  CATALOG, clone, defaults, initialConfig, invariant, isMonitorCode,
  paramById, parseConfiguration, validateConfig, validateParameters, visible,
} from './configuration';
import type {
  CatalogItem, ChoiceParameterMetadata, CodeValue, Configuration,
  MonitorCode, MonitorId, NumericParameterMetadata, ParameterId, ValidConfiguration, ValidationResult,
} from './configuration';
import type { DriveState, FaultCode, LogicInputId } from './engine-types';

export { LOGIC_INPUTS };
export const OUTPUT_PHASES = PHASES;
export type Phase = typeof OUTPUT_PHASES[number];
const ROOT_PARAMETERS = ['ACC', 'dEC', 'LSP', 'HSP', 'ItH', 'SP2', 'SP3', 'SP4'] as const;
const ROOT_MENUS = ['AIt', 'drC', 'FUn', 'SUP'] as const;
/** Configuration sections that the bench (not the keypad) changes. */
export type ExternalSection = 'motor' | 'mechanical' | 'inputs' | 'inputModes';
export type NumericKey<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T] & string;
/** Boolean bench inputs other than the logic inputs. */
export type BooleanInput = 'powered' | 'shortCircuit' | 'brakeModule' | 'shaftHeld';
export type LiveReadings = Omit<DriveState, 'angle'>;
type PanelEdit =
  | { kind: 'numeric'; metadata: NumericParameterMetadata; value: number }
  | { kind: 'choice'; metadata: ChoiceParameterMetadata; value: CodeValue }
  | { kind: 'monitor'; id: MonitorId; code: MonitorCode };
interface PanelState {
  trail: string[];
  index: number;
  edit: PanelEdit | null;
  monitor: MonitorCode;
}
export type MenuItem = { kind: 'menu'; code: string } | { kind: 'parameter'; code: string; id: CatalogItem['id'] };
interface UIState {
  config: ValidConfiguration;
  panel: PanelState;
  locked: boolean;
  message: string;
  flashUntil: number;
  /** Name of the last configuration file chosen for loading. */
  fileName: string;
}
export interface PanelSnapshot {
  trail: string[];
  index: number;
  editing: CatalogItem['id'] | null;
  draft: CodeValue | null;
  monitor: MonitorCode;
}
/** What the keypad display and its caption show. */
export interface DisplayView { text: string; caption: string; fault: boolean; route: string }
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
  saveParameter(id: ParameterId, value: CodeValue, held?: number): boolean;
  visible: typeof visible;
  CATALOG: typeof CATALOG;
}
declare global { interface Window { VFDSimulator: SimulatorAPI } }

export function catalogItem(id: string): CatalogItem {
  const found = paramById[id];
  invariant(found, 'parámetro desconocido ' + id);
  return found;
}
function readOnlyValue(value: number, step: number): string {
  return value.toFixed(Math.abs(value) >= 100 || step === 1 ? 0 : 1);
}
function numericValue(value: number, step: number): string {
  const decimals = step < .01 ? 3 : step < .1 ? 2 : step < 1 ? 1 : 0;
  const formatted = value.toFixed(decimals);
  return formatted.length > 4 ? value.toFixed(Math.min(decimals, 1)) : formatted;
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'No se pudo completar la operación.';
}
export function faultText(code: FaultCode): string {
  const descriptions: Record<FaultCode, string> = {
    OLF: 'Sobrecarga térmica del motor', OHF: 'Sobretemperatura del variador',
    OLC: 'Umbral de sobrecarga', ULF: 'Umbral de subcarga',
    ObF: 'Sobretensión durante el frenado', OSF: 'Sobretensión de red',
    USF: 'Subtensión de red', OCF: 'Sobrecorriente', SCF: 'Cortocircuito en el motor',
    SOF: 'Sobrevelocidad', CFF: 'Configuración inválida', InF: 'Falla interna',
    CrF: 'Circuito de carga', PHF: 'Falta de fase de red',
  };
  return descriptions[code];
}

export type Simulator = ReturnType<typeof createSimulator>;

/** Must run inside a Solid root; the clock stops when the root is disposed. */
export function createSimulator() {
  const initial = initialConfig();
  const drive = new VFDDrive(initial);
  const state = createMutable<UIState>({
    config: initial,
    panel: { trail: [], index: -1, edit: null, monitor: initial.driveMemory.monitor },
    locked: initial.parameters['SUP.COd'] !== 0,
    message: 'Listo. Arranque con Marcha (LI1).',
    flashUntil: 0,
    fileName: '',
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
  function resetPanel(): void {
    state.panel = { trail: [], index: -1, edit: null, monitor: state.config.driveMemory.monitor };
  }
  function isStopped(): boolean {
    const current = readings();
    return !current.running && current.status !== 'dcb' && Math.abs(current.rFr) < .1;
  }
  function installConfiguration(next: ValidConfiguration, reset = false, inhibit = false): void {
    batch(() => {
      drive.setConfig(next, reset ? { reset: true } : {});
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
  function monitorValue(code: MonitorCode): number { return readings()[code]; }
  function rootItems(): MenuItem[] {
    if (state.locked) return [{ code: 'SUP', kind: 'menu' }];
    const result: MenuItem[] = [];
    if (state.config.driveMemory.firstBoot) result.push({ code: 'bFr', id: 'bFr', kind: 'parameter' });
    for (const id of ROOT_PARAMETERS) {
      if (visible(id, state.config.parameters)) result.push({ code: id, id, kind: 'parameter' });
    }
    for (const code of ROOT_MENUS) result.push({ code, kind: 'menu' });
    return result;
  }
  function items(): MenuItem[] {
    const trail = state.panel.trail;
    if (!trail.length) return rootItems();
    const path = trail.join('.');
    const result: MenuItem[] = [];
    for (const metadata of CATALOG) {
      if (!visible(metadata.id, state.config.parameters)) continue;
      const routes = [metadata.path, ...(metadata.aliases ?? []).map(route => route.slice(0, -1))];
      for (const route of routes) {
        if (route.slice(0, trail.length).join('.') !== path) continue;
        const remaining = route.slice(trail.length);
        const code = remaining[0];
        if (code !== undefined) {
          if (!result.some(item => item.code === code)) result.push({ code, kind: 'menu' });
        } else if (!result.some(item => item.kind === 'parameter' && item.id === metadata.id)) {
          result.push({ code: metadata.code, id: metadata.id, kind: 'parameter' });
        }
      }
    }
    return result;
  }
  function selected(): MenuItem | undefined {
    if (state.panel.index < 0) return undefined;
    const list = items();
    const index = Math.max(0, Math.min(state.panel.index, list.length - 1));
    return list[index];
  }
  function editId(edit: PanelEdit): CatalogItem['id'] {
    return edit.kind === 'monitor' ? edit.id : edit.metadata.id;
  }
  function codeSequence(): number[] {
    const codes = Array.from({ length: 998 }, (_, index) => index + 2);
    if (state.locked) return [-1, ...codes];
    return state.config.parameters['SUP.COd'] === 0 ? [0, ...codes] : [0, -1, ...codes];
  }
  function cycleValue<T extends CodeValue>(values: readonly T[], current: CodeValue, direction: 1 | -1): T {
    invariant(values.length > 0, 'la lista de opciones está vacía');
    const index = values.findIndex(value => value === current);
    const next = values[(index + direction + values.length) % values.length];
    invariant(next !== undefined, 'la selección cíclica quedó fuera de rango');
    return next;
  }
  function numericBounds(metadata: NumericParameterMetadata): { min: number; max: number } {
    const parameters = state.config.parameters;
    let { min, max } = metadata;
    if (metadata.id === 'LSP') max = parameters.HSP;
    if (metadata.id === 'HSP' || /\.HS[234]$/.test(metadata.id)) min = parameters.LSP;
    if (['SP2', 'SP3', 'SP4'].includes(metadata.id)) max = parameters.HSP;
    if (metadata.id === 'AIt.CrL') max = parameters['AIt.CrH'] - .1;
    if (metadata.id === 'AIt.CrH') min = parameters['AIt.CrL'] + .1;
    if (['drC.StA', 'drC.FLG'].includes(metadata.id) && !isStopped()) min = 1;
    return { min, max };
  }
  function choiceOptions(metadata: ChoiceParameterMetadata): readonly CodeValue[] {
    if (metadata.id === 'FUn.SFt.SFr') return state.config.parameters['FUn.SFt.ACt'] === 'HF' ? [8, 12, 16] : [2, 4];
    if (metadata.id === 'FUn.FCS' && !state.config.driveMemory.backupValid) return ['nO', 'InI'];
    return metadata.choices;
  }
  function key(direction: 1 | -1): void {
    batch(() => {
      status('');
      if (!state.config.inputs.powered) return;
      const edit = state.panel.edit;
      if (edit) {
        if (edit.kind === 'monitor') return;
        const metadata = edit.metadata;
        if (!metadata.runEditable && !isStopped()) {
          status('Detenga el variador para modificar ' + metadata.code + '.');
          return;
        }
        if (edit.kind === 'numeric') {
          if (metadata.id === 'SUP.COd') edit.value = cycleValue(codeSequence(), edit.value, direction);
          else {
            const { min, max } = numericBounds(edit.metadata);
            const position = edit.value / edit.metadata.step;
            const next = direction === 1 ? Math.floor(position + 1e-6) + 1 : Math.ceil(position - 1e-6) - 1;
            edit.value = Math.min(max, Math.max(min, Math.round(next * edit.metadata.step * 1e6) / 1e6));
          }
        } else edit.value = cycleValue(choiceOptions(edit.metadata), edit.value, direction);
      } else {
        const list = items();
        invariant(list.length > 0, 'el menú actual está vacío');
        state.panel.index = state.panel.index === -1
          ? direction === 1 ? list.length - 1 : 0
          : (state.panel.index - direction + list.length) % list.length;
      }
    });
  }
  function saveAccessCode(value: CodeValue): boolean {
    invariant(typeof value === 'number', 'COd debe ser numérico');
    const stored = state.config.parameters['SUP.COd'];
    if (state.locked) {
      if (value === stored) {
        state.locked = false;
        status('Acceso habilitado hasta el próximo encendido.');
        return true;
      }
      status('Código incorrecto.');
      const edit = state.panel.edit;
      if (edit?.kind === 'numeric') edit.value = -1;
      return false;
    }
    if (value === -1) { state.locked = stored !== 0; return true; }
    // Technical manual p.119: an unlocked displayed code stays unlocked.
    // Selecting On relocks the same code; entering a new code also locks.
    if (value === stored) return true;
    const next = rawConfiguration();
    next.parameters['SUP.COd'] = value;
    if (!applyConfiguration(next)) return false;
    state.locked = value !== 0;
    return true;
  }
  function saveBackup(value: CodeValue): boolean {
    if (value !== 'YES' && value !== 'nO') { status('SCS: opción inválida.'); return false; }
    if (value === 'nO') return true;
    const next = rawConfiguration();
    next.driveMemory.backupParameters = clone(next.parameters);
    next.driveMemory.backupValid = true;
    return applyConfiguration(next);
  }
  function restoreParameters(value: CodeValue): boolean {
    if (value === 'nO') return true;
    if (value !== 'InI' && value !== 'rEC') { status('FCS: opción inválida.'); return false; }
    if (value === 'rEC' && !state.config.driveMemory.backupValid) {
      status('No hay configuración guardada.'); return false;
    }
    const next = rawConfiguration();
    const accessCode = next.parameters['SUP.COd'];
    next.parameters = value === 'InI' ? defaults() : clone(next.driveMemory.backupParameters);
    next.parameters['SUP.COd'] = accessCode;
    next.driveMemory.monitor = 'FrH';
    if (!applyConfiguration(next, true)) return false;
    state.panel.monitor = 'FrH';
    return true;
  }
  function parameterCandidate(id: ParameterId, value: CodeValue): Record<string, unknown> {
    const next: Record<string, unknown> = { ...unwrap(state.config.parameters), [id]: value };
    // ENT also confirms an unchanged displayed value (user manual, p.56).
    // Dependency rewrites apply only to an actual ordinary parameter change.
    if (value === state.config.parameters[id]) return next;
    if (id === 'bFr') {
      for (const changed of ['drC.FrS', 'HSP', 'FUn.dO.Ftd', 'FUn.HSP.HS2', 'FUn.HSP.HS3', 'FUn.HSP.HS4']) next[changed] = value;
    }
    if (id === 'FUn.tCC.ACt') {
      next['FUn.rrS'] = value === '2C' ? 'LI2' : 'LI3';
      next['FUn.tCC.tCt'] = 'trn';
      next['FUn.Atr'] = 'nO';
      next['FUn.PS2.LIA'] = value === '2C' ? 'LI3' : 'LI4';
      next['FUn.PS2.LIb'] = value === '2C' ? 'LI4' : 'nO';
      next['FUn.FLr'] = 'nO';
      if (next['FUn.PI.PIF'] === 'AI1') { next['FUn.rrS'] = 'nO'; next['FUn.PS2.LIA'] = 'LI1'; }
    }
    if (id === 'FUn.tCC.tCt' && value === 'trn') { next['FUn.Atr'] = 'nO'; next['FUn.FLr'] = 'nO'; }
    if (id === 'FUn.AdC.ACt' && value === 'Ct') next['FUn.FLr'] = 'nO';
    if (id === 'FUn.PI.PIF' && value === 'AI1') { next['FUn.rrS'] = 'nO'; next['FUn.PS2.LIA'] = 'LI1'; }
    if (id === 'FUn.SFt.ACt') next['FUn.SFt.SFr'] = value === 'HF' ? 12 : 4;
    for (const group of ['PS2', 'HSP']) {
      if (id === 'FUn.' + group + '.LIA' && value === 'nO') next['FUn.' + group + '.LIb'] = 'nO';
    }
    if (id === 'FUn.PI.Pr2' && value === 'nO') next['FUn.PI.Pr4'] = 'nO';
    return next;
  }
  function saveParameter(id: ParameterId, value: CodeValue, held = 0): boolean {
    return batch(() => {
      const metadata = catalogItem(id);
      invariant(metadata.kind !== 'monitor', 'no se puede guardar un monitor');
      if (!state.config.inputs.powered) { status('Alimente el variador para modificar parámetros.'); return false; }
      if (state.locked && id !== 'SUP.COd') { status('Acceso bloqueado por COd.'); return false; }
      if (!visible(id, state.config.parameters)) { status('El parámetro no está disponible con esta configuración.'); return false; }
      if (!metadata.runEditable && !isStopped()) {
        status('Detenga el variador para modificar ' + metadata.code + '.'); return false;
      }
      if (['drC.StA', 'drC.FLG'].includes(id) && !isStopped() && value === 0) {
        status('El mínimo durante la marcha es 1.'); return false;
      }
      if (['FUn.tCC.ACt', 'FUn.FCS'].includes(id) && value !== state.config.parameters[id] && held < 2000) {
        status('Mantenga ENT durante 2 s para confirmar.'); return false;
      }
      if (id === 'SUP.COd') return saveAccessCode(value);
      if (id === 'FUn.SCS') return saveBackup(value);
      if (id === 'FUn.FCS') return restoreParameters(value);
      const result = validateParameters(parameterCandidate(id, value));
      if (!result.ok) { status(result.error); return false; }
      const next = rawConfiguration();
      next.parameters = result.value;
      if (id === 'bFr') next.driveMemory.firstBoot = false;
      if (id === 'FUn.PI.PIF' && value === 'nO' && next.driveMemory.monitor === 'rPF') next.driveMemory.monitor = 'FrH';
      if (!applyConfiguration(next, id === 'FUn.tCC.ACt' && value !== state.config.parameters[id])) return false;
      if (id === 'FUn.PI.PIF' && value === 'nO' && state.panel.monitor === 'rPF') state.panel.monitor = 'FrH';
      return true;
    });
  }
  function beginEdit(metadata: CatalogItem): PanelEdit {
    if (metadata.kind === 'monitor') {
      invariant(isMonitorCode(metadata.code), 'código de monitor desconocido');
      state.panel.monitor = metadata.code;
      return { kind: 'monitor', id: metadata.id, code: metadata.code };
    }
    const value = metadata.id === 'SUP.COd' && state.locked ? -1 : state.config.parameters[metadata.id];
    if (metadata.kind === 'numeric') {
      invariant(typeof value === 'number', 'un parámetro numérico contiene texto');
      return { kind: 'numeric', metadata, value };
    }
    return { kind: 'choice', metadata, value };
  }
  function enter(held = 0): void {
    batch(() => {
      if (!state.config.inputs.powered) return;
      status('');
      const edit = state.panel.edit;
      if (edit) {
        if (edit.kind === 'monitor') {
          const next = rawConfiguration();
          next.driveMemory.monitor = edit.code;
          if (applyConfiguration(next)) state.flashUntil = performance.now() + 250;
          return;
        }
        if (saveParameter(edit.metadata.id, edit.value, held)) {
          state.panel.edit = beginEdit(edit.metadata);
          state.flashUntil = performance.now() + 250;
        }
        return;
      }
      const current = selected();
      if (!current) {
        status(state.config.parameters['FUn.tCC.ACt'] === '2C'
          ? 'ENT confirma parámetros. Para arrancar use Marcha (LI1).'
          : 'ENT confirma parámetros. Habilite LI1 y pulse Marcha (LI2).');
        return;
      }
      if (current.kind === 'menu') { state.panel.trail.push(current.code); state.panel.index = 0; }
      else state.panel.edit = beginEdit(catalogItem(current.id));
    });
  }
  function escapeKey(): void {
    batch(() => {
      if (state.panel.edit) { state.panel.edit = null; status(''); }
      else if (state.panel.trail.length) {
        const leaving = state.panel.trail.pop();
        state.panel.index = Math.max(0, items().findIndex(item => item.code === leaving));
      } else state.panel.index = -1;
    });
  }
  function editText(edit: PanelEdit): string {
    if (edit.kind === 'monitor') {
      const metadata = catalogItem(edit.id);
      invariant(metadata.kind === 'monitor', 'un monitor tiene metadatos de parámetro');
      return readOnlyValue(monitorValue(edit.code), metadata.step);
    }
    if (edit.metadata.id === 'SUP.COd') return edit.value === 0 ? 'OFF' : edit.value === -1 ? 'On' : String(edit.value);
    return edit.kind === 'choice' ? String(edit.value) : numericValue(edit.value, edit.metadata.step);
  }
  function monitorLabel(code: MonitorCode): string {
    return CATALOG.find(item => item.kind === 'monitor' && item.code === code)?.label ?? code;
  }
  function inputFunction(id: LogicInputId): string {
    const names: Array<[ParameterId, string]> = [
      ['FUn.rrS', 'Inversa'], ['FUn.PS2.LIA', 'Presel. A'], ['FUn.PS2.LIb', 'Presel. B'],
      ['FUn.HSP.LIA', 'Vel. máx. A'], ['FUn.HSP.LIb', 'Vel. máx. B'], ['FUn.PI.PAU', 'Auto/man.'],
      ['FUn.PI.Pr2', 'Ref. PI'], ['FUn.PI.Pr4', 'Ref. PI'], ['FUn.rSF', 'Rearme'],
      ['FUn.rP2.LI', 'Rampa 2'], ['FUn.LC2.LI', 'Lím. I 2'], ['FUn.nSt', 'Rueda libre'],
    ];
    const found: string[] = [];
    for (const [parameter, name] of names) {
      if (!visible(parameter, state.config.parameters) || state.config.parameters[parameter] !== id) continue;
      if (!found.includes(name)) found.push(name);
    }
    return found.join(' / ');
  }
  function importText(text: string): ValidationResult<Configuration> {
    const result = parseConfiguration(text);
    if (!result.ok) return result;
    batch(() => {
      installConfiguration(result.value, true);
      state.locked = result.value.parameters['SUP.COd'] !== 0;
      resetPanel();
      status('Configuración cargada. Libere los mandos de marcha antes de arrancar.');
    });
    return { ok: true, value: rawConfiguration() };
  }
  function exportText(): string {
    const result = validateConfig(unwrap(state.config));
    invariant(result.ok, 'la configuración actual no es exportable');
    return JSON.stringify(result.value, null, 2) + '\n';
  }
  function panelSnapshot(): PanelSnapshot {
    const edit = state.panel.edit;
    return {
      trail: [...state.panel.trail], index: state.panel.index,
      editing: edit ? editId(edit) : null,
      draft: edit ? edit.kind === 'monitor' ? monitorValue(edit.code) : edit.value : null,
      monitor: state.panel.monitor,
    };
  }
  function navigate(id: string): void {
    const metadata = catalogItem(id);
    if (!canNavigate(metadata.id)) {
      status(state.locked && metadata.path[0] !== 'SUP'
        ? 'Acceso bloqueado por COd.' : 'El parámetro no está disponible en el panel.');
      return;
    }
    batch(() => {
      state.panel.trail = metadata.id === 'bFr' && !state.config.driveMemory.firstBoot
        ? ['FUn'] : [...metadata.path];
      state.panel.index = items().findIndex(item => item.kind === 'parameter' && item.id === id);
      state.panel.edit = null;
    });
  }
  /** Study shortcuts obey the same power, visibility and access rules as the keypad. */
  function canNavigate(id: CatalogItem['id']): boolean {
    const metadata = catalogItem(id);
    return state.config.inputs.powered && visible(id, state.config.parameters)
      && (!state.locked || metadata.path[0] === 'SUP');
  }
  function advance(seconds: number): void { drive.advance(seconds); commitReadings(); }
  function beginClock(): void {
    let previousTime = performance.now();
    let animationFrame: number;
    const visibilityChanged = (): void => { previousTime = performance.now(); };
    document.addEventListener('visibilitychange', visibilityChanged);
    const frame = (time: number): void => {
      let remaining = Math.max(0, (time - previousTime) / 1000);
      previousTime = time;
      if (!document.hidden) {
        while (remaining > 0) {
          const seconds = Math.min(remaining, 60);
          drive.advance(seconds); remaining -= seconds;
        }
        commitReadings();
      }
      animationFrame = requestAnimationFrame(frame);
    };
    animationFrame = requestAnimationFrame(frame);
    onCleanup(() => { cancelAnimationFrame(animationFrame); document.removeEventListener('visibilitychange', visibilityChanged); });
  }

  function computeDisplay(): DisplayView {
    const current = readings();
    let text = '', caption = '';
    if (state.config.inputs.powered) {
      const edit = state.panel.edit;
      if (edit) {
        text = editText(edit);
        caption = catalogItem(editId(edit)).label;
      } else if (state.panel.index === -1) {
        text = current.fault ?? (current.status || 'rdY');
        if (!current.fault && current.running) text = readOnlyValue(monitorValue(state.panel.monitor), .1);
        caption = current.fault ? 'Falla: ' + faultText(current.fault) + '. Para rearmar, abra y cierre la red.'
          : current.running ? 'En marcha. ' + state.panel.monitor + ': ' + monitorLabel(state.panel.monitor) + '.'
          : text === 'rdY' ? 'Listo. Pulse Subir o Bajar para entrar al menú.' : '';
      } else {
        const selection = selected();
        text = selection?.code ?? 'rdY';
        caption = selection?.kind === 'parameter' ? catalogItem(selection.id).label : 'Menú ' + (selection?.code ?? '');
      }
    } else caption = 'Sin alimentación. Cierre el interruptor de red.';
    return { text, caption, fault: current.fault !== null && state.panel.index === -1 && !state.panel.edit, route: state.panel.trail.join(' / ') };
  }
  const display = createMemo(computeDisplay, undefined, {
    equals: (a, b) => a.text === b.text && a.caption === b.caption && a.fault === b.fault && a.route === b.route,
  });
  /** The display blanks briefly after a value is saved. */
  const flashing = createMemo(() => { readings(); return performance.now() < state.flashUntil; });
  function isTwoWire(): boolean { return state.config.parameters['FUn.tCC.ACt'] === '2C'; }
  /** What a logic input does with the present programming. */
  function inputRole(id: LogicInputId): string {
    const twoWire = isTwoWire();
    if (twoWire ? id === 'LI1' : id === 'LI2') return 'Marcha';
    if (!twoWire && id === 'LI1') return 'Parada';
    return inputFunction(id);
  }
  function operatorNote(): string {
    return isTwoWire() ? 'ENT confirma parámetros. Marcha por LI1.' : 'ENT confirma parámetros. Marcha por LI2, habilite LI1.';
  }
  function analogReading(): string {
    const inputs = state.config.inputs;
    const scale = inputs.analogType === '5V' ? .05 : inputs.analogType === '10V' ? .1 : .2;
    return 'AI1 ' + (inputs.analogPosition * scale).toFixed(1) + (inputs.analogType === '20mA' ? ' mA' : ' V');
  }
  /** All bench changes pass through the same configuration validation. */
  function commitField<S extends ExternalSection>(section: S, key: keyof Configuration[S] & string, value: unknown): boolean {
    return batch(() => {
      if (section === 'motor' && !isStopped()) {
        status('Detenga el variador para cambiar el motor.');
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
    state, readings, onFrame, display, flashing, selected, items, panelSnapshot, isStopped,
    key, enter, escapeKey, navigate, canNavigate, commitExternal, commitNumber, toggleInput, togglePhase, inputRole, operatorNote, analogReading,
    download, importFile, status, monitorLabel,
  };
}
