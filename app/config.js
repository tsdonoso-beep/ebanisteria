// Configuración de la herramienta.
//
// Nada de esto es secreto. El Client ID viaja visible en cualquier aplicación
// estática, y los IDs de la carpeta y de la hoja no sirven de nada sin permiso
// sobre ellas. El acceso real lo deciden tres cosas: la pantalla de
// consentimiento en modo Internal, los permisos de la unidad compartida, y el
// alcance drive.file, que solo da acceso a lo que esta aplicación crea.

export const CLIENT_ID =
  "951030676058-igp95ct69p03lcpt02vtjs79t5dmsrij.apps.googleusercontent.com";

/** Carpeta raíz en la unidad compartida. Dentro se crea una por día. */
export const CARPETA_RAIZ = "1luJMlROtAYYurXcnaAw3K8TURC_4qKBK";

/** Hoja de registro. */
export const HOJA = "1aRzq1ShOW6bD4MYZGNR0FuPcMewG2BVHbO2Qpc36o9E";

/** Pestaña donde se acumulan los comprobantes registrados. */
export const PESTANA_REGISTRO = "Registro";

/**
 * Pestaña que mapea fecha → ID de la carpeta de ese día.
 *
 * Existe por una limitación de drive.file: cada persona solo alcanza los
 * archivos que su propia sesión creó. Si Rosa crea la carpeta del martes, la
 * aplicación de David no la encuentra al listar y crearía una segunda con el
 * mismo nombre. Anotando el ID en la hoja, cualquiera lo lee y lo usa como
 * destino — crear dentro de una carpeta ajena sí funciona, que es justo lo que
 * comprobó la prueba del spike.
 */
export const PESTANA_CARPETAS = "Carpetas";

export const GEMINI_MODELO = "gemini-3.1-flash-lite-preview";

/** Columnas del registro, en orden. El encabezado se siembra solo. */
export const COLUMNAS = [
  "Extraído", "Centro de costo", "Tipo", "Serie", "Número", "Fecha emisión",
  "RUC", "Proveedor", "Moneda", "Subtotal", "IGV", "Total",
  "Archivo", "Origen", "Página", "Leído con", "Huella", "Registró",
];

/**
 * Centros de costo. Se elige uno al lanzar el lote y se aplica a todo el lote.
 *
 * Provisional: mientras la herramienta gana confianza esta lista se edita acá.
 * Cuando el uso lo justifique, pasará a leerse de una pestaña de la hoja para
 * que contabilidad la mantenga sin tocar el código.
 */
export const CENTROS_COSTO = [
  "Administración",
  "Almacén",
  "Contabilidad",
  "Logística",
  "Mantenimiento",
  "Obra",
  "Postventa",
  "Taller",
  "Tesorería",
];

// --- preferencias por navegador -----------------------------------------

const CLAVE_GEMINI = "inroscan_gemini_key";
const CLAVE_CENTRO = "inroscan_centro";

export const getClaveGemini = () => localStorage.getItem(CLAVE_GEMINI) ?? "";
export const setClaveGemini = (k) => localStorage.setItem(CLAVE_GEMINI, k);
export const borrarClaveGemini = () => localStorage.removeItem(CLAVE_GEMINI);

export const getCentro = () => localStorage.getItem(CLAVE_CENTRO) ?? "";
export const setCentro = (c) => localStorage.setItem(CLAVE_CENTRO, c);

/** Las claves de Gemini empiezan con AIza. Otras credenciales de Google no
 *  sirven acá, y el error que devuelve la API no lo explica. */
export const pareceClaveGemini = (k) => /^AIza[\w-]{20,}$/.test(k.trim());

export const enmascarar = (k) =>
  k.length < 12 ? "••••" : `${k.slice(0, 6)}••••${k.slice(-4)}`;
