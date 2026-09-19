# InroScan · Contabilidad

Herramienta para que el área de contabilidad suba comprobantes (fotos, escaneos
o PDF), los lea automáticamente y quede registro ordenado en Drive y Sheets.

Es **temporal y deliberadamente**: sirve para generar confianza mientras avanza
la adopción de INRO VIÁTICOS. Por eso no comparte datos con viáticos todavía y
se apoya en configuración antes que en una base de datos.

Estado: **validando la arquitectura**. Todavía no hay aplicación.

---

## Decisiones tomadas

| Tema | Decisión | Por qué |
|---|---|---|
| Alojamiento | Estático en GitHub Pages | Mismo molde que IMPOPRINT, que el equipo ya usa y acepta |
| Backend | Ninguno | Sin servidor no hay clave privada que custodiar ni costo que justificar |
| Identidad | Google Identity Services, cuenta `@inroprin.com` | La app escribe como la persona, no como una cuenta de servicio |
| Almacenamiento | Drive (unidad compartida) + Sheets | Sin base de datos: el Sheet es el registro |
| Carpetas | Solo por fecha — `/InroScan/2026/09/19/` | Reconfigurar la taxonomía después será cambiar una columna, no mover archivos |
| Centro de costos | Columna del Sheet, asignada al lanzar el lote | Si va en la ruta, cambiarlo obliga a migrar Drive |
| Unidad de registro | Una fila por imagen, o por página de PDF | 12 páginas son 12 comprobantes |
| Clave de IA | Por persona, en `localStorage` | Puente mientras se mide el volumen; el destino es un pool en servidor |

### Por qué la carpeta va solo por fecha

La fecha es el único eje que nunca se va a querer reorganizar. Todo lo demás
—centro de costos, proveedor, tipo de comprobante— vive como columna del Sheet,
donde reordenar cuesta una fórmula en vez de una migración de archivos.

### Qué protege de verdad el acceso

El Client ID y la API Key son públicos: van visibles en cualquier sitio
estático y no son secretos. El control real son tres cosas, en este orden:

1. La pantalla de consentimiento en modo **Internal**, que limita el acceso a
   las cuentas del Workspace de la organización.
2. Los permisos de la carpeta de Drive y de la hoja de cálculo.
3. El alcance `drive.file`, que solo da acceso a los archivos que la app creó,
   nunca al Drive completo de la persona.

La comprobación de dominio que hace la interfaz es comodidad, no seguridad: una
app estática no puede imponerla por su cuenta.

---

## Preparar el proyecto en Google Cloud

Una sola vez, con permisos de administrador del Workspace.

1. **Crear el proyecto** en [console.cloud.google.com](https://console.cloud.google.com)
   (por ejemplo `inroscan-contabilidad`).
2. **Habilitar dos APIs** en *APIs y servicios → Biblioteca*:
   Google Drive API y Google Sheets API.
3. **Pantalla de consentimiento** → tipo de usuario **Internal**. Es el paso que
   restringe el acceso a `@inroprin.com`; no lo dejes en External.
4. **Credenciales → Crear → ID de cliente de OAuth**, tipo *Aplicación web*.
   En *Orígenes autorizados de JavaScript* agrega:
   - `http://localhost:8000` — para probar en local
   - `https://tsdonoso-beep.github.io` — para GitHub Pages
   Copia el **Client ID**.
5. **Credenciales → Crear → Clave de API**. Solo la necesita el Picker.
   Restringila a las dos APIs de arriba.
6. **Crear en Drive** una carpeta en una unidad compartida y una hoja de
   cálculo, y compartir ambas con quienes vayan a usar la herramienta.

   > La carpeta debe estar en una **unidad compartida**, no en el Drive personal
   > de alguien. En una unidad compartida los archivos pertenecen a la
   > organización, así que nadie se los lleva al irse.

---

## La prueba pendiente

Antes de construir la aplicación hay una duda que decide el diseño de toda la
pantalla de carga:

> ¿`drive.file` alcanza para escribir en una carpeta que la app no creó, usando
> solo su ID? ¿O hay que hacer que la persona la elija con Google Picker?

Si alcanza con el ID, la carga es directa. Si no, cada persona tendrá que elegir
la carpeta una primera vez y habrá que recordar esa elección. Son dos interfaces
distintas, y construir la equivocada cuesta rehacerla.

`spike/index.html` responde eso. Es una página autocontenida, sin dependencias
ni compilación.

```bash
python3 -m http.server 8000 --directory spike
# abrir http://localhost:8000
```

Pega el Client ID, la API Key y los dos IDs; entra con tu cuenta y corre las
pruebas en orden. El panel de resultado muestra el código HTTP y el mensaje de
Google, que es donde está el motivo real cuando algo falla.

**Cómo leer el resultado:** un `404` en la prueba 2A no significa que la carpeta
no exista — la API de Drive responde 404 tanto para «no existe» como para «no
autorizado». Si 2A da 404 y 2B funciona, el veredicto es que hace falta Picker.

---

## Después de la prueba

Con el veredicto en mano, lo siguiente es la aplicación: captura por cámara
(`<input type="file" capture="environment">`, que abre la cámara nativa en
celular), partido de PDF por página con pdf.js, lectura con Tesseract y respaldo
con Gemini, tabla editable antes de registrar, y escritura a Drive y Sheets.

El motor de lectura no se escribe de cero: `lib/ocr/motor.ts` y
`lib/extraccion/prompt.ts` de **ROTAFOLIO-AUTOMOTRIZ** ya corren en el navegador
y son portables tal cual.

El registro nunca debería ser automático. La tabla editable de IMPOPRINT —con
las celdas amarillas que se corrigen antes de exportar— es el patrón que el
equipo ya aceptó, y contabilidad confía en lo que revisó, no en lo que apareció
solo.
