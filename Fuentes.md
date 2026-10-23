# Fuentes y criterios del modelo

El simulador representa un ATV11HU09M2E, gama E, de 0,37 kW, alimentación monofásica de 200 a 240 V y corriente nominal del variador de 2,1 A. El perfil elegido es V1.2 con IE igual o mayor que 21. Las aproximaciones físicas son didácticas y no identifican el algoritmo propietario del variador.

## Documentación primaria


Los números siguientes son páginas impresas, no posiciones del visor PDF. La documentación del panel se consulta en los PDF originales del fabricante. Las ecuaciones, las aproximaciones físicas y las decisiones de implementación se conservan en este archivo de fuentes.

1. Schneider Electric, Altivar 11, guía de uso de gamas E y U, V1.2, IE igual o mayor que 21. Descarga oficial enlazada por [FAQ FA328465](https://www.se.com/us/en/faqs/FA328465/).
   [Documento](https://se.my.site.com/ckmContent/sfc/servlet.shepherd/document/download/0698V00000lppRiQAI).
   SHA256 `ba14ef71108ff6515c494f8fbec69489d25380a8291c6ceb05000f59fe32e164`.
   Secciones utilizadas: puesta en servicio y configuración inicial, página 18; bornes y cableado, 20 y 21; panel, 22; primer nivel, 23; AI1, 24; motor, 25; funciones, 26 a 30; supervisión, 31; fallos, 32 y 33. La traducción española equivalente está en las páginas 52 a 67. Las funciones posteriores al manual técnico de 2004 están especialmente en las páginas 27 y 28, equivalentes a 61 y 62 en español.

2. Schneider Electric, Altivar 11, manual técnico, gamas E, A y U, revisión de 3 de junio de 2004, páginas inglesas 64 a 124. Descarga oficial enlazada por [FAQ FA279259](https://www.se.com/br/pt/faqs/FA279259/).
   [Documento](https://se.my.site.com/ckmContent/sfc/servlet.shepherd/document/download/0698V00000erBH3QAM).
   SHA256 `c58018258d621f5025e61c272079c8922ca5e72f6d2899d927802773d03bed8f`.
   Secciones utilizadas: valores iniciales, página 67; ampliaciones V1.2, 68; calibres de alimentación monofásica, 69; bornes y cableado, 77 a 83; protección térmica y rearme, 84; panel E y U, 86; menús y ajustes, 88 a 94; compatibilidad de funciones, 97; control y velocidades preseleccionadas, 98 a 101; regulador PI, 102 a 107; funciones de entrada, corriente, parada y rampas, 109; inyección y conmutación, 111; rearranque y DO, 113 y 115; memoria de configuración, 117; supervisión y código de bloqueo, 118 y 119; fallos, 121 y 122.

3. Schneider Electric, [ficha de producto ATV11HU09M2E](https://www.se.com/nl/en/product/ATV11HU09M2E/variable-speed-drive-atv11-0-37kw-230v-1phase-supply-ip20/). Confirma el modelo, la potencia y la alimentación monofásica.

## Acceso a los manuales

Los enlaces oficiales y las correspondencias de páginas se definen en `manufacturer-documents.json`. La guía multilingüe tiene 86 páginas PDF. Su sección española ocupa las páginas impresas 52 a 67, páginas 53 a 68 del visor. El panel está en la página impresa 56, página PDF 57. El catálogo conserva la numeración inglesa de la misma edición; se suman 35 para obtener la página española del PDF y 34 para la página impresa española.

La referencia técnica tiene 61 páginas PDF, numeradas de 64 a 124. Se restan 63 a la página impresa para localizarla en el visor. La FAQ FA279259 distingue el manual portugués de gama A del técnico inglés de gamas E, A y U; este simulador usa el segundo.

Los enlaces llevan a las descargas oficiales del fabricante. Tras descargar el archivo, busque la página PDF indicada. El fragmento de página es una indicación para el visor. Se requiere internet aunque el simulador funciona sin conexión. El proyecto no redistribuye estos PDF.

## Valores y decisiones no resueltos por las fuentes


Los manuales publican los valores iniciales nCr, ItH, nSL y COS como dependientes del calibre, sin una tabla numérica completa para el motor de ejemplo. El simulador usa 2,1 A para nCr e ItH, 2,7 Hz para nSL y 0,80 para COS. Los dos últimos son valores supuestos, no valores de firmware confirmados.

El intervalo de nCr de la guía se expresa como 0,25 a 1,5 In. Se interpreta el límite inferior como 0,25 In. El intervalo de CLI sí está definido como 0,5 a 1,5 In. La tabla de LC2 del manual técnico, página 109, indica 1,5 In como valor inicial de CL2 pero no publica su intervalo. Se adopta para CL2 el mismo intervalo de CLI; esta elección es una inferencia.

Los incrementos de edición se eligieron según la resolución útil del visor y de la simulación. No se presentan como una transcripción de la resolución binaria del firmware. Al reducir HSP, se exige que todos los valores SP almacenados, incluso los ocultos, queden dentro del nuevo límite. La importación exige dependencias válidas en todos los ajustes almacenados. El manual no describe cómo trataría el firmware cada valor oculto fuera de un límite recién reducido.

El manual no precisa si SCS y FCS deben guardar o recuperar también el código de acceso. El simulador trata el bloqueo como un ajuste aparte de la copia interna. El archivo JSON conserva tanto los parámetros como la memoria de configuración.

## Esquema y acciones físicas

La carcasa completa, el contorno de la tapa curva y la disposición general de los bornes se redibujaron con CSS y SVG originales a partir de la fotografía del equipo y de los dibujos del manual técnico, páginas 72, 77 y 78. El panel y las teclas siguen la guía de uso, página 22. La alimentación monofásica tiene R/L1 y S/L2/N arriba, con PE como anclaje de tierra; PA/+, PC/- y U, V, W se muestran abajo. Los bornes de control se dibujan como una franja accesible para que el alumno pueda seguir los cables. La escala y la apertura de la tapa se adaptan a la legibilidad del esquema y no constituyen un plano dimensional. El motor se representa con geometría 3D original generada en código: cuerpo cilíndrico, aletas, eje y disco de carga con una línea de referencia. Se dibuja en un canvas mediante WebGL nativo del navegador.

Los contactos U, V y W representan la continuidad de cada conductor de salida. El control Puente U-V representa una unión eléctrica entre las dos salidas del variador antes de los contactos y el botón Retener eje representa una sujeción mecánica mientras se pulsa. No se selecciona un código de fallo mediante esos controles. Las páginas 32 y 33 de la guía y 121 y 122 del manual técnico relacionan OCF con bloqueo mecánico, SCF con cortocircuito de salida o aislamiento, y ObF y SOF con una carga impulsora. No documentan OPF ni un disparo específico por desequilibrio de salida. PHF e IPL corresponden a la entrada trifásica y se excluyen de este modelo monofásico. La pérdida de un conductor no se equipara automáticamente a ULF.

## Modelo dinámico

El motor físico y los parámetros programados son conjuntos distintos. El par nominal se calcula a partir de la potencia y la velocidad nominales del motor físico:

\[
T_n = \frac{1000 P_{kW}}{2\pi n_n/60}.
\]

La frecuencia eléctrica equivalente del rotor es \(f_r = \omega p/(4\pi)\), donde \(p\) es el número de polos. El deslizamiento nominal del motor físico se calcula como \(s_n = f_n - n_n p/120\), con un mínimo numérico de 0,2 Hz. El deslizamiento instantáneo es la diferencia entre la frecuencia de salida y \(f_r\).

El flujo relativo se estima a partir de la relación V/f programada con UnS y FrS y de la relación V/f nominal del motor físico. UFr modifica un término de compensación de tensión a baja frecuencia. La tensión se limita a la alimentación disponible. La curva de par es una aproximación de motor de inducción con deslizamiento de par máximo igual a cuatro veces el deslizamiento nominal físico:

\[
T_e = T_n \frac{s/s_n}{1+(s/(4s_n))^2}\frac{17}{16}\Phi^2.
\]

La corriente solicitada combina una componente de magnetización y una componente de par:

\[
I = \sqrt{(0{,}35 I_n \Phi)^2 + \left(0{,}93675 I_n \frac{T_e}{T_n\Phi}\right)^2}.
\]

I_n en estas ecuaciones es la corriente del motor físico. CLI o CL2 limita el par disponible a partir de esa relación. La rampa deja de avanzar durante una aceleración limitada por corriente. nCr, COS, nSL y SLP intervienen en una estimación de deslizamiento compensado del control, sin modificar I_n, la potencia o la velocidad nominales del motor físico. FLG y StA ajustan una respuesta de segundo orden de la frecuencia de salida. Con FLG o StA igual a cero se usa una respuesta V/f sin la compensación vectorial del modelo. Se reproduce el efecto cualitativo de los ajustes, no el algoritmo propietario del variador.

La dinámica del eje usa la suma de la inercia del motor y la inercia añadida. La carga positiva se opone al movimiento. El coeficiente de fricción produce un par proporcional a la velocidad:

\[
(J_{motor}+J_{carga})\frac{d\omega}{dt} = T_e - T_{carga}\operatorname{sgn}(\omega)-b\omega.
\]

La integración del rotor usa pasos fijos de 5 ms y acumulación del tiempo transcurrido. El incremento de velocidad emplea un denominador implícito local para estabilizar las inercias mínimas permitidas:

\[
\Delta\omega = \frac{T_{neto}\Delta t}{J+\Delta t(b+k_e)},\qquad k_e = \frac{T_n}{s_n}\frac{p}{4\pi}\Phi^2.
\]

El término k_e se aplica durante la marcha. Es una linealización local elegida para la integración numérica, no una identificación del control del fabricante. El modelo incorpora una condición de reposo para que una carga resistente no invierta por sí sola el giro cuando el motor deja de producir par. La animación consulta ese estado y no fija el paso de integración.

Los estados térmicos usan acumulaciones de primer orden proporcionales a la corriente al cuadrado. El cálculo del variador usa ItH y el cálculo separado del motor físico usa I_n. La constante elegida para ambos estados del motor es de 45 s. La del variador es de 60 s e incluye efectos aproximados de temperatura ambiente, ventilación y conmutación. Estos tiempos están comprimidos para enseñanza. El fabricante documenta la acumulación térmica de la corriente al cuadrado y los umbrales, pero no publica aquí la curva térmica completa. Al quitar la alimentación durante más de 0,4 s, el modelo borra la memoria térmica calculada del variador para el motor. El estado térmico del motor físico conserva el calor y sigue enfriándose. La guía especifica que esa memoria calculada se pierde al desconectar. El tiempo de 0,4 s es una convención para el control externo del simulador. Los umbrales sí se conservan: OLF y OHF por encima del 118 %, rearme de OLF por debajo del 100 % y de OHF por debajo del 80 %.

Con los tres conductores cerrados se conserva el modelo trifásico anterior. Con cero o un conductor cerrado no hay un circuito de corriente: el par y la corriente son cero, aunque puede existir tensión en los bornes del variador. Con dos conductores se usan dos campos opuestos. Si \(C(s)\) es la curva de deslizamiento anterior, los pares medios son

\[
T_f = \frac{T_n}{2}C(f-f_r)\Phi^2,
\qquad
T_b = \frac{T_n}{2}C(-f-f_r)\Phi^2.
\]

Se cancelan en reposo. Durante el giro se añade una ondulación \(0{,}18 T_n\Phi^2 q\sin(2\theta_e)\), con \(q\) igual a \(\lvert f_r\rvert/\max(\lvert f\rvert,1)\) limitado entre cero y uno y \(\theta_e\) integrado con \(2\pi f\) en cada paso. Una carga ligera puede mantener el giro con menos par; una carga mayor puede bloquearlo.

La corriente de dos conductores usa la suma cuadrática de magnetización, corriente de ambos campos y una demanda de rotor detenido. Los coeficientes elegidos son 0,55 para la magnetización, 1,4 para la contribución de los campos y 6 para la demanda de bloqueo. La demanda de bloqueo disminuye con el giro. Son aproximaciones didácticas, no constantes del motor medidas ni ajustes publicados del variador.

Se adopta LCr como la raíz cuadrática media de las tres corrientes de línea. La convención bajo desequilibrio es una elección del modelo; las fuentes no especifican esa semántica de la medición del firmware. Con dos conductores, cada línea activa lleva \(\sqrt{3/2}\) veces LCr; la línea abierta tiene corriente cero. El límite agregado se reduce por \(\sqrt{2/3}\) para que cada línea respete CLI o CL2. El par también disminuye cuando la demanda excede ese límite. El calentamiento conserva el modelo agregado de corriente al cuadrado. El desequilibrio mostrado es el máximo alejamiento respecto de la corriente media, dividido por esa media y expresado en porcentaje; con corriente cero se muestra cero. Las corrientes por fase, el desequilibrio, la tensión del enlace de continua y la potencia regenerada son diagnósticos calculados del banco y no se agregan al catálogo SUP.

La retención del eje impone velocidad y rpm cero en cada paso y mantiene el ángulo. La sujeción absorbe fuera del enlace de continua la energía cinética previa; no se atribuye regeneración al acto de bloquear el eje. La demanda de corriente incluye el rotor detenido, actúa el límite de corriente y los temporizadores o el estado térmico pueden producir OLC u OLF. Soltar el eje permite acelerar si todavía no hay un fallo. La reacción de la sujeción se deriva del par de carga, la fricción y el par del motor.

El enlace de continua usa un balance de energía con capacidad supuesta de 0,6 mF. Durante la regeneración de alterna, la energía recuperada se aproxima mediante el producto del par de frenado y la velocidad. Se adoptan pérdidas base de 35 W. brA limita el esfuerzo de frenado y retiene la rampa cuando hace falta. La opción de módulo de frenado representa una disipación adicional. Las cifras de capacidad, pérdidas y disipación son elecciones del modelo. Se usan los umbrales documentados de 415 V de sobretensión y 230 V de subtensión del bus, manual técnico 122. El modelo dinámico no integra los semiconductores, la impedancia del cableado ni los pulsos PWM. La pestaña Ondas reconstruye una modulación didáctica a partir del estado actual, por separado de la integración mecánica.

AI1 representa una fuente ajustable independiente. Cuando se activa PI, su valor representa el retorno de un proceso externo. No se añade un proceso de presión o nivel que lo modifique por sí solo. DO muestra un valor normalizado o una condición lógica. Las cifras de impedancia y corriente publicadas para DO no coinciden entre las dos ediciones; no se atribuye fidelidad eléctrica a una tensión equivalente mostrada por el modelo.

SCF requiere el puente colocado y una salida energizada por marcha o inyección continua. Un puente sobre una salida inactiva no produce corriente ni un disparo inmediato. Después de retirarlo, SCF conserva el requisito de desconexión y reconexión. Los fallos OSF y USF responden a condiciones externas de alimentación. Los fallos de carga, temperatura, frenado y sobrevelocidad responden al modelo dinámico. No se generan fallos internos de hardware CrF o InF. PHF no corresponde a la alimentación monofásica de este modelo. Un archivo inválido se rechaza antes de cargarlo y no genera CFF en una configuración parcial.

Las órdenes simultáneas en LEL o trn no tienen una prioridad explícita en las fuentes. El modelo usa prioridad de marcha inversa cuando ambas órdenes coinciden. PFO sí conserva la prioridad adelante documentada. La comparación de referencia alcanzada usa una banda simétrica e incluye la demanda de compensación de deslizamiento. La fórmula de AP1 de la guía omite el valor absoluto aunque el gráfico dibuja una banda alrededor de la referencia. El uso simétrico y la inclusión de compensación son interpretaciones del simulador.

## Archivo de configuración

El JSON usa schema `variador-aula`, version `1`, model `ATV11HU09M2E` y firmwareProfile `V1.2-IE21`. Almacena todos los parámetros del catálogo, el motor físico, la carga y sus pérdidas, la inercia, las entradas y sus posiciones, el tipo de cada control externo y la memoria de parámetros. Conserva también los ajustes ocultos y sin asignar.

La importación valida la estructura y todos los valores y dependencias antes de aplicar cambios. Un error conserva el estado anterior completo. Una importación válida borra el estado dinámico y comienza con el motor detenido. Los contactos mantienen sus posiciones y se exige una nueva secuencia de marcha. El archivo no guarda una sesión en movimiento ni una trayectoria temporal. El reloj de simulación se pausa al ocultar la pestaña. Mientras está visible, se acumula el tiempo transcurrido completo sin limitarlo a un fotograma.

Los cambios de tCC y la recuperación de parámetros mediante FCS inhiben el mando, pero conservan el movimiento de rueda libre, la temperatura y los fallos existentes. Sólo la importación de una configuración completa inicia un estado dinámico nuevo.

Los bloques de datos son `parameters`, `motor`, `mechanical`, `inputs`, `inputModes` y `driveMemory`. Los parámetros se identifican con rutas canónicas, por ejemplo `drC.nCr` o `FUn.PI.rPI`; los valores repetidos entre menús se guardan una sola vez. `motor` incluye potencia en kW, tensión en V, frecuencia en Hz, corriente en A, velocidad en rpm, polos, factor de potencia e inercia propia en \(\mathrm{kg}\cdot\mathrm{m}^2\). `mechanical` contiene par en N m, coeficiente de fricción en N m s/rad e inercia añadida en \(\mathrm{kg}\cdot\mathrm{m}^2\). `inputs` conserva alimentación, contactos, fuente y posición analógica, estado de cada conductor de salida, puente entre U y V, retención del eje, módulo de frenado, ambiente y ventilación. `inputModes` guarda `switch` o `button` por entrada. `driveMemory` guarda `backupParameters`, `backupValid`, `monitor` y `firstBoot`.

Los estados `outputConnections` de U, V y W, `shaftHeld` y el puente representado por `shortCircuit` también se conservan en el archivo. La configuración inicial tiene los tres conductores cerrados, el eje libre y el puente abierto.

El código de acceso COd representa el comportamiento del panel. El archivo local es legible y editable y no constituye un mecanismo de seguridad.

## Salida eléctrica y ondas

El modelo produce un estado de salida de alterna, continua o apagado. Las formas de onda y el sonido consumen ese estado. Las lecturas planas de la interfaz pública y el estado de salida proceden del mismo estado físico del modelo.

Las ondas se reconstruyen a partir del estado actual como si fuera régimen permanente. No son muestras históricas de la integración mecánica. La modulación didáctica usa PWM con muestreo regular por portadora e inyección homopolar de mínimos y máximos. El fabricante no publica aquí su estrategia de modulación. La tensión de fase se mide respecto del neutro de la estrella del motor y la de rama respecto del negativo del bus. La corriente representada sólo contiene la fundamental; el rizado requeriría un modelo de inductancia de dispersión.

La componente activa de corriente depende del par y del sentido del campo giratorio. El atraso se aplica en el tiempo también cuando la frecuencia es negativa. Un motor que gira en sentido inverso puede consumir potencia o regenerar, según su cuadrante de funcionamiento.

La guía de uso, página española 63, y la referencia técnica, página 111, especifican SdC entre 0 y 1,2 veces la corriente nominal del variador, con valor inicial de 0,7 veces esa corriente. No especifican su distribución entre ramas ni la medición LCr en continua. El modelo usa SdC como corriente del primer conductor conectado, en orden U, V, W, limitada por CLI o CL2. Los demás conductores reparten el retorno. Con tres conectados las magnitudes son I, I/2 e I/2; con dos son I e I. La tensión usa esa misma topología. La distribución y la estimación de 20 V a corriente nominal del motor son elecciones didácticas.

La agregación de LCr es \(I_{eq}=\sqrt{(I_U^2+I_V^2+I_W^2)/3}\). En continua resulta \(I/\sqrt{2}\) con tres conductores e \(I\sqrt{2/3}\) con dos. Esta convención bajo desequilibrio no se atribuye al firmware.

La inyección de continua disipa el frenado en el motor y no devuelve esa potencia al bus, según [KEB](https://www.kebamerica.com/blog/dc-injection-braking/) y [Nidec, página 2](https://acim.nidec.com/drives/control-techniques/-/media/Project/Nidec/KB/documents/white-papers/kb-electronics-dc-injection-braking-may-2018.ashx?la=en). La contracorriente, con rotor y campo en sentidos opuestos, consume potencia; su flujo de energía se describe en las [notas de máquinas eléctricas de Philadelphia University, diapositiva 36](https://www.philadelphia.edu.jo/academics/fobeidat/uploads/Electric%20machines%20I/4%20Three%20Phase%20Induction%20motors%201.pdf). brA y la regeneración del modelo se restringen al cuadrante generador de alterna. La magnitud de potencia usa un balance mecánico simplificado. No se calcula por separado el calor del rotor durante la inyección o la contracorriente, ni el balance completo de los dos campos con un conductor abierto.

SFr fija la frecuencia de conmutación. A 2 kHz pasa a 4 kHz a alta velocidad; HF reduce la frecuencia con temperatura y LFr la varía al azar, según el manual español, página 63. El umbral elegido de más de 100 Hz para alta velocidad es una suposición.

El sonido opcional combina un tono de conmutación, bandas laterales, un zumbido ligado al flujo y ruido ligado a la velocidad. No es una grabación ni un modelo acústico. El reloj y el sonido se suspenden al ocultar la página.

## Licencias

El único paquete incorporado al HTML es Solid. Su licencia MIT se conserva en cada página y en `LICENSES.txt`. Las herramientas de compilación y prueba son dependencias de desarrollo y no se incorporan al simulador.
