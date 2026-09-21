# InroScan — contexto completo del proyecto

> Documento de traspaso. Se escribió para que cualquier persona —o cualquier
> asistente en otra cuenta, otra sesión o dentro de un año— pueda retomar este
> proyecto sin tener que reconstruir la conversación que lo produjo. Contiene el
> problema, las decisiones con su razón, lo que se verificó contra la realidad,
> lo que todavía no, y lo que queda abierto.
>
> Última actualización: 21 de septiembre de 2026 · commit `e1bc0a0`

---

## 1. Qué es InroScan y por qué existe

El área de contabilidad de INROPRIN trabaja íntegramente sobre Google Workspace.
Los comprobantes de gastos —caja chica y viáticos— llegan en papel, se
fotografían o se escanean a PDF, y alguien los teclea a mano en una hoja de
cálculo. Ese tecleo es el trabajo que InroScan reemplaza: la persona sube las
imágenes o el PDF, la herramienta los lee, los archiva en Drive ordenados por
fecha y deja un registro en Sheets.

**InroScan es explícitamente temporal.** La empresa ya tiene INRO VIÁTICOS como
destino final. El proceso de adaptación al cambio es largo, y la apuesta
declarada por el usuario es que una herramienta chica que funcione hoy genera la
confianza que después hace posible la migración al sistema grande. Esto no es un
detalle: **condiciona todas las decisiones técnicas hacia lo barato de construir
y lo barato de abandonar.** Nada acá debe tener costo de salida.

### Lo que NO es

- No es un reemplazo de INRO VIÁTICOS, y no se cruza con él (decisión explícita).
- No es un sistema con base de datos: el Drive y el Sheet *son* la base de datos.
- No tiene servidor propio ni backend de ningún tipo.

---

## 2. Estado actual

- **Repositorio:** `tsdonoso-beep/inroscan` (renombrado desde `ebanisteria`). El remoto
  local de esta sesión sigue apuntando al nombre viejo —lo repone el
  entorno en cada arranque— y GitHub redirige, así que el push funciona
  igual. En un clon nuevo, usar el nombre nuevo.
- **Rama de trabajo:** `claude/vigilant-wozniak-8cgqsw`
- **Publicado en:** https://tsdonoso-beep.github.io/inroscan/
- **HEAD:** `e1bc0a0` — «La rendición con fórmulas vivas y el sustento enlazado»
- Árbol limpio, sincronizado con el remoto, `node comprobaciones.mjs` en verde.

El repositorio nació de vaciar un proyecto anterior (`ebanisteria`), ya
deprecado, con permiso explícito del usuario para borrar ramas y contenido de
`main`.

---

## 3. Las personas y el proceso real

| Persona | Rol |
|---|---|
| **Annie** | Administradora de viáticos. Recibe los comprobantes en papel y arma la rendición. |
| **Rosa, Carolina, Kory** | Contabilidad. Revisan y revalidan lo rendido. |
| **T. Donoso** (`t.donoso@inroprin.com`) | Impulsa la herramienta. |

La cadena de un viático, tal como ocurre hoy:

1. Se entrega dinero contra un memorándum.
2. La persona gasta y junta comprobantes.
3. Annie los recibe y **teclea** la rendición en la plantilla.
4. Se imprime y se firma.
5. Contabilidad **vuelve a teclear** lo mismo para revalidar.

**El hallazgo que reorientó el proyecto:** los pasos 3 y 5 son el mismo trabajo
hecho dos veces con un viaje en papel en el medio. Digitalizar una rendición ya
cerrada es arqueología. Por eso la herramienta se movió *aguas arriba*, hacia
Annie: si InroScan produce la rendición en el paso 3, el paso 5 deja de ser
transcripción.

---

## 4. Las tres intenciones × dos procesos

Al entrar, la herramienta pregunta dos cosas antes de mostrar nada
(`app/config.js` → `INTENCIONES` y `PROCESOS`):

