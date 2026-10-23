// Header buttons: optional motor sound and fullscreen.
import { Show, createEffect, createSignal, onCleanup } from 'solid-js';
import type { JSX } from 'solid-js';
import { makeMotorSound } from './motor-sound';
import { useSimulator } from './ui';

/** Off by default; turning it on is the user gesture browsers require for audio. */
export function SoundToggle(): JSX.Element {
  const sim = useSimulator();
  const sound = makeMotorSound();
  const [on, setOn] = createSignal(false);
  const [visible, setVisible] = createSignal(!document.hidden);
  // keep the preference through a visibility pause and ignore stale audio requests.
  let request = 0;
  let disposed = false;
  const update = (): void => {
    const motor = sim.state.config.motor;
    sound.update(sim.readings(), motor.speedRPM, motor.voltage, motor.current);
  };
  const synchronize = async (): Promise<void> => {
    const current = ++request;
    if (!on() || !visible()) { sound.stop(); return; }
    try {
      await sound.start();
      if (!disposed && current === request) update();
    } catch {
      if (disposed || current !== request) return;
      setOn(false);
      sound.stop();
      sim.status('Este navegador no permite reproducir el sonido.');
    }
  };
  const visibilityChanged = (): void => {
    setVisible(!document.hidden);
    void synchronize();
  };
  document.addEventListener('visibilitychange', visibilityChanged);
  onCleanup(() => {
    disposed = true;
    request += 1;
    document.removeEventListener('visibilitychange', visibilityChanged);
    sound.dispose();
  });
  createEffect(() => {
    if (on() && visible()) update();
  });
  const toggle = (): void => {
    setOn(!on());
    void synchronize();
  };
  return (
    <button id="sound-toggle" class="header-button" aria-pressed={on()} title="Sonido aproximado del motor y la conmutación" onClick={toggle}>
      {on() ? 'Sonido: sí' : 'Sonido: no'}
    </button>
  );
}

/** Fullscreen where the browser allows it for pages (not iPhone Safari). */
export function FullscreenButton(): JSX.Element {
  const sim = useSimulator();
  const [active, setActive] = createSignal(document.fullscreenElement !== null);
  const changed = (): void => { setActive(document.fullscreenElement !== null); };
  document.addEventListener('fullscreenchange', changed);
  onCleanup(() => document.removeEventListener('fullscreenchange', changed));
  const toggle = async (): Promise<void> => {
    try {
      if (document.fullscreenElement) { await document.exitFullscreen(); return; }
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      // Phones: landscape suits the 16:9 stage. Not every browser can lock it.
      const orientation = screen.orientation as ScreenOrientation & { lock?: (type: string) => Promise<void> };
      try { await orientation.lock?.('landscape'); } catch { /* the browser keeps its orientation */ }
    } catch {
      sim.status('No se pudo cambiar a pantalla completa.');
    }
  };
  return (
    <Show when={document.fullscreenEnabled}>
      <button id="fullscreen-toggle" class="header-button" aria-pressed={active()} onClick={() => { void toggle(); }}>
        {active() ? 'Salir de pantalla completa' : 'Pantalla completa'}
      </button>
    </Show>
  );
}
