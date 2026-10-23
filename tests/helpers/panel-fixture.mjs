import { createPanel, initialPanelState } from '../../panel.ts';
import { VFDDrive } from '../../engine.ts';
import { initialConfig, validateConfig, parseConfiguration } from '../../configuration.ts';

// The panel receives plain state and explicit model/configuration services.
// No DOM, animation clock or global browser objects are needed by these tests.
export function createPanelFixture() {
  const config = initialConfig();
  const drive = new VFDDrive(config);
  const state = {
    config,
    ...initialPanelState(config),
    message: ''
  };
  const now = 1000;
  const rawConfiguration = () => structuredClone(state.config);
  const install = (next, reset = false, inhibit = false) => {
    drive.setConfig(next, reset ? {
      reset: true
    } : {});
    if (inhibit) drive.inhibitCommands();
    state.config = next;
  };
  const applyConfiguration = (candidate, inhibit = false) => {
    const result = validateConfig(candidate);
    if (!result.ok) {
      state.message = result.error;
      return false;
    }
    install(result.value, false, inhibit);
    return true;
  };
  const panel = createPanel(state, {
    readings: () => drive.snapshot(),
    rawConfiguration,
    applyConfiguration,
    status: message => {
      state.message = message;
    },
    now: () => now
  });
  const importText = text => {
    const result = parseConfiguration(text);
    if (!result.ok) return result;
    install(result.value, true);
    state.locked = result.value.parameters['SUP.COd'] !== 0;
    panel.resetPanel();
    return {
      ok: true,
      value: rawConfiguration()
    };
  };
  return {
    ...panel,
    state,
    readings: () => drive.snapshot(),
    flashing: () => now < state.flashUntil,
    commitExternal(section, key, value) {
      if (section === 'motor' && !panel.isStopped()) return false;
      const next = rawConfiguration();
      next[section][key] = value;
      if (section === 'inputs' && key === 'powered' && value === false) next.driveMemory.firstBoot = false;
      if (!applyConfiguration(next)) return false;
      if (section === 'inputs' && key === 'powered') {
        state.locked = state.config.parameters['SUP.COd'] !== 0;
        panel.resetPanel();
      }
      return true;
    },
    api: {
      getConfig: rawConfiguration,
      getState: () => drive.snapshot(),
      importText,
      exportText: () => JSON.stringify(state.config),
      saveParameter: panel.saveParameter,
      advance: seconds => drive.advance(seconds)
    }
  };
}