**Intención** — a qué vino la persona:

| id | Título | Área | Dónde escribe |
|---|---|---|---|
| `revalidar` | Revalidar una rendición | Contabilidad | unidad compartida |
| `digitalizar` | Digitalizar comprobantes | Administración | unidad compartida |
| `rendir` | Rendir mis gastos | Quien viaja | **su propio Drive** |

**Proceso** — qué tipo de gasto es:

| id | Título | Cabecera |
|---|---|---|
| `caja` | Caja chica | consolidado |
| `viaticos` | Memo de viáticos | memo |

Esto salió de dos pedidos distintos del usuario, y ambos se respetaron: separar
revalidación de digitalización («*el primer caso es contabilidad y el segundo es
administración*») **sin quitarle la herramienta a contabilidad** («*no quiero
quitar herramienta para contabilidad*»), y mantener además la elección entre
caja chica y viáticos («*igual sí consideraría la diferenciación*»).

La opción elegida para viáticos fue la **B**: InroScan **genera la rendición
completa** para Annie, no solo digitaliza piezas sueltas. El resultado es una
**hoja de Google**, elegida por el usuario.

### El tercero: el rendidor (`rendir`)

Se agregó después, y no es una variante de los otros dos: es la persona que
gastó, con el teléfono en la mano, fotografiando conforme le dan los papeles.
Tiene su propia vista (`app/rendidor.js`) y tres diferencias de fondo:

1. **Se captura primero y se lee después.** En la calle nadie espera medio
   minuto por foto a que el OCR y la IA terminen. Se junta todo y se extrae de
   una sentada, con señal — de ahí el botón explícito «Extraer con IA» en vez
   de una lectura automática al soltar el archivo.
2. **Todo nace en «Mi unidad» de la persona**, con ella de dueña
   (`app/mi-unidad.js`): una carpeta `InroScan · Mis rendiciones`, y dentro
   una por número de memo con las fotos y la hoja. No toca la unidad
   compartida ni la hoja del área, a las que puede no tener acceso. Contabilidad
   la ve cuando la persona la comparte, no antes.
3. **El número de memo lo escribe ella.** Es el único dato que la herramienta
   no puede adivinar, y es por donde contabilidad la encuentra después.

Se reconoce abiertamente que esto es territorio de INRO VIÁTICOS. Está acá
como demostración de capacidad, no como reemplazo — lo que agrava la decisión
pendiente del §12.3, porque el solape ya no es solo con Annie sino con el
rendidor.

**Consecuencia técnica de tener a alguien sin acceso al área:** la hoja
compartida ya no se prepara al entrar sino al elegir un modo del área
(`asegurarRegistro()` en `main.js`). Antes, un error de permisos nada más
entrar dejaba fuera a quien sí podía usar la herramienta.

---

## 5. Decisiones de arquitectura, con su razón

### 5.1 SPA estática, sin build, sin backend

Módulos ES nativos cargados por el navegador. Sin bundler, sin `npm install`,
sin paso de compilación. GitHub Pages sirviendo directo desde una rama.

**Por qué:** el costo de mantener este proyecto debe ser cercano a cero, porque
está pensado para morir. Cualquier persona puede abrir un `.js` y entender qué
hace sin herramientas. Y no hay servidor que pagar, parchear ni vigilar.

Se evaluaron y descartaron: Apps Script (editor incómodo, cuotas opacas) y
Vercel (introduce un backend que nadie pidió).

### 5.2 La app actúa *como la persona*, no como una cuenta de servicio

Google Identity Services, `initTokenClient` en el navegador. La persona entra con
su `@inroprin.com` y el token es suyo.

**Consecuencia deliberada:** los permisos de Drive y del Sheet ya existentes
siguen valiendo tal cual. Nadie puede leer lo que no podía leer antes, y la
auditoría de Drive muestra el nombre real de quien hizo cada cosa, no el de un
robot.

