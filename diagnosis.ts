// Live explanations derived from the configuration and the model's readings.
import type { Configuration } from './configuration';
import { PHASES } from './engine-types';
import type { DriveState, LogicInputAssignment } from './engine-types';

export type DiagnosisLine = [level: '' | 'warn' | 'bad', text: string];

/** Original study aid. Direction and reference come from the engine's actual
 * latch and PI state, rather than being reconstructed from a momentary contact.
 * Selection rules: user pp.60-62; technical pp.102-103,107. */
export function diagnosisLines(config: Configuration, current: Readonly<Omit<DriveState, 'angle'>>): DiagnosisLine[] {
  const p = config.parameters, inputs = config.inputs;
  const lines: DiagnosisLine[] = [];
  const add = (text: string, level: DiagnosisLine[0] = ''): void => { lines.push([level, text]); };
  const on = (assignment: LogicInputAssignment): boolean => assignment !== 'nO' && inputs[assignment];
  if (!inputs.powered) { add('Sin tensión de red.', 'bad'); return lines; }
  if (current.fault) add('El variador está bloqueado por la falla ' + current.fault + '. Elimine la causa y rearme antes de dar marcha.', 'bad');
  const twoWire = p['FUn.tCC.ACt'] === '2C';
  const forward = twoWire ? 'LI1' : 'LI2', reverse = p['FUn.rrS'];
  const command = inputs[forward] || on(reverse);
  if (!twoWire && !inputs.LI1) add('Mando de 3 hilos: LI1 es la parada y debe estar cerrada para poder arrancar.', 'warn');
  const nst = p['FUn.nSt'];
  if (nst !== 'nO' && !inputs[nst]) add(`Parada en rueda libre asignada a ${nst}, que está abierta: el motor queda sin alimentación.`, 'warn');
  if (!current.fault && !current.running && current.status !== 'dcb') {
    if (!command && current.direction === 0) add(twoWire
      ? `Sin orden de marcha. Cierre ${forward} (adelante)${reverse !== 'nO' ? ' o ' + reverse + ' (atrás)' : ''}.`
      : 'Sin orden de marcha. Con LI1 cerrada, dé un pulso en LI2 para marcha adelante.');
    else if (!current.armed) add(`Las órdenes de marcha deben volver a 0 antes de dar una nueva orden. Abra ${forward}${reverse !== 'nO' ? ' y ' + reverse : ''} y vuelva a accionar la entrada del sentido deseado.`, 'warn');
    else if (current.FrH <= p.LSP + .001 && p['FUn.tLS'] > 0) add('Puede haber actuado la parada por tiempo en LSP. Para reanudar, la referencia debe superar LSP; con PI también debe cumplirse rSL.', 'warn');
  }
  if (current.running) {
    const direction = current.direction || Math.sign(current.frequency);
    add((current.direction === 0 ? 'Desacelerando ' : 'En marcha ') + (direction < 0 ? 'atrás' : 'adelante')
      + `: consigna ${current.FrH.toFixed(1)} Hz, salida ${current.rFr.toFixed(1)} Hz.`);
    const lia = p['FUn.PS2.LIA'], lib = p['FUn.PS2.LIb'], a = on(lia), b = on(lib);
    const maximumA = on(p['FUn.HSP.LIA']), maximumB = on(p['FUn.HSP.LIb']);
    const maximumCode = maximumA && maximumB ? 'HS4' : maximumB ? 'HS3' : maximumA ? 'HS2' : 'HSP';
    if (maximumCode !== 'HSP') add(`Velocidad máxima seleccionada ${maximumCode} = ${current.activeHighSpeed} Hz. HSU muestra este límite.`);
    const pi = p['FUn.PI.PIF'] === 'AI1';
    if (pi) {
      if (current.piActive) {
        const pr2 = on(p['FUn.PI.Pr2']), pr4 = on(p['FUn.PI.Pr4']);
        const reference = pr2 && pr4 ? 'PI3' : pr4 ? 'PI4' : pr2 ? 'PI2' : 'rPI';
        add(`Regulación PI automática: referencia ${reference} = ${current.piReference.toFixed(1)} %, realimentación AI1 escalada por FbS = ${current.piFeedback.toFixed(1)} %. El PI calcula la consigna de velocidad.`);
      } else add(`PI en manual: la velocidad la fija ${b ? 'SP4' : 'SP2'},${b ? ' con LIb de PS2 activa,' : ''} y AI1 sigue siendo la realimentación del proceso.`);
    } else if (a || b) add(`Velocidad preseleccionada ${a && b ? 'SP4' : a ? 'SP2' : 'SP3'} por ${[a ? lia : '', b ? lib : ''].filter(Boolean).join(' y ')}, en lugar de la referencia analógica. El límite vigente es ${maximumCode} = ${current.activeHighSpeed} Hz.`);
    else add(`Consigna por AI1: el mando de la señal está al ${inputs.analogPosition} % del recorrido. AIt convierte esa señal y la escala entre LSP = ${p.LSP} Hz y ${maximumCode} = ${current.activeHighSpeed} Hz; una escala AIt distinta de la señal física cambia la consigna.`);
    const gap = current.reference - current.rampFrequency;
    if (Math.abs(gap) > .3) {
      const second = on(p['FUn.rP2.LI']);
      const accelerating = Math.abs(current.reference) > Math.abs(current.rampFrequency)
        && current.reference * current.rampFrequency >= 0;
      const time = accelerating ? (second ? p['FUn.rP2.AC2'] : p.ACC) : (second ? p['FUn.rP2.dE2'] : p.dEC);
      add(`${accelerating ? 'Aceleración' : 'Desaceleración'} solicitada por rampa: ${time} s para un cambio de ${p['drC.FrS']} Hz${second ? ' con la segunda rampa' : ''}. El límite de corriente y la adaptación de frenado pueden alargarla.`);
    }
    if (current.FrH < .05 && p.LSP === 0) add(pi
      ? 'Consigna de velocidad nula: revise la referencia, la realimentación y el modo manual o automático del PI.'
      : a || b ? 'Consigna nula: revise la velocidad preseleccionada activa.' : 'Consigna nula: revise la señal AI1 y su escala, o ajuste LSP.', 'warn');
  }
  if (current.currentLimited) add(`Límite de corriente activo: ${current.activeCurrentLimit} A. Puede impedir que la salida siga la rampa.`, 'warn');
  const open = PHASES.filter(phase => !inputs.outputConnections[phase]);
  if (open.length === 1) add(`Conductor ${open[0]} abierto. En este modelo el motor queda alimentado por dos conductores, pierde par y no arranca solo desde reposo. Las corrientes quedan desequilibradas. Los manuales consultados no incluyen una falla OPF; pueden actuar el límite de corriente y la protección térmica.`, 'warn');
  else if (open.length > 1) add('Dos o más conductores abiertos: no hay un circuito cerrado para la corriente del motor.', 'warn');
  if (inputs.shortCircuit) add(current.fault === 'SCF' ? 'El corto U-V sigue puesto. Quítelo antes de rearmar.' : 'Corto U-V en la salida del variador, antes de los contactos del motor. Al energizar la salida, el modelo disparará SCF.', 'bad');
  if (inputs.shaftHeld) add(current.running || current.status === 'dcb'
    ? 'Eje retenido: el motor no gira. Con salida energizada puede aumentar la corriente y el calentamiento.'
    : 'Eje retenido mecánicamente. Sin salida energizada, retenerlo no produce corriente en el motor.', 'warn');
  if (current.regenerativePower > 20) add(`El motor devuelve ${current.regenerativePower.toFixed(0)} W al bus de continua (${current.dcBus.toFixed(0)} V).${inputs.brakeModule ? ' El módulo disipa energía hasta su capacidad de frenado.' : p['FUn.brA'] === 'YES' ? ' brA adapta la rampa para limitar la tensión.' : ' Sin módulo ni brA, puede disparar ObF.'}`, 'warn');
  if (current.tHr > 90) add(`Estado térmico calculado del motor ${current.tHr.toFixed(0)} %: OLF actúa por encima de 118 %.`, 'warn');
  if (current.tHd > 90) add(`Estado térmico del variador ${current.tHd.toFixed(0)} %: OHF actúa por encima de 118 %.`, 'warn');
  if (current.status === 'dcb') add(`Inyección de continua: SdC programa ${p['FUn.AdC.SdC']} A ${p['FUn.AdC.ACt'] === 'Ct' ? 'en forma permanente' : 'durante ' + p['FUn.AdC.tdC'] + ' s'}. El límite de corriente y las conexiones determinan la corriente efectiva.`);
  if (!lines.length) add('Listo para arrancar.');
  return lines;
}
