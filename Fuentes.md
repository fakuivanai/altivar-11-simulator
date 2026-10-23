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

## Modelo dinámico y documentación

Las páginas de documentación y limitaciones se construyen a partir de `documentation.html` y `limitations.html`. Contienen el diagrama de sistemas, las ecuaciones, el alcance funcional y las limitaciones. `documentation.ts` genera el catálogo completo, sus referencias de página, el ajuste del circuito inicial y los valores de los componentes, ganancias y tiempos desde el código ejecutable. La comprobación de cobertura exige una descripción para cada constante de esos grupos. Los cambios de ecuaciones, topología o semántica requieren revisar también la prosa y el diagrama.

El motor usa cuatro enlaces de flujo en coordenadas estacionarias alfa y beta, con circuito equivalente por fase en estrella y rotor referido al estator. El par, las corrientes, las pérdidas de cobre y la energía magnética derivan del mismo circuito. Se integra con punto medio implícito y paso máximo de 100 us. Una alternativa de Euler implícito amortigua circuitos manuales con constantes de tiempo menores que la resolución; su disipación numérica se registra por separado.

La referencia física principal es James L. Kirtley Jr., MIT 6.685, [notas 10, Induction Machine Control and Simulation](https://ocw.mit.edu/courses/6-685-electric-machines-fall-2013/d834469bd6c3f56c6bec451d76176156_MIT6_685F13_chapter10.pdf), circuito y control V/f en páginas 1 a 5 y ecuaciones de flujo en 6 a 8. [MathWorks, Induction Motor](https://www.mathworks.com/help/mcb/ref/inductionmotor.html) permite contrastar la convención de circuito equivalente por fase. Las implementaciones son originales, no código copiado de esos sistemas.

La estimación inicial prioriza el par nominal a deslizamiento nominal, una corriente de vacío supuesta de 0,35 In y deslizamiento de par máximo de cuatro veces el nominal. Se suponen iguales las inductancias de dispersión y Rs igual a 0,05 veces la impedancia nominal por fase. La corriente nominal, el factor de potencia y la corriente de bloqueo supuesta de seis veces In son diagnósticos del ajuste. No se multiplican el par y la corriente por factores independientes para forzar coincidencias incompatibles con un circuito pasivo. La interfaz y la documentación muestran los residuos. El circuito no proviene de ensayos de vacío y rotor bloqueado del motor real.

La comparación con la curva reducida anterior conserva una referencia de regresión, no una fuente física adicional. En los puntos ensayados hasta el deslizamiento de par máximo, la desviación máxima es menor que 7 % en motorización y 18 % en generación. La resistencia del estator rompe la simetría de la curva anterior. Se comparan pares intrínsecos con velocidad impuesta; se excluyen sus antiguos recortes de corriente y frenado.

El enlace de continua conserva energía del condensador, rectificación monofásica, resistencia de fuente, precarga, descarga y resistencia de frenado opcional. [TI TIDUF73, sección 2.2.1](https://www.ti.com/lit/ug/tiduf73/tiduf73.pdf) fundamenta la precarga RC pasiva, sin identificar los componentes de este variador. [ABB, Technical guide No. 8](https://library.e.abb.com/public/20be376000f34dd6b9c513580cf56423/Technical_guide_No_8_3AFE64362534_RevC.pdf), páginas 13 a 15, describe el almacenamiento del bus y el frenado resistivo. Los valores de componentes son supuestos didácticos; los diodos son ideales. El puente de entrada no devuelve energía a la red. La potencia eléctrica firmada del motor carga o descarga el bus. La inyección de continua y la contracorriente pueden disipar energía en el motor sin clasificarse automáticamente como regeneración.

La retención del eje aplica un freno de Coulomb con capacidad de tres veces el par nominal. Integra el recorrido hasta detenerse y disipa el trabajo mecánico fuera del bus. El acoplamiento usa la velocidad media del desplazamiento para que el trabajo eléctrico convertido sea el trabajo entregado al eje. La carga positiva es resistente, la negativa es impulsora y la fricción es viscosa. Las corrientes y el par físicos no se recortan algebraicamente. CLI regula la tensión mediante PI; SdC regula la corriente del conductor fuente mediante PI con compensación resistiva. Las ganancias son elecciones del simulador. La integración condicional sigue los principios descritos en [imperix TN105](https://imperix.com/doc/implementation/pi-controller).

Los estados térmicos son índices de primer orden proporcionales a corriente al cuadrado. Los tiempos de 45 s para el motor y 60 s para el variador son comprimidos para enseñanza. No representan grados Celsius ni una curva térmica calibrada. El manual técnico, página 84, respalda los umbrales de disparo de 118 %, rearme OLF por debajo de 100 % y OHF por debajo de 80 %. El borrado de memoria calculada tras 0,4 s sin alimentación es una convención de la interfaz externa. El calor calculado del motor físico se conserva. Las protecciones no identifican averías internas CrF o InF. PHF no corresponde al modelo monofásico.

La carga inicial de 2,1 N m mantiene el ejemplo por encima del umbral de subcarga a referencias de 25 y 50 Hz. Es una elección del banco; no modifica LUL, LOC ni sus retardos de fábrica. Los archivos anteriores conservan la carga que guardaron y pueden necesitar ajustar la detección de carga al nuevo circuito.

brA, FLG, StA y la compensación de deslizamiento tienen implementaciones didácticas. El límite de corriente reduce la tensión y, ante deslizamiento alto, adapta la frecuencia para recuperar un motor detenido. La demanda adaptada de brA se sigue sin la demora adicional del filtro de frecuencia. No identifican el algoritmo propietario. SCF exige un puente con salida AC o DC energizada y conserva la necesidad de desconexión y reconexión. OSF y USF responden a condiciones de alimentación; ObF responde al bus integrado. Las órdenes simultáneas en LEL o trn usan prioridad inversa como interpretación; PFO conserva prioridad adelante. AP1 usa una banda simétrica e incluye la compensación de deslizamiento.

## Archivo de configuración

El JSON usa schema `variador-aula`, version `1`, model `ATV11HU09M2E` y firmwareProfile `V1.2-IE21`. Almacena todos los parámetros del catálogo, el motor físico, la carga y sus pérdidas, la inercia, las entradas y sus posiciones, el tipo de cada control externo y la memoria de parámetros. Conserva también los ajustes ocultos y sin asignar.

La importación valida la estructura y todos los valores y dependencias antes de aplicar cambios. Un error conserva el estado anterior completo. Una importación válida borra el estado dinámico y comienza con el motor detenido. Los contactos mantienen sus posiciones y se exige una nueva secuencia de marcha. El archivo no guarda una sesión en movimiento ni una trayectoria temporal. El reloj de simulación se pausa al ocultar la pestaña. Mientras está visible, se acumula el tiempo transcurrido completo sin limitarlo a un fotograma.

Los cambios de tCC y la recuperación de parámetros mediante FCS inhiben el mando, pero conservan el movimiento de rueda libre, la temperatura y los fallos existentes. Sólo la importación de una configuración completa inicia un estado dinámico nuevo.

Los bloques de datos son `parameters`, `motor`, `motorElectrical`, `mechanical`, `inputs`, `inputModes` y `driveMemory`. Los parámetros se identifican con rutas canónicas, por ejemplo `drC.nCr` o `FUn.PI.rPI`; los valores repetidos entre menús se guardan una sola vez. `motor` incluye potencia en kW, tensión en V, frecuencia en Hz, corriente en A, velocidad en rpm, polos, factor de potencia e inercia propia en \(\mathrm{kg}\cdot\mathrm{m}^2\). `mechanical` contiene par en N m, coeficiente de fricción en N m s/rad e inercia añadida en \(\mathrm{kg}\cdot\mathrm{m}^2\). `inputs` conserva alimentación, contactos, fuente y posición analógica, estado de cada conductor de salida, puente entre U y V, retención del eje, módulo de frenado, ambiente y ventilación. `inputModes` guarda `switch` o `button` por entrada. `driveMemory` guarda `backupParameters`, `backupValid`, `monitor` y `firstBoot`.

Los estados `outputConnections` de U, V y W, `shaftHeld` y el puente representado por `shortCircuit` también se conservan en el archivo. La configuración inicial tiene los tres conductores cerrados, el eje libre y el puente abierto.

`motorElectrical` declara `mode` igual a `estimated` o `manual`. El modo manual conserva Rs, Rr, Lls, Llr y Lm en unidades SI. Un archivo anterior sin ese bloque carga una estimación desde la placa y comunica esa elección. La placa y el circuito sólo cambian con eje detenido y salida apagada. La inercia añadida, la fricción y el par de carga admiten cambios en marcha. Al cambiar la inercia se conserva la velocidad; la energía o el momento intercambiados al acoplar otra carga quedan fuera del modelo.

El código de acceso COd representa el comportamiento del panel. El archivo local es legible y editable y no constituye un mecanismo de seguridad.

## Salida eléctrica y ondas

La salida distingue alterna, continua y apagado. La dinámica usa tensiones medias del inversor. Los contactos abiertos restringen las corrientes de estator; al abrir un conductor se conserva el flujo del rotor y se elimina la energía de dispersión incompatible con la nueva topología como disipación ideal de contacto. No se integra un arco ni los diodos del inversor.

LCr usa una envolvente filtrada de la raíz del promedio de los cuadrados de las corrientes de tres líneas. Coincide con RMS equilibrada en régimen; en continua y desequilibrio es una convención del banco, no una medición identificada del firmware. La pantalla por conductor usa la topología canónica asociada a esa lectura. El registro físico conserva las corrientes instantáneas firmadas de la integración.

La guía de uso, página española 63, y la referencia técnica, página 111, especifican el intervalo y valor inicial de SdC, pero no su distribución entre ramas. El simulador elige como fuente el primer conductor conectado en orden U, V, W, y conecta los demás como retornos. La tensión aplicada y la resistencia de sus devanados determinan la corriente real. En régimen con tres conductores iguales, los retornos reparten I/2; con dos queda un retorno I. El límite se aplica al conductor fuente. La distribución y la semántica agregada de LCr en continua son elecciones del modelo.

El registro conserva 10 s con muestras cada 0,5 ms, disparo por marcha, cambio de par o fallo, y captura única con tiempo previo y posterior. Son muestras del modelo promediado, no tensiones PWM medidas. La reconstrucción de dos períodos supone régimen permanente en el punto actual. El zoom de 2 ms integra aparte el rizado R-L producido por la tensión PWM menos su media, con flujo y fundamental retenidos en el punto de reconstrucción. Conserva continuidad entre portadoras y no devuelve resultados al motor, el bus, las protecciones ni el calentamiento. Su inicialización previa está limitada a 512 portadoras. No integra cables, tiempos muertos, sobrepicos o reflexiones.

La modulación didáctica usa PWM con muestreo regular por portadora e inyección homopolar de mínimos y máximos. El fabricante no publica aquí su estrategia. SFr determina su frecuencia; el umbral de más de 100 Hz para pasar de 2 a 4 kHz es supuesto. LFr usa variación determinista para repetir experimentos. DO es una señal normalizada o condición lógica ideal. AI1 en modo PI es retorno de un proceso externo ajustado por el alumno; no existe un proceso autónomo de presión o nivel. El sonido es una síntesis de tonos y ruido, sin calibración acústica. El reloj y el sonido se suspenden al ocultar la página. El trabajo por fotograma está acotado; el tiempo visible pendiente se conserva y su retraso se muestra en pantalla.

## Licencias

El único paquete incorporado al HTML es Solid. Su licencia MIT se conserva en cada página y en `LICENSES.txt`. Las herramientas de compilación y prueba son dependencias de desarrollo y no se incorporan al simulador.