`hd: "inroprin.com"` está puesto, pero **es una pista de interfaz, no un control
de seguridad** — está documentado así en `app/auth.js`. Lo que protege de verdad
es, en este orden:

1. La pantalla de consentimiento es **interna** (solo el dominio).
2. Los permisos del Drive y del Sheet.
3. El alcance `drive.file`.

### 5.3 El alcance `drive.file` alcanza — verificado, no supuesto

`drive.file` da acceso a los archivos que la app **crea o abre**. La duda era si
permitía crear un archivo dentro de una carpeta que la app nunca creó, conociendo
solo su ID.

**Sí permite.** Se verificó empíricamente con un banco de pruebas desechable
(`spike/index.html`, prueba 2A) *antes* de construir encima:

```
[18:27:43] VEREDICTO 2A: drive.file SÍ alcanza con el ID directo. No hace falta Picker.
[18:28:45] VEREDICTO 3: el registro en Sheets funciona desde el navegador.
```

Esto eliminó de un plumazo el Google Picker y la API Key de Drive. Lo que
`drive.file` sí niega es leer o modificar archivos preexistentes — que es
exactamente lo que queremos negar.

### 5.4 Dos reglas de API que no son opcionales

- **`supportsAllDrives=true` en TODA llamada a Drive.** La carpeta raíz está en
  una **unidad compartida**. Sin este parámetro, Drive responde «File not found»
  aunque los permisos sean correctos. Es el error más desconcertante posible.
- **`insertDataOption=INSERT_ROWS` al agregar a Sheets.** Sin él, dos personas
  registrando a la vez pueden pisarse las filas.

### 5.5 Clave de Gemini por persona

Cada quien pega su propia clave, guardada en su navegador. Es un puente
declaradamente temporal; el plan futuro es un *pool* de claves. La clave nunca
sale del navegador de quien la escribió.

### 5.6 Carpetas planas por fecha

Solo por fecha, nada más. El usuario lo pidió así: «*hasta ganar confianza sobre
ello ya podemos configurar*». La estructura es lo más fácil de cambiar después;
la decisión fue no adivinar taxonomías antes de tiempo.

---

## 6. Cómo lee un documento (la cascada)

El orden importa porque cada escalón cuesta más que el anterior.

```
huella del contenido
   └─ ¿está en memoria? ──► sí ─► devolver, sin gastar cuota
                            no
   └─ ¿es PDF con capa de texto útil? ──► sí ─► extraer texto
   └─ OCR local (Tesseract.js, wasm, 'spa')
   └─ ¿los campos salieron completos? ──► sí ─► listo
                                         no
   └─ Gemini (gemini-3.1-flash-lite-preview)
```

**La memoria (`app/memoria.js`)** guarda en `localStorage`, con clave el hash del
contenido: **campos, nunca imágenes** (una imagen son 200–500 KB contra una cuota
de ~5 MB; los campos, ~300 bytes). Las lecturas incompletas **no** se guardan,
porque uno va a querer reintentarlas. Máximo 4000 entradas, vigencia 90 días.
Esto responde al pedido explícito: «*conservemos la info si ya ha sido leída por
la API KEY*».

**El ritmo (`app/cola.js`).** Una cola serializada con intervalo mínimo de 4.5 s
que se **duplica ante un 429** y se relaja ×0.8 tras 3 respuestas limpias, con
techo de 45 s. Nació de un síntoma real: «*SE QUEDÓ COLGADO ES POR LA CANTIDAD DE
LLAMADAS CONTINUAS NO?*» — sí lo era, en parte.

**Los plazos como protección contra cuelgues.** Un worker de Tesseract que se
queda sin memoria **nunca rechaza su promesa**: se queda callado para siempre.
`conPlazo()` con `Promise.race` convierte ese congelamiento silencioso en un
error normal que la interfaz puede mostrar. `PLAZO_OCR = 45 s`, `PLAZO_IA = 90 s`.

