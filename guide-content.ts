// Study texts for the learning page. They paraphrase the manufacturer's user guide
// (Spanish section, printed pages 52 to 67) and the technical manual (pages 98 to 122);
// see Fuentes.md. Notes marked as simulator behaviour describe this model, not the drive.
import type { FaultCode } from './engine-types';

export interface MenuText { name: string; text: string }
export interface ParameterText {
  /** What the parameter does. */
  text: string;
  /** Meaning of each option, by stored value. */
  choices?: Readonly<Record<string, string>>;
  /** Practical advice or what to watch in the simulator. */
  tip?: string;
}
export interface FaultText {
  name: string;
  /** What the drive detects. */
  detects: string;
  /** What produces it in this simulator. */
  simulator: string;
  /** Manufacturer's remedies. */
  remedies: readonly string[];
  /** Resettable by an rSF logic input. */
  logicReset: boolean;
  /** Resettable by automatic restart Atr. */
  autoReset: boolean;
}

const LI_CHOICES = {
  nO: 'Función sin asignar.',
  LI1: 'Asignada a la entrada LI1.', LI2: 'Asignada a la entrada LI2.',
  LI3: 'Asignada a la entrada LI3.', LI4: 'Asignada a la entrada LI4.',
} as const;
const YES_NO = { nO: 'Función inactiva.', YES: 'Función activa.' } as const;

export const MENUS: Readonly<Record<string, MenuText>> = {
  '': { name: 'Primer nivel', text: 'Ajustes de uso diario: rampas, velocidades mínima y máxima, protección térmica y velocidades preseleccionadas. Desde aquí se entra a los menús AIt, drC, FUn y SUP.' },
  AIt: { name: 'Entrada analógica', text: 'Define qué señal espera el borne AI1: tensión de 0 a 5 V o de 0 a 10 V, o corriente de 0 a 20 mA, de 4 a 20 mA o un rango personalizado. Sólo se modifica con el variador parado.' },
  drC: { name: 'Control del motor', text: 'Datos de la placa del motor y ajustes del lazo de control: tensión, frecuencia y corriente nominales, deslizamiento, factor de potencia, compensaciones y límite de corriente. Con los datos de placa correctos el variador controla mejor el par.' },
  FUn: { name: 'Funciones de aplicación', text: 'Funciones que se asignan a las entradas lógicas y comportamientos especiales: tipo de mando, marcha inversa, velocidades preseleccionadas, segunda rampa, regulador PI, inyección de continua, frecuencia de conmutación, salida DO, rearranque y memoria de configuración.' },
  SUP: { name: 'Supervisión', text: 'Valores de lectura: consigna, frecuencia de salida, corriente, tensión de red y estados térmicos. El valor que se confirma con ENT queda como lectura en marcha. También contiene el código de bloqueo COd.' },
  'FUn.tCC': { name: 'Tipo de control', text: 'Elige entre mando de 2 hilos, por nivel o transición, y de 3 hilos, con pulsos de marcha y una entrada de parada normalmente cerrada. Cambiarlo restablece varias asignaciones de entradas.' },
  'FUn.PS2': { name: 'Velocidades preseleccionadas', text: 'Dos entradas, LIA y LIb, eligen entre la consigna de AI1 y tres velocidades fijas: LIA sola elige SP2, LIb sola SP3 y ambas SP4.' },
  'FUn.HSP': { name: 'Velocidades máximas', text: 'Igual que las preseleccionadas, pero para el límite superior: dos entradas eligen entre HSP, HS2, HS3 y HS4.' },
  'FUn.PI': { name: 'Regulador PI', text: 'Regulación de una magnitud de proceso (presión, caudal, nivel) con la realimentación en AI1. El variador ajusta la velocidad para que la realimentación siga a la referencia interna.' },
  'FUn.rP2': { name: 'Segunda rampa', text: 'Una entrada lógica conmuta a otro par de tiempos de aceleración y desaceleración, AC2 y dE2.' },
  'FUn.LC2': { name: 'Segundo límite de corriente', text: 'Una entrada lógica conmuta el límite de corriente de CLI a CL2.' },
  'FUn.AdC': { name: 'Inyección automática de continua', text: 'Al detenerse el motor, el variador inyecta corriente continua para retenerlo, durante un tiempo o en forma permanente.' },
  'FUn.SFt': { name: 'Frecuencia de corte', text: 'Frecuencia de conmutación del inversor. Más alta reduce el ruido del motor pero calienta más al variador.' },
  'FUn.dO': { name: 'Salida DO', text: 'Asigna la salida DO como señal analógica (corriente o frecuencia) o como señal lógica (umbral de frecuencia o de corriente alcanzado, consigna alcanzada).' },
};

