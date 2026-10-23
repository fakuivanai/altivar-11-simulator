// Original build-time documentation. Values come from the executable model;
// prose describes those values without supplying a second set of defaults.
import { CATALOG, initialConfig } from './configuration';
import { manualReference, manualUrl } from './manuals';
import { estimateMotorCircuit, MOTOR_CIRCUIT_RANGES } from './motor-circuit';
import { MAX_ELECTRICAL_STEP } from './motor-dynamics';
import { DC_LINK_DEFAULTS } from './dc-link';
import { CURRENT_LIMITER_GAINS, DC_CURRENT_BANDWIDTH } from './drive-control';
import { SHAFT_BRAKE_TORQUE_MULTIPLE } from './shaft-brake';
import { PLANT_ASSUMPTIONS } from './physical-plant';
import { VFDDrive, THERMAL_MODEL } from './engine';
import { SCOPE_HISTORY_DEFAULTS } from './scope-history';

export const DOCUMENTATION_REFERENCES = [
  'https://ocw.mit.edu/courses/6-685-electric-machines-fall-2013/d834469bd6c3f56c6bec451d76176156_MIT6_685F13_chapter10.pdf',
  'https://www.ti.com/lit/ug/tiduf73/tiduf73.pdf',
  'https://library.e.abb.com/public/20be376000f34dd6b9c513580cf56423/Technical_guide_No_8_3AFE64362534_RevC.pdf',
  'https://imperix.com/doc/implementation/pi-controller',
  'https://www.mathworks.com/help/mcb/ref/inductionmotor.html',
] as const;
export const DOCUMENTATION_PAGE = 'Documentación del simulador.html';
export const LIMITATIONS_PAGE = 'Limitaciones del modelo.html';
const escape = (value: unknown): string => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const number = (value: number): string => Number(value.toPrecision(6)).toLocaleString('es-AR', { maximumSignificantDigits: 6, useGrouping: false });
type Description = readonly [label: string, unit: string];
function group<T extends Record<string, number | null>>(id: string, label: string, source: T,
  descriptions: { readonly [K in keyof T]: Description }) {
  return { id, label, source, descriptions };
}
// Mapped descriptions make an added component/gain/time constant a type error
// until it has a documented meaning. Unit tests independently check key coverage.
export const MODEL_FACT_GROUPS = [
  group('bench', 'Carga inicial del banco, elegida para los umbrales de fábrica a 25 y 50 Hz', { ...initialConfig().mechanical }, {
    torque: ['Par resistente inicial', 'N m'], friction: ['Fricción viscosa', 'N m s/rad'], inertia: ['Inercia añadida', 'kg m^2'],
  }),
  group('bus', 'Componentes supuestos del enlace de continua', DC_LINK_DEFAULTS, {
    capacitance: ['Capacidad', 'F'], lineFrequency: ['Frecuencia de red', 'Hz'],
    sourceResistance: ['Resistencia serie de la fuente', 'ohm'], prechargeResistance: ['Resistencia adicional de precarga', 'ohm'],
    prechargeSeconds: ['Tiempo mínimo antes del puenteo', 's'], prechargeFraction: ['Fracción del pico necesaria para puentear', ''],
    bleedResistance: ['Resistencia de descarga', 'ohm'], brakeResistance: ['Resistencia de frenado opcional', 'ohm'],
    brakeOnVoltage: ['Conexión de la resistencia de frenado', 'V'], brakeOffVoltage: ['Desconexión de la resistencia de frenado', 'V'],
  }),
  group('ac', 'Ganancias elegidas para limitar corriente de alterna', CURRENT_LIMITER_GAINS, {
    proportional: ['Ganancia proporcional, error normalizado', ''], integral: ['Ganancia integral, error normalizado', '1/s'],
  }),
  group('thermal', 'Modelo térmico de enseñanza', THERMAL_MODEL, {
    motorSeconds: ['Constante térmica del motor', 's'], driveSeconds: ['Constante térmica del variador', 's'],
    tripPercent: ['Disparo OLF y OHF, manual técnico pág. 84', '%'], motorResetPercent: ['Rearme OLF por debajo de', '%'],
    driveResetPercent: ['Rearme OHF por debajo de', '%'], memoryResetSeconds: ['Desconexión que borra la memoria térmica calculada', 's'],
  }),
  group('plant', 'Acoplamiento y medición', PLANT_ASSUMPTIONS, {
    boardPower: ['Consumo supuesto de la placa de control', 'W'], boardStartVoltage: ['Bus mínimo para ese consumo', 'V'],
    currentMeasurementSeconds: ['Constante de la envolvente de corriente al cuadrado', 's'], sampleInterval: ['Intervalo del registro físico', 's'],
    energyReserveFraction: ['Fracción reservada de la energía del condensador', ''],
  }),
  group('history', 'Registro del osciloscopio', SCOPE_HISTORY_DEFAULTS, {
    duration: ['Historia conservada', 's'], sampleInterval: ['Intervalo de almacenamiento', 's'],
  }),
  group('timing', 'Integración y otros ajustes del modelo', {
    electricalStep: MAX_ELECTRICAL_STEP, controlStep: VFDDrive.FIXED_STEP,
    nominalDriveCurrent: VFDDrive.DRIVE_CURRENT, shaftBrakeMultiple: SHAFT_BRAKE_TORQUE_MULTIPLE,
    injectionBandwidth: DC_CURRENT_BANDWIDTH,
  }, {
    electricalStep: ['Paso eléctrico máximo', 's'], controlStep: ['Paso de mando y protecciones', 's'],
    nominalDriveCurrent: ['Corriente nominal del variador, manual técnico pág. 69', 'A'],
    shaftBrakeMultiple: ['Capacidad de la retención respecto del par nominal', ''],
    injectionBandwidth: ['Ancho de banda elegido para la inyección de continua', 'rad/s'],
  }),
];
function modelFacts(): string {
  return MODEL_FACT_GROUPS.map(g => `<h3>${escape(g.label)}</h3><table data-model-group="${g.id}"><thead><tr><th>Magnitud</th><th>Valor</th><th>Unidad</th></tr></thead><tbody>${Object.entries(g.source).map(([key, value]) => {
    const description = (g.descriptions as Record<string, Description>)[key]!;
    return `<tr data-model-fact="${g.id}.${key}"><td>${escape(description[0])}</td><td>${value === null ? 'Sin conexión' : number(value)}</td><td>${escape(description[1]).replaceAll('^2', '<sup>2</sup>')}</td></tr>`;
  }).join('')}</tbody></table>`).join('');
}
function catalogTable(): string {
  return `<table id="catalog-table"><thead><tr><th>Ruta</th><th>Función y condición</th><th>Opciones o intervalo</th><th>Inicial</th><th>Fuente</th></tr></thead><tbody>${CATALOG.map(item => {
    const reference = manualReference(item.source);
    const range = item.kind === 'monitor' ? 'Lectura' : item.kind === 'choice'
      ? item.choices.join(', ') : number(item.min) + ' a ' + number(item.max) + (item.unit ? ' ' + item.unit : '');
    const details = [item.label, item.condition ? 'Visible: ' + item.condition : '', item.kind !== 'monitor' ? 'Edición en marcha: ' + (item.runEditable ? 'sí' : 'no') : '', item.note ?? ''].filter(Boolean);
    return `<tr data-parameter="${escape(item.id)}"><td><code>${escape(item.id)}</code></td><td>${details.map(escape).join('. ')}</td><td>${escape(range)}</td><td>${item.kind === 'monitor' ? '' : escape(item.default)}</td><td><a href="${escape(reference.url)}">${escape(reference.label)}</a></td></tr>`;
  }).join('')}</tbody></table>`;
}
function circuitFit(): string {
  const config = initialConfig(), fit = estimateMotorCircuit(config.motor);
  const labels = { ratedTorque: 'Par nominal, N m', ratedCurrent: 'Corriente nominal, A', powerFactor: 'Factor de potencia',
    noLoadCurrent: 'Corriente en vacío supuesta, A', lockedCurrent: 'Corriente de rotor detenido supuesta, A', breakdownSlip: 'Deslizamiento de par máximo supuesto, fracción de la velocidad síncrona' };
  const rows = Object.entries(fit.fits).map(([key, value]) => `<tr data-fit="${key}"><td>${escape(labels[key as keyof typeof labels])}</td><td>${number(value.target)}</td><td>${number(value.achieved)}</td><td>${number(value.relativeError * 100)} %</td></tr>`).join('');
  return `<p>Motor de ejemplo: ${number(config.motor.powerKW)} kW, ${config.motor.voltage} V, ${config.motor.frequency} Hz, ${number(config.motor.current)} A, ${config.motor.speedRPM} rpm, ${config.motor.poles} polos y coseno de fi ${number(config.motor.cosPhi)}. Los valores siguientes corresponden al circuito estimado y tensión nominal, sin el control del variador.</p><table><thead><tr><th>Magnitud</th><th>Objetivo</th><th>Resultado del circuito</th><th>Error relativo</th></tr></thead><tbody>${rows}</tbody></table><table><thead><tr><th>Parámetro por fase</th><th>Estimación inicial</th><th>Intervalo manual admitido</th></tr></thead><tbody>${Object.entries(fit.parameters).map(([key, value]) => `<tr><td>${key}</td><td>${number(value)} ${key.startsWith('L') ? 'H' : 'ohm'}</td><td>${MOTOR_CIRCUIT_RANGES[key as keyof typeof MOTOR_CIRCUIT_RANGES].map(number).join(' a ')}</td></tr>`).join('')}</tbody></table>`;
}
function manualLinks(): string {
  return `<ul><li><a href="${escape(manualUrl('user'))}">Manual oficial, sección española desde página PDF 53, impresa 52</a>. Panel: impresa 56. Motor: 59. Funciones: 60 a 64. Supervisión y fallos: 65 a 67.</li><li><a href="${escape(manualUrl('technical'))}">Referencia técnica oficial en inglés</a>. Corriente nominal: impresa 69. Protección térmica: 84. PI: 102 a 107. Corriente y rampas: 109. Inyección y conmutación: 111. Rearranque: 115. Fallos: 121 y 122. Para el visor PDF se resta 63 a la página impresa.</li></ul><p>Los enlaces de consulta requieren internet. El proyecto conserva las referencias y las correspondencias de páginas; los PDF se descargan del fabricante.</p>`;
}
export function renderDocumentation(template: string): string {
  let html = template;
  for (const [marker, value] of Object.entries({ CATALOG_TABLE: catalogTable(), MODEL_FACTS: modelFacts(), CIRCUIT_FIT: circuitFit(), MANUAL_LINKS: manualLinks() })) {
    const token = '{{' + marker + '}}';
    if (html.split(token).length !== 2) throw new Error('Missing or repeated documentation marker: ' + token);
    html = html.replace(token, () => value);
  }
  if (/\{\{[^}]+\}\}/.test(html)) throw new Error('Unknown documentation marker.');
  return html;
}