**El salto adaptativo del OCR.** Tras 4 fallos consecutivos del OCR local se va
directo a la IA (`valeLaPenaElOcr()`): insistir en un OCR que no sirve para ese
lote solo agrega 45 s por página antes de hacer igual la llamada cara.

### La capa de texto se confía según el flujo — no siempre

Esto salió de una objeción del usuario que era correcta: «*¿por qué un
consolidado necesita IA? si es texto*». Estaba rasterizando un PDF que ya traía
texto. Verificado: 368 fragmentos con coordenadas, 51 filas reconstruidas, ~31 %
menos tokens y caracteres exactos.

Pero **no es generalizable**:

| Documento | Capa de texto | Qué hacer |
|---|---|---|
| Consolidado de caja chica (export de Excel) | exacta | leer el texto |
| Memos de viáticos | **OCR corrupto horneado** | ignorarla, rasterizar |

`app/texto-pdf.js` agrupa los fragmentos de pdf.js por `transform[5]` (la Y) con
`TOLERANCIA_Y = 4` y ordena por X, porque el orden nativo del texto en un PDF es
el orden de dibujado, que para una tabla es un revoltijo. Devuelve `null` cuando
no hay capa aprovechable.

Queda honestamente reconocido: la **asignación de columnas** sigue delegada al
modelo, porque las celdas están centradas y no alineadas a la izquierda, así que
las posiciones no bastan.

---

## 7. La aritmética de la rendición — ingeniería inversa verificada

La regla de negocio se dedujo de la plantilla real del **memo 675 (Max
Urrutia)**:

```
12 comprobantes            S/ 347.50   ← total gastado
− 2 declaraciones juradas  S/ 105.50
= monto rendido            S/ 242.00   ✓ coincide con la plantilla
242.00 / 334.00            = 72 %      ✓ coincide con la plantilla
monto recibido             S/ 334.00
```

`app/rendicion.js` reproduce exactamente esos números (verificado en Node:
total `347.50`, sustentado `242.00`, porcentaje `72`).

**Dos cosas que la aritmética reveló y la plantilla escondía:**

1. **La etiqueta «SOLO FT Y BOLETA» de la plantilla está mal.** La planilla de
   movilidad **sí** cuenta: excluirla daría 217.00, no 242.00. Esto hay que
   confirmarlo con Annie (ver §12).
2. **Max gastó S/ 13.50 más de lo que recibió.** El saldo se mide contra lo
   **realmente gastado**, no contra lo sustentado: una DJ es plata que salió del
   bolsillo aunque SUNAT no la acepte. La plantilla de papel obligaba a sacar esa
   cifra mentalmente; acá aparece, con su rótulo según el signo («Saldo por
   devolver» / «Reembolso a favor»).

**La DJ se digitaliza siempre, pero si cuenta o no es una perilla.** Pedido
explícito del usuario. `noCuentan` llega a `calcular()` como parámetro y no como
constante, precisamente para que el criterio viva en la interfaz y no escondido
en el código.

### La hoja generada lleva fórmulas vivas, no números congelados

Es una hoja de cálculo: en cuanto alguien corrija el importe de una línea —y va a
corregirlo, para eso se revisa— un total tecleado quedaría mintiendo en silencio.

```js
total:        `=SUM(E${primera}:E${ultima})`
sustentado:   `=SUMIF(F${primera}:F${ultima};"sí";E${primera}:E${ultima})`
porcentaje:   `=IF(C4=0;"";TEXT(C5/C4;"0%")&" RENDIDO")`
saldo:        `=ABS(C4-E${ultima+1})`
```

Y cada número de documento enlaza a su imagen en Drive:
`=HYPERLINK("<enlace>";"<numero>")`.

**Dos trampas resueltas acá:**