export const PARAMETERS: Readonly<Record<string, ParameterText>> = {
  bFr: { text: 'Frecuencia nominal del motor, 50 o 60 Hz, según su placa. Fija los valores iniciales de FrS, HSP y los umbrales relacionados. En el primer nivel aparece sólo en la primera puesta en tensión; luego queda en FUn.', choices: { '50': '50 Hz, ajuste de fábrica de la gama E.', '60': '60 Hz, ajuste de fábrica de la gama U.' } },
  ACC: { text: 'Tiempo que tarda la rampa en ir de 0 Hz a la frecuencia nominal FrS. No es el tiempo hasta la consigna: con consigna menor que FrS la rampa termina antes.', tip: 'Con mucha inercia y ACC corto el variador entra en límite de corriente y la aceleración real se alarga.' },
  dEC: { text: 'Tiempo que tarda la rampa en ir de FrS a 0 Hz. Al frenar, el motor devuelve energía al bus de continua.', tip: 'Con mucha inercia y dEC corto sube el bus de continua. Si brA está en YES, el variador alarga la rampa; si no, puede disparar ObF.' },
  LSP: { text: 'Frecuencia con referencia analógica mínima. La señal analógica se escala entre LSP y la velocidad máxima seleccionada. Las velocidades preseleccionadas se programan por separado.' },
  HSP: { text: 'Frecuencia con consigna máxima. Debe ser adecuada para el motor y la máquina.' },
  ItH: { text: 'Corriente que usa la protección térmica del motor. Se ajusta a la corriente nominal de la placa del motor. La memoria térmica calculada se reinicia al quitar la alimentación.', tip: 'Si ItH es mayor que la corriente nominal real del motor, la protección actúa tarde. Reiniciar esa memoria no enfría el motor. El modelo conserva por separado el calentamiento físico estimado.' },
  SP2: { text: 'Segunda velocidad preseleccionada. Se usa cuando LIA está en 1 y LIb en 0.' },
  SP3: { text: 'Tercera velocidad preseleccionada. Se usa cuando LIA está en 0 y LIb en 1.' },
  SP4: { text: 'Cuarta velocidad preseleccionada. Se usa cuando LIA y LIb están en 1.' },
  'AIt.ACt': { text: 'Tipo de señal conectada a AI1.', choices: { '5U': 'Tensión de 0 a 5 V, con el potenciómetro alimentado por +5V del variador.', '10U': 'Tensión de 0 a 10 V, con fuente externa.', '0A': 'Corriente de 0 a 20 mA.', '4A': 'Corriente de 4 a 20 mA.', CUS: 'Corriente de CrL a CrH mA, rango personalizado.' }, tip: 'En el simulador la señal aplicada se elige debajo del potenciómetro. Si no coincide con ACt, la consigna resultante es otra.' },
  'AIt.CrL': { text: 'Corriente que corresponde a consigna mínima cuando ACt = CUS. Debe ser menor que CrH.' },
  'AIt.CrH': { text: 'Corriente que corresponde a consigna máxima cuando ACt = CUS. Debe ser mayor que CrL.' },
  'drC.UnS': { text: 'Tensión nominal de la placa del motor. Si la red es menor que la de placa, se ajusta a la tensión de red.' },
  'drC.FrS': { text: 'Frecuencia nominal de la placa del motor. Junto con UnS define la relación tensión y frecuencia.' },
  'drC.StA': { text: 'Estabilidad del lazo de frecuencia. Muy alto alarga la respuesta; muy bajo produce sobrepaso de velocidad e inestabilidad.', tip: 'StA o FLG en 0 cambian el perfil a control V/f. El modelo reproduce este cambio con una aproximación del control del motor.' },
  'drC.FLG': { text: 'Ganancia del lazo de frecuencia. Muy alta produce sobrepaso e inestabilidad; muy baja alarga la respuesta.' },
  'drC.UFr': { text: 'Compensación de la caída resistiva del estator. Mejora el par a muy baja velocidad. Si falta par al arrancar, se aumenta; demasiado alto puede bloquear el arranque o llevar al límite de corriente.' },
  'drC.nCr': { text: 'Corriente nominal de la placa del motor.' },
  'drC.CLI': { text: 'Corriente máxima que entrega el variador. Al alcanzarla, el variador deja de acelerar o reduce la frecuencia para no superarla.', tip: 'Bloquee el eje con el variador en marcha para ver el límite de corriente en las lecturas.' },
  'drC.nSL': { text: 'Deslizamiento nominal del motor: FrS por (1 menos velocidad nominal sobre velocidad de sincronismo). Lo usa la compensación de deslizamiento.', tip: 'Ejemplo: 4 polos, 50 Hz, 1420 rpm: 50 x (1 - 1420/1500) = 2,7 Hz.' },
  'drC.SLP': { text: 'Ajuste fino de la compensación de deslizamiento alrededor de nSL. Se baja si hay inestabilidad y se sube si la velocidad bajo carga queda corta.', tip: 'Compare las rpm con carga y sin carga variando SLP.' },
  'drC.COS': { text: 'Factor de potencia nominal de la placa del motor.' },
  'FUn.tCC.ACt': { text: 'Forma de dar marcha y parada. Para cambiarlo hay que mantener ENT 2 s; vuelven a sus valores iniciales rrS, tCt, Atr y las entradas de PS2.', choices: { '2C': 'Dos hilos: la entrada cerrada da marcha y abierta, parada. LI1 adelante, otra LI atrás.', '3C': 'Tres hilos: LI1 es parada (normalmente cerrada) y un pulso en LI2 da marcha adelante; otra LI da marcha atrás.' } },
  'FUn.tCC.tCt': { text: 'Cómo se interpreta la entrada de marcha en dos hilos.', choices: { LEL: 'Por nivel: con la entrada en 1 el variador marcha, incluso al volver la red.', trn: 'Por transición: hace falta un cambio de 0 a 1 para arrancar. Evita un arranque imprevisto al volver la alimentación.', PFO: 'Por nivel, con prioridad de la marcha adelante sobre la marcha atrás.' }, tip: 'Con trn, si LI1 ya estaba cerrada al dar tensión, el motor no arranca hasta abrirla y cerrarla.' },
  'FUn.rrS': { text: 'Entrada que ordena giro atrás.', choices: LI_CHOICES },
  'FUn.PS2.LIA': { text: 'Entrada A de las velocidades preseleccionadas.', choices: LI_CHOICES },
  'FUn.PS2.LIb': { text: 'Entrada B de las velocidades preseleccionadas. Sólo puede asignarse con LIA asignada.', choices: LI_CHOICES },
  'FUn.HSP.LIA': { text: 'Entrada A de selección de velocidad máxima.', choices: LI_CHOICES },
  'FUn.HSP.LIb': { text: 'Entrada B de selección de velocidad máxima. Sólo puede asignarse con LIA asignada.', choices: LI_CHOICES },
  'FUn.HSP.HS2': { text: 'Segunda velocidad máxima, con LIA en 1 y LIb en 0.' },
  'FUn.HSP.HS3': { text: 'Tercera velocidad máxima, con LIA en 0 y LIb en 1.' },
  'FUn.HSP.HS4': { text: 'Cuarta velocidad máxima, con LIA y LIb en 1.' },
  'FUn.LOC': { text: 'Umbral de sobrecarga, en porcentaje de la corriente nominal del variador. Si la corriente lo supera durante tOL, el variador dispara OLC.' },
  'FUn.tOL': { text: 'Temporización de sobrecarga. Empieza al superar LOC y se cancela al bajar de LOC menos 10 % de la corriente nominal del variador. Sólo cuenta en régimen estable, con la consigna alcanzada. Cero desactiva la detección.' },
  'FUn.AP1': { text: 'Histéresis de consigna alcanzada durante la marcha con PI activo. El intervalo interior es AP1 menos 0,2 Hz. Se aumenta si el variador no llega a considerar la consigna alcanzada.' },
  'FUn.LUL': { text: 'Umbral de subcarga, en porcentaje de la corriente nominal del variador. Si la corriente queda debajo durante tUL, el variador dispara ULF.', tip: 'Sirve para detectar una correa cortada o una bomba en vacío. Pruebe bajar el par de carga a cero con el motor en marcha.' },
  'FUn.tUL': { text: 'Temporización de subcarga. Empieza al bajar de LUL y se cancela al superar LUL más 10 % de la corriente nominal del variador. Sólo cuenta en régimen estable. Cero desactiva la detección.' },
  'FUn.tLS': { text: 'Tiempo máximo funcionando en LSP. Pasado ese tiempo el motor se detiene, y vuelve a arrancar si la consigna supera LSP con la orden de marcha presente. Cero no limita el tiempo.' },
  'FUn.PI.PIF': { text: 'Realimentación del regulador PI. Asignarla activa la función.', choices: { nO: 'PI inactivo.', AI1: 'PI activo, realimentación en AI1. Se fuerza rrS = nO y LIA de PS2 = LI1.' } },
  'FUn.PI.PII': { text: 'Origen de la referencia del PI. Esta gama usa la referencia interna rPI, o PI2, PI3 y PI4 si se seleccionan por entradas lógicas.', choices: { YES: 'Referencia interna.' } },
  'FUn.PI.rPG': { text: 'Ganancia proporcional. Más alta responde más rápido pero puede oscilar.', tip: 'El fabricante sugiere empezar con la integral al mínimo, ajustar la proporcional y luego subir la integral hasta eliminar el error estable.' },
  'FUn.PI.rIG': { text: 'Ganancia integral. Elimina el error en régimen estable; demasiado alta produce oscilación.' },
  'FUn.PI.FbS': { text: 'Factor que escala la realimentación para que su máximo coincida con el máximo de la referencia.' },
  'FUn.PI.rPI': { text: 'Referencia interna del PI, en porcentaje.' },
  'FUn.PI.PIC': { text: 'Invierte el signo del error del regulador.', choices: { nO: 'Más realimentación reduce la velocidad.', YES: 'Más realimentación aumenta la velocidad.' } },
  'FUn.PI.PAU': { text: 'Entrada que elige manual o automático. Sin asignación funciona en automático. En 1 manda el PI; en 0 la velocidad es SP2, o SP4 si está activa LIb de PS2. AI1 sigue siendo la realimentación, no una consigna manual de velocidad.', choices: LI_CHOICES },
  'FUn.PI.Pr2': { text: 'Entrada que elige entre rPI y la referencia PI2.', choices: LI_CHOICES },
  'FUn.PI.Pr4': { text: 'Segunda entrada para elegir entre cuatro referencias PI. Requiere Pr2 asignada. Pr2 sola elige PI2, ambas entradas PI3 y Pr4 sola PI4.', choices: LI_CHOICES },
  'FUn.PI.PI2': { text: 'Segunda referencia PI preseleccionada.' },
  'FUn.PI.PI3': { text: 'Tercera referencia PI preseleccionada.' },
  'FUn.PI.PI4': { text: 'Cuarta referencia PI preseleccionada.' },
  'FUn.PI.rSL': { text: 'Error mínimo del PI para volver a arrancar después de una parada por tLS. Evita ciclos de arranque y parada.' },
  'FUn.rSF': { text: 'Entrada que rearma una falla con un flanco de 0 a 1, si la causa desapareció. No rearma todas las fallas.', choices: LI_CHOICES },
  'FUn.rP2.LI': { text: 'Entrada que conmuta a la segunda rampa.', choices: LI_CHOICES },
  'FUn.rP2.AC2': { text: 'Tiempo de aceleración de la segunda rampa.' },
  'FUn.rP2.dE2': { text: 'Tiempo de desaceleración de la segunda rampa.' },
  'FUn.LC2.LI': { text: 'Entrada que conmuta el límite de corriente a CL2.', choices: LI_CHOICES },
  'FUn.LC2.CL2': { text: 'Segundo límite de corriente, activo con la entrada en 1.' },
  'FUn.nSt': { text: 'Entrada de parada en rueda libre. La parada se produce cuando la entrada está en 0: el variador corta la alimentación del motor y éste se detiene sólo por el par resistente.', choices: LI_CHOICES, tip: 'Una vez asignada, esa entrada debe estar cerrada para poder arrancar.' },
  'FUn.StP': { text: 'Qué hace el variador si se corta la red con el motor en marcha.', choices: { nO: 'Bloqueo y parada en rueda libre.', FrP: 'Parada siguiendo la rampa, si la inercia alcanza para sostener el bus.', FSt: 'Parada rápida; el tiempo depende de la inercia y del frenado disponible.' } },
  'FUn.brA': { text: 'Adaptación automática de la rampa de desaceleración.', choices: { nO: 'Rampa fija: con mucha inercia puede disparar ObF.', YES: 'Si la rampa es demasiado corta para la inercia, el variador la alarga para evitar la sobretensión.' }, tip: 'Con un módulo de frenado conectado conviene brA = nO.' },
  'FUn.AdC.ACt': { text: 'Inyección de corriente continua al detenerse.', choices: { nO: 'Sin inyección.', YES: 'Inyección durante tdC al llegar a velocidad nula sin orden de marcha.', Ct: 'Inyección permanente mientras no haya orden de marcha.' }, tip: 'Durante la inyección la pantalla muestra dcb. Con mando de 3 hilos sólo actúa mientras LI1 esté cerrada.' },
  'FUn.AdC.tdC': { text: 'Duración de la inyección cuando ACt = YES.' },
  'FUn.AdC.SdC': { text: 'Corriente de inyección.' },
  'FUn.SFt.ACt': { text: 'Rango de frecuencia de conmutación.', choices: { LFr: 'Aleatoria alrededor de 2 o 4 kHz; reparte el ruido acústico.', LF: 'Fija de 2 o 4 kHz.', HF: 'Fija de 8, 12 o 16 kHz. Si el variador se calienta baja sola a la inferior.' } },
  'FUn.SFt.SFr': { text: 'Frecuencia de conmutación. A 2 kHz pasa sola a 4 kHz a alta velocidad.', choices: { '2': '2 kHz.', '4': '4 kHz.', '8': '8 kHz.', '12': '12 kHz.', '16': '16 kHz.' } },
  'FUn.FLr': { text: 'Recuperación al vuelo: al recibir la orden de marcha con el motor girando, arranca desde la velocidad estimada en lugar de cero. Requiere dos hilos con tCt = LEL o PFO y no admite inyección Ct.', choices: YES_NO },
  'FUn.dO.ACt': { text: 'Qué indica la salida DO.', choices: { nO: 'Sin asignar.', OCr: 'Analógica: corriente del motor; señal completa a 2 veces la corriente nominal del variador.', rFr: 'Analógica: frecuencia del motor; señal completa a HSP.', FtA: 'Lógica: 1 si la frecuencia supera Ftd.', SrA: 'Lógica: 1 si la frecuencia alcanzó la consigna.', CtA: 'Lógica: 1 si la corriente supera Ctd.', PI: 'Lógica: 1 con el regulador PI en funcionamiento.' } },
  'FUn.dO.Ftd': { text: 'Umbral de frecuencia para DO = FtA.' },
  'FUn.dO.Ctd': { text: 'Umbral de corriente para DO = CtA.' },
  'FUn.Atr': { text: 'Rearranque automático después de una falla, si la causa desapareció. Reintenta tras 1 s, 5 s, 10 s y luego cada minuto; si a los 6 minutos no arrancó, queda bloqueado hasta cortar la red. Sólo con dos hilos y tCt = LEL o PFO, y sólo para OHF, OLC, OLF, ObF, OSF, PHF y ULF.', choices: YES_NO, tip: 'Mientras dura el rearranque el relé de falla RA-RC se mantiene cerrado.' },
  'FUn.SCS': { text: 'Guarda la configuración actual como copia de reserva. Vuelve sola a nO.', choices: { nO: 'Sin acción.', YES: 'Guardar ahora.' } },
  'FUn.FCS': { text: 'Recupera una configuración. Para confirmar hay que mantener ENT 2 s. Vuelve sola a nO.', choices: { nO: 'Sin acción.', rEC: 'Vuelve a la copia guardada con SCS.', InI: 'Vuelve a los ajustes de fábrica.' } },
  'SUP.COd': { text: 'Código de bloqueo del terminal. OFF: sin código. On: bloqueado; se desbloquea componiendo el código y pulsando ENT, hasta la próxima desconexión. Un número de 2 a 999 indica el código vigente y desbloqueado.' },
  'SUP.FrH': { text: 'Consigna de frecuencia: la frecuencia que pide la entrada de referencia, antes de la rampa.' },
  'SUP.rFr': { text: 'Frecuencia de salida aplicada al motor en este momento.' },
  'SUP.LCr': { text: 'Corriente del motor.' },
  'SUP.ULn': { text: 'Tensión de red.' },
  'SUP.tHr': { text: 'Estado térmico del motor. 100 % es el nominal; por encima de 118 % dispara OLF y se puede rearmar debajo de 100 %.' },
  'SUP.tHd': { text: 'Estado térmico del variador. 100 % es el nominal; por encima de 118 % dispara OHF y se puede rearmar debajo de 80 %.' },
  'SUP.HSU': { text: 'Velocidad máxima vigente, según la selección de HSP, HS2, HS3 o HS4.' },
  'SUP.rPF': { text: 'Realimentación del regulador PI. Sólo con PIF = AI1.' },
};

