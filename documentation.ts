// Original build-time documentation. Values come from the executable model;
// prose describes those values without supplying a second set of defaults.
import { CATALOG, initialConfig } from './configuration';
import { displayNumber } from './format';
import { PARAMETERS, readableCondition } from './guide-content';
import { manualReference, manualUrl } from './manuals';
import { estimateMotorCircuit, MOTOR_CIRCUIT_RANGES } from './motor-circuit';
import { MAX_ELECTRICAL_STEP } from './motor-dynamics';
import { DC_LINK_DEFAULTS } from './dc-link';
import { CURRENT_LIMITER_GAINS, DC_CURRENT_BANDWIDTH } from './drive-control';
import { SHAFT_BRAKE_TORQUE_MULTIPLE } from './shaft-brake';
import { PLANT_ASSUMPTIONS } from './physical-plant';
import { VFDDrive, CONTROL_MODEL, THERMAL_MODEL } from './engine';
import { SCOPE_HISTORY_DEFAULTS } from './scope-history';
import { SCOPE_TREND_WINDOW } from './scope-trends';

export const DOCUMENTATION_REFERENCES = [
  'https://ocw.mit.edu/courses/6-685-electric-machines-fall-2013/d834469bd6c3f56c6bec451d76176156_MIT6_685F13_chapter10.pdf',
  'https://www.ti.com/lit/ug/tiduf73/tiduf73.pdf',
  'https://library.e.abb.com/public/20be376000f34dd6b9c513580cf56423/Technical_guide_No_8_3AFE64362534_RevC.pdf',
  'https://imperix.com/doc/implementation/pi-controller',
  'https://imperix.com/doc/implementation/vf-control-induction-machine',
  'https://www.mathworks.com/help/mcb/ref/inductionmotor.html',
  'https://opendss.epri.com/Properties8.html',
  'https://www.iitg.ac.in/cseweb/vlab/virtual-electrical-machine/Theory_blockr.html',
] as const;
export const DOCUMENTATION_PAGE = 'Documentación del simulador.html';
export const LIMITATIONS_PAGE = 'Limitaciones del modelo.html';
const escape = (value: unknown): string => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
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
  group('control', 'Supuestos del control didáctico', CONTROL_MODEL, {
    torqueMeasurementSeconds: ['Filtrado del par usado para compensar deslizamiento', 's'],
    irCompensationReference: ['UFr correspondiente a compensación resistiva completa', ''],
    twoKHzThresholdHz: ['Frecuencia de salida para pasar de 2 a 4 kHz', 'Hz'],
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
  group('history', 'Registro del osciloscopio', { ...SCOPE_HISTORY_DEFAULTS, trendWindow: SCOPE_TREND_WINDOW }, {
    duration: ['Historia conservada', 's'], sampleInterval: ['Intervalo de almacenamiento', 's'],
    trendWindow: ['Ventana causal para valores eficaces y medios mostrados', 's'],
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
    return `<tr data-model-fact="${g.id}.${key}"><td>${escape(description[0])}</td><td>${value === null ? 'Sin conexión' : displayNumber(value)}</td><td>${escape(description[1]).replaceAll('^2', '<sup>2</sup>')}</td></tr>`;
  }).join('')}</tbody></table>`).join('');
}
function catalogTable(): string {
  const rows = CATALOG.map(item => {
    const reference = manualReference(item.source);
    const range = item.kind === 'monitor' ? 'Lectura' : item.kind === 'choice'
      ? item.choices.map(value => typeof value === 'number' ? displayNumber(value) : value).join(', ')
      : displayNumber(item.min) + ' a ' + displayNumber(item.max) + (item.unit ? ' ' + item.unit : '');
    const details = [item.label, PARAMETERS[item.id]?.text];
    if (item.condition) details.push('Aparece si ' + readableCondition(item.condition));
    if (item.kind !== 'monitor') details.push('Edición en marcha: ' + (item.runEditable ? 'sí' : 'no'));
    const initial = item.kind === 'monitor' ? ''
      : typeof item.default === 'number' ? displayNumber(item.default) : item.default;
    return `<tr data-parameter="${escape(item.id)}">
      <td><code>${escape(item.id)}</code></td>
      <td>${details.filter(Boolean).map(value => '<p>' + escape(value) + '</p>').join('')}</td>
      <td>${escape(range)}</td><td>${escape(initial)}</td>
      <td><a href="${escape(reference.url)}">${escape(reference.label)}</a></td></tr>`;
  }).join('');
  return `<table id="catalog-table"><thead><tr><th>Ruta</th><th>Función y condición</th>
    <th>Opciones o intervalo</th><th>Inicial</th><th>Fuente</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function circuitFit(): string {
  const config = initialConfig(), fit = estimateMotorCircuit(config.motor);
  const labels = {
    ratedTorque: 'Par nominal, N m', ratedCurrent: 'Corriente nominal, A', powerFactor: 'Factor de potencia',
    noLoadCurrent: 'Corriente en vacío supuesta, A', lockedCurrent: 'Corriente de rotor detenido supuesta, A',
    breakdownSlip: 'Deslizamiento de par máximo supuesto, fracción de la velocidad síncrona',
  };
  const rows = Object.entries(fit.fits).map(([key, value]) => `<tr data-fit="${key}">
    <td>${escape(labels[key as keyof typeof labels])}</td><td>${displayNumber(value.target)}</td>
    <td>${displayNumber(value.achieved)}</td><td>${displayNumber(value.relativeError * 100)} %</td></tr>`).join('');
  const parameters = Object.entries(fit.parameters).map(([key, value]) => {
    const inductance = key.startsWith('L'), scale = inductance ? 1000 : 1, unit = inductance ? 'mH' : 'ohm';
    const range = MOTOR_CIRCUIT_RANGES[key as keyof typeof MOTOR_CIRCUIT_RANGES];
    return `<tr><td>${key}</td><td>${displayNumber(value * scale)} ${unit}</td>
      <td>${range.map(limit => displayNumber(limit * scale)).join(' a ')} ${unit}</td></tr>`;
  }).join('');
  const lossLabels: { [K in keyof typeof fit.lossBalance]: Description } = {
    inputPower: ['Potencia eléctrica de entrada', 'W'], shaftPower: ['Potencia mecánica convertida', 'W'],
    airGapPower: ['Potencia de entrehierro', 'W'], statorCopperLoss: ['Pérdida resistiva efectiva de estator', 'W'],
    rotorCopperLoss: ['Pérdida resistiva de rotor', 'W'], efficiency: ['Rendimiento del circuito supuesto', '%'],
    residual: ['Residuo del balance de potencia', 'W'],
  };
  const losses = Object.entries(fit.lossBalance).map(([key, value]) => {
    const [label, unit] = lossLabels[key as keyof typeof lossLabels];
    const shown = key === 'efficiency' ? value * 100 : value;
    return `<tr data-loss-balance="${key}"><td>${label}</td><td>${displayNumber(shown)}</td><td>${unit}</td></tr>`;
  }).join('');
  const plate = config.motor;
  return `<p>Motor de ejemplo: ${displayNumber(plate.powerKW)} kW, ${displayNumber(plate.voltage)} V,
    ${displayNumber(plate.frequency)} Hz, ${displayNumber(plate.current)} A, ${displayNumber(plate.speedRPM)} rpm,
    ${displayNumber(plate.poles)} polos y coseno de fi ${displayNumber(plate.cosPhi)}.
    Los valores siguientes corresponden al circuito estimado a tensión nominal, sin el control del variador.
    Su par máximo calculado es ${displayNumber(fit.breakdown.torque)} N m,
    ${displayNumber(fit.breakdown.torque / fit.rated.torque)} veces el nominal.</p>
    <table><thead><tr><th>Magnitud</th><th>Objetivo</th><th>Resultado del circuito</th><th>Error relativo</th></tr></thead>
    <tbody>${rows}</tbody></table><table><thead><tr><th>Parámetro por fase</th><th>Estimación inicial</th>
    <th>Intervalo manual admitido</th></tr></thead><tbody>${parameters}</tbody></table>
    <table><thead><tr><th>Balance nominal del circuito</th><th>Valor</th><th>Unidad</th></tr></thead>
    <tbody>${losses}</tbody></table>`;
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