- El **idioma se acomoda antes de escribir**, y el separador se deduce del
  idioma que realmente quedó. Las fórmulas se interpretan al escribirse, así
  que escribir primero y cambiar el idioma después las deja rotas. Dos cosas
  que se creyeron y eran falsas (ver §10):
  1. Que `es_PE` era un idioma válido para Sheets. **No lo es** —
     «Unsupported locale»— así que se intentan candidatos y, si ninguno entra,
     la hoja se queda como nació. No puede tumbar la rendición: es cosmético.
  2. Que en Perú el separador de fórmulas era `;`. **Tampoco.** En es_PE el
     decimal es punto, luego el separador es la coma, igual que en inglés. Se
     deduce preguntándole al navegador cómo escribe 1,1 en ese idioma, que es
     la misma regla que usa Sheets y no se queda vieja.
  Por eso tampoco se intenta `es_ES` ni `es`: en España el decimal es coma y
  S/ 1234.50 se mostraría 1.234,50. Es un problema de dinero, no de idioma.
- La hoja se crea **por la API de Drive**, no por la de Sheets, para que nazca
  dentro de la carpeta. Crearla con Sheets la deja en la raíz del Drive de quien
  la hizo, y habría que moverla con una llamada extra que puede fallar sola y
  dejar el archivo perdido.

---

## 8. Mapa de módulos

| Archivo | Líneas | Qué hace |
|---|---|---|
| `index.html` | 297 | Cáscara: lateral, lienzo, barra de acción, dos diálogos |
| `estilos.css` | 850 | Sistema INROPRIN completo |
| `app/config.js` | 164 | Configuración no secreta, tipos de documento, intenciones y procesos, columnas |
| `app/auth.js` | 100 | GIS, alcances, `tokenVigente()` con refresco 60 s antes de expirar |
| `app/paginas.js` | 82 | Parte PDFs en páginas, normaliza imágenes, calcula la huella |
| `app/texto-pdf.js` | 71 | Reconstruye filas desde la capa de texto |
| `app/rendidor.js` | — | La vista de quien gastó: captura, extrae, guarda en su Drive |
| `app/mi-unidad.js` | — | Carpeta propia por memo en «Mi unidad» |
| `app/lectura.js` | 366 | Orquesta la cascada; `unificarRepetidos()` |
| `app/campos.js` | 229 | Extracción por expresiones regulares; `clave()`; `desdeIA()` |
| `app/prompt.js` | 178 | Los tres prompts |
| `app/cola.js` | 78 | `Cancelado`, `conPlazo()`, `Ritmo` |
| `app/memoria.js` | 82 | Caché de lecturas por huella |
| `app/drive.js` | 86 | Carpetas por fecha y subida |
| `app/sheets.js` | 108 | Registro |
| `app/conciliacion.js` | 126 | El cuadre: `cruzar()` y `heredar()` |
| `app/rendicion.js` | 108 | `calcular()`, `filasDePlantilla()`, `faltaParaCerrar()` |
| `app/hoja-rendicion.js` | 239 | Genera la hoja de Google |
| `app/main.js` | 960 | Orquestación e interfaz |
| `comprobaciones.mjs` | 91 | Guardia de regresiones |
| `spike/index.html` | 446 | Banco de pruebas OAuth + utilidad para vaciar el registro |

### El cuadre (`conciliacion.js`)

Dos pasadas, y la separación es deliberada:

1. **Por número normalizado** — eso es identidad.
2. **Por fecha + importe** — eso es una coincidencia *plausible*, y se marca como
   tal, no se presenta como certeza.

Devuelve `parejas`, `porComprobante`, `discrepancias`, `sinSustento`,
`noDeclarados`. `heredar()` baja proyecto, responsable y categoría desde la línea
de la rendición al comprobante.

### La red contra la fragmentación (`unificarRepetidos`)

Gemini partió una boleta de restaurante en sus platos: `1/4 DE POLLO` 15.00 y
`ENS. DJULIA` 22.00, **ambos como `F001-6406`**. Eso **infla el registro y cuenta
la plata dos veces**. Se arregló por los dos lados: se reforzó el prompt *y* se
puso una red en código que no depende de que el modelo obedezca. Se fusionan las
líneas de igual clave conservando el importe mayor.