export const DISPLAY_STATES: Readonly<Record<string, string>> = {
  rdY: 'Variador listo. Puede estar esperando una nueva orden de marcha aunque una entrada ya esté cerrada.',
  nSt: 'Parada en rueda libre: la entrada nSt está abierta o el variador cortó la alimentación del motor.',
  dcb: 'Frenado por inyección de corriente continua en curso.',
};

export const FAULTS: Readonly<Record<FaultCode, FaultText>> = {
  SCF: { name: 'Cortocircuito en el motor o falla de aislamiento', detects: 'Corriente de cortocircuito entre fases o a tierra en la salida.', simulator: 'Se dispara al energizar la salida con el corto U-V puesto, en marcha o durante la inyección de continua.', remedies: ['Revisar el cableado del variador al motor y el aislamiento del motor.'], logicReset: false, autoReset: false },
  OCF: { name: 'Sobreintensidad', detects: 'Sobreintensidad. El fabricante indica rampas cortas, inercia o carga excesiva y bloqueo mecánico como posibles causas.', simulator: 'La demanda magnetizante calculada supera 1,15 veces el límite durante más de 80 ms. Este criterio es una aproximación del modelo; el bloqueo del eje también puede activar el límite de corriente, OLC u OLF.', remedies: ['Revisar las rampas: pueden ser demasiado cortas.', 'Comprobar el dimensionamiento del motor, del variador y de la carga: inercia o carga demasiado alta.', 'Buscar un bloqueo mecánico.'], logicReset: false, autoReset: false },
  ObF: { name: 'Sobretensión en desaceleración', detects: 'El bus de continua sube por la energía que devuelve el motor al frenar.', simulator: 'Bus por encima de 415 V con regeneración. Aparece con dEC corto, mucha inercia o par de carga negativo, brA = nO y sin módulo de frenado.', remedies: ['Aumentar el tiempo de desaceleración.', 'Agregar un módulo y una resistencia de frenado si hace falta.', 'Activar brA si la aplicación lo permite.'], logicReset: true, autoReset: true },
  OSF: { name: 'Sobretensión de red', detects: 'Tensión de red demasiado alta.', simulator: 'Tensión de red por encima de unos 293 V (bus mayor que 415 V).', remedies: ['Verificar la tensión de red.'], logicReset: true, autoReset: true },
  USF: { name: 'Subtensión de red', detects: 'Tensión de red demasiado baja.', simulator: 'Tensión de red por debajo de unos 163 V (bus menor que 230 V). El modelo elimina USF al recuperar la tensión, pero puede exigir una nueva orden de marcha.', remedies: ['Verificar la tensión de red y el parámetro de tensión.'], logicReset: false, autoReset: false },
  OLF: { name: 'Sobrecarga del motor', detects: 'El estado térmico calculado del motor superó 118 %.', simulator: 'Corriente sostenida por encima de la nominal: carga excesiva, eje bloqueado, una fase abierta o ItH mal ajustado.', remedies: ['Verificar los ajustes de la protección térmica (ItH) y la carga del motor.', 'Esperar que se enfríe antes de volver a arrancar.'], logicReset: true, autoReset: true },
  OHF: { name: 'Sobrecarga del variador', detects: 'El estado térmico del variador superó 118 %.', simulator: 'Corriente alta sostenida, temperatura ambiente alta, ventilación baja o frecuencia de conmutación alta.', remedies: ['Revisar la carga del motor, la ventilación del variador y el ambiente.', 'Esperar que se enfríe antes de volver a arrancar.'], logicReset: true, autoReset: true },
  OLC: { name: 'Sobrecarga de corriente', detects: 'La corriente superó LOC durante tOL en régimen estable.', simulator: 'Con la consigna alcanzada, corriente mayor que LOC durante tOL.', remedies: ['Revisar LOC y tOL en FUn.', 'Revisar la mecánica: desgaste, rozamiento, lubricación u obstáculos.'], logicReset: true, autoReset: true },
  ULF: { name: 'Subcarga de corriente', detects: 'La corriente quedó por debajo de LUL durante tUL en régimen estable.', simulator: 'Con la consigna alcanzada, corriente menor que LUL durante tUL, por ejemplo con el par de carga en cero.', remedies: ['Revisar LUL y tUL en FUn.'], logicReset: true, autoReset: true },
  SOF: { name: 'Sobrevelocidad', detects: 'Sobrevelocidad. El fabricante indica inestabilidad o una carga arrastrante como posibles causas.', simulator: 'Más de 1,2 veces la velocidad síncrona correspondiente a la velocidad máxima seleccionada durante 0,3 s, por ejemplo con un par de carga negativo fuerte. Son un umbral y un tiempo del modelo.', remedies: ['Revisar los parámetros del motor, la ganancia y la estabilidad.', 'Si la carga arrastra al motor, agregar módulo y resistencia de frenado y revisar el dimensionamiento.'], logicReset: true, autoReset: false },
  PHF: { name: 'Falta de fase de red', detects: 'Pérdida de una fase de alimentación en equipos trifásicos.', simulator: 'No se produce: este variador es monofásico.', remedies: ['Revisar la conexión de potencia y los fusibles.', 'Comprobar que la red y el variador sean compatibles.'], logicReset: true, autoReset: true },
  CFF: { name: 'Configuración inválida', detects: 'La configuración guardada no es coherente.', simulator: 'No se produce en el uso normal: los archivos inválidos se rechazan al cargarlos.', remedies: ['Volver a la configuración de fábrica o a la guardada con FCS.'], logicReset: false, autoReset: false },
  InF: { name: 'Falla interna', detects: 'Falla del propio variador.', simulator: 'No se produce.', remedies: ['Verificar las condiciones de compatibilidad electromagnética.', 'Sustituir el variador.'], logicReset: false, autoReset: false },
  CrF: { name: 'Circuito de carga', detects: 'Falla del circuito de precarga del bus.', simulator: 'No se produce.', remedies: ['Sustituir el variador.'], logicReset: false, autoReset: false },
};

export { manualReference as manualLink } from './manuals';