---

## 9. Configuración de Google Cloud

- **Proyecto:** `inroscan-contabilidad` (se creó uno nuevo a propósito, para no
  mezclar cuotas ni consentimientos con un proyecto en uso).
- **Client ID:** `951030676058-igp95ct69p03lcpt02vtjs79t5dmsrij.apps.googleusercontent.com`
- **Orígenes JavaScript autorizados:** `https://tsdonoso-beep.github.io`
  (esquema y host, **sin la ruta** — poner la ruta produce `origin_mismatch`).
- **APIs habilitadas:** Drive, Sheets.
- **Pantalla de consentimiento:** interna.
- **Carpeta raíz de Drive:** `1luJMlROtAYYurXcnaAw3K8TURC_4qKBK` (unidad compartida).
- **Hoja de registro:** `1aRzq1ShOW6bD4MYZGNR0FuPcMewG2BVHbO2Qpc36o9E`.

El Client ID **no es secreto**: viaja en el HTML de toda app web de Google y está
documentado como tal en el README. Lo que protege el acceso es lo de §5.2.

---

## 10. Errores encontrados y su causa raíz

Se listan porque cada uno es una familia, no un incidente: saber la causa evita
repetirlo.

| Síntoma | Causa raíz | Arreglo |
|---|---|---|
| Faltaba ~⅓ de las filas del consolidado | La expresión regular solo aceptaba series con letra; los consolidados reales traen `0001-003936` y `002-001175` | Patrón ampliado; verificado 12/12 |
| Una fecha ISO se leía como serie-número | `2026-09` entra en el mismo molde | Se descarta si la serie parece año y el número tiene ≤2 dígitos |
| Lotes colgados | Tres causas distintas: worker de Tesseract muriendo callado, RPM de Gemini sin ritmo, y OCR corriendo siempre aunque después leyera la IA igual | `conPlazo` + `Ritmo` + salto adaptativo; más progreso numerado y botón de cancelar |
| Planillas marcadas «incompletas» | Gemini ponía el correlativo en `serie` dejando `numero` vacío | Si no hay número y la serie es todo dígitos, **la serie es el número** (ceros conservados) |
| El mismo documento daba `10010` y `010010` | Se quitaban los ceros a la izquierda en un camino y no en el otro | Unificado |
| Falso «imagen ya subida» | Registrar el primero de dos comprobantes de una misma hoja marcaba la huella y delataba a su hermano | Dentro de la sesión se registra la **clave**, no la huella |
| El correo aparecía en la columna Proyecto | Chrome autocompletó el campo y quedó en `localStorage` | `autocomplete="off"` + atributos extra **y** descartar cualquier valor con `@` al leer y al escribir |
| Comprobantes duplicados, misma clave, distinto importe | Gemini fragmentaba una boleta en sus platos | Prompt + `unificarRepetidos()` |
| «El recorrido» negro, luego descuadrado, luego la barra visible pese a `hidden` | **Una sola causa:** la regla `button, .boton { … }` derramaba estilo sobre cualquier botón | Se refactorizó a `.btn` y se creó `comprobaciones.mjs` |
| La tabla colapsó en escalera | `th` compartía regla con `.rotulo`, que tiene `display: block`; un `th` en block deja de ser celda | Separados, con comentario explicando que la duplicación es a propósito |
| «Subo el consolidado y no pasa nada» | Sí avisaba, pero el aviso se esconde a los 7 s en lo alto de una página larga | Ahora abre el diálogo de la clave explicando, y marca «falta clave» en la lateral |
| «Unsupported locale: es_PE» abortaba la rendición entera | Sheets no admite `es_PE`, y el ajuste del idioma —cosmético— lanzaba excepción. La hoja ya estaba creada y las fotos subidas: la persona quedaba con una hoja vacía en su Drive y un error en rojo | El idioma se intenta y no se exige; el separador de las fórmulas se deduce del idioma que quedó |
| Las fórmulas habrían entrado rotas aunque el idioma se aceptara | Se dio por hecho que en Perú el separador era `;`. En es_PE el decimal es punto, así que el separador es la coma | Se deduce del idioma real con `Intl.NumberFormat`, la misma regla que usa Sheets |
| El rótulo del paso y su título salían en la misma línea | La clase de estado `hecho` que marca un paso cumplido chocaba con `.hecho`, un componente con `display: flex` (la fila de enlaces de «rendición creada»). El paso se volvía contenedor flex | Renombrada a `.paso.completo`, y comprobación nueva: ningún estado que el código conmute puede existir como regla suelta que fije `display` |
| La pantalla de elección contradecía a la cáscara | `volverAElegir()` solo cambiaba el centro: el encabezado seguía diciendo «Mi rendición» y la lateral ofrecía «Empezar de nuevo» sobre algo que aún no había empezado | Vuelve todo a neutro: título, ámbar de la lateral, nav y título del documento |
| La tercera intención quedaba huérfana abajo | `auto-fit, minmax(280px, 1fr)` en 760px de ancho da dos columnas, y la tercera bajaba sola como si fuera de otra categoría | Tres columnas fijas y la sección ensanchada a 1060px; en móvil, una columna y la del rendidor primero |
| La rendición mentía si se editaba una línea | Totales escritos como valores | Fórmulas vivas + columna SUSTENTA |
| La rendición no tenía sustento adjunto | Las imágenes no se subían en ese flujo | Se suben y cada fila enlaza a la suya |
| Los enlaces de la rendición no habrían funcionado nunca | `filasDePlantilla()` aplanaba a `campos` y perdía la huella; la fila quedaba con clave `serie-número` mientras los enlaces se guardaban por huella | Se conserva la huella al aplanar. Encontrado al construir el modo rendidor, antes de llegar a producción |

### Sobre la cascada de CSS, dos reglas aprendidas

- Una regla de autor con `display` **le gana** al `[hidden] { display: none }` del
  navegador. Por eso el único `!important` de la hoja es
  `[hidden] { display: none !important; }`, y está documentado.
- Un selector de elemento (`button`, 0-0-1) **pierde** contra uno de clase
  (`.nav-item`, 0-1-0).

`comprobaciones.mjs` vigila hoy: que ningún `th`/`td` quede en block, que el
`!important` de `[hidden]` siga ahí, que no haya reglas sobre el elemento
`button`, que todo `<button>` declare clase, que `td.estado span` no parta
líneas, y que exista en el HTML cada id que `main.js` consulta. Se corre con
`node comprobaciones.mjs`.

**Nota de honestidad:** esa herramienta produjo dos falsos positivos propios (una
búsqueda de texto ingenua que matcheaba comentarios, y un chequeo que señalaba
`td.mini img`, que apunta a la imagen y no a la celda). Ambos se reescribieron
para analizar el *sujeto* del selector. Si vuelve a dar un aviso raro,
sospechar de ella antes que del CSS.

---

## 11. Diseño

El sistema es el de **INROPRIN / Roland Print**, tomado literal de
`rotafolio-automotriz/app/globals.css` (el motor INRO VIÁTICOS):

```css
--accent: #00A298;  --accent-texto: #007A72;  --accent-suave: #E6F5F4;
--tinta: #1D1D1B;   --bg: #EDF1F4;            --info: #006DB1;
--ui: "DM Sans";    --display: "Sora";        --mono: ui-monospace;
--radio: 14px; --radio-s: 10px; --radio-l: 18px;
```

Hubo una corrección fuerte del usuario en el camino: «*no uses de juguete GRAMA!!!
innovate colores inroprin*» — se había usado el sistema de otra plataforma. La
referencia visual pedida fue **Image Inspector**, de ahí la lateral y los marcos.
El logo es el oficial (183×41) y el favicon es la marca tangram sola.

Otro ajuste pedido y aceptado: los botones **Cancelar / Vaciar / Registrar** se
bajaron al pie, porque registrar es el último paso y no tenía peso visual arriba.

---

## 12. Lo que está abierto

**Requiere a una persona:**

1. **Confirmar con Annie si la etiqueta «SOLO FT Y BOLETA» de la plantilla está
   mal.** La aritmética del memo 675 dice que la planilla de movilidad sí cuenta.
   Si confirma, corregir el texto de la etiqueta; si dice que no debe contar,
   cambiar el valor por defecto de la perilla.
2. **Configurar la clave de Gemini** — sigue «sin configurar», y sin ella no hay
   cuadre ni lectura de consolidado.
3. **Decidir deliberadamente, con quien sea dueño de viáticos, el solape
   InroScan ↔ INRO VIÁTICOS.** Ahora que InroScan genera rendiciones, hay dos
   sistemas haciendo lo mismo, y eso tarde o temprano hay que fusionarlo.

**Técnico:**

4. Hacer determinista el corte de columnas del consolidado, si se comprometen a
   un formato fijo. Hacen falta 2–3 consolidados de meses distintos para
   confirmar que las posiciones son estables.
5. **Correr la prueba 4 del spike** («Mi unidad»), dos veces y desde dos
   sesiones. El modo rendidor se apoya en que `drive.file` devuelve al listar
   lo que la propia aplicación creó; es documentación de Google, no algo
   verificado acá. Si no se cumple, la carpeta se duplicaría en cada sesión y
   habría que anotar su ID como se hizo con las carpetas del día.

**Nunca ejercitado contra la infraestructura real** (solo verificado en Node):
crear la hoja, fijar el idioma, escribir las fórmulas y subir las imágenes del
flujo de rendición; y todo el modo rendidor, incluida la creación de la carpeta
en «Mi unidad». Es lo primero que hay que probar de punta a punta.

---

## 13. La conversación de fondo sobre control

Vale conservarla, porque es la parte que ningún código explica.

**Pregunta del usuario:** *«por ser una hoja de cálculo es totalmente editable,
por lo que no representa un problema como tal, ¿no? ¿ya no existiría doble
validación, esa es la mayor diferencia, correcto?»*

La respuesta a la que se llegó:

- Que sea editable **no es un defecto, es el punto.** Una rendición que nadie
  puede corregir sería peor. Lo que cambia es que ahora los totales se
  recalculan solos cuando alguien corrige, en vez de quedar mintiendo.
- La doble validación **no desaparece: cambia de sujeto.** Antes contabilidad
  preguntaba «¿tecleó bien?». Ahora esa pregunta ya no tiene sentido, porque
  nadie tecleó. La pregunta que queda —y que es la que siempre importó— es
  **«¿corresponde este gasto?»**. Los enlaces por fila al papel en Drive existen
  justamente para sostener esa segunda pregunta.
- **La trampa a evitar (tautología):** si contabilidad «revalida» una rendición
  que InroScan generó a partir de los mismos comprobantes, el cuadre siempre va a
  calzar y no valida absolutamente nada. Si se quiere un control real, tiene que
  mirar otra cosa: la pertinencia del gasto, no su transcripción.

---

## 14. Para quien retome esto

- Todo el código lleva comentarios en castellano que explican **por qué**, no
  qué. Si un comentario dice que algo es deliberado, probablemente costó un bug
  descubrirlo.
- Antes de tocar CSS: `node comprobaciones.mjs`.
- Antes de confiar en una suposición sobre la API de Google: montar un spike,
  como se hizo con `drive.file`. Costó una tarde y ahorró el Picker entero.
- El `spike/index.html` sigue sirviendo, además, para **vaciar el registro**
  entre pruebas (escribiendo `VACIAR`).
