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

export const PESTANA_REGISTRO = "Registro";
export const PESTANA_CONSOLIDADO = "Consolidados";

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

/**
 * Columnas del registro.
 *
 * El vocabulario sale del consolidado de caja chica real, no de una invención
 * nuestra: proyecto, área, responsable, categoría, subcategoría y
 * clasificación son las columnas que contabilidad ya usa. Un registro que
 * hable otro idioma obliga a traducir a mano y no le sirve a nadie.
 */
export const COLUMNAS = [
  "Extraído", "Fecha", "Tipo", "Serie", "Número", "RUC", "Proveedor",
  "Proyecto", "Área", "Responsable", "Categoría", "Subcategoría",
  "Clasificación", "Descripción",
  "Moneda", "Subtotal", "IGV", "Importe",
  "Archivo", "Origen", "Página", "Leído con", "Huella", "Clave", "Registró",
];

/** Columnas de la pestaña de consolidados, una fila por línea rendida. */
export const COLUMNAS_CONSOLIDADO = [
  "Leído", "Caja", "Administrador", "Fecha", "Tipo", "N° comprobante",
  "Proveedor", "Proyecto", "Área", "Responsable", "Categoría", "Subcategoría",
  "Clasificación", "Descripción", "Importe", "Clave", "Origen", "Registró",
];

/**
 * Tipos de documento, y si cuentan para el monto rendido.
 *
 * La distinción sale de la plantilla de rendición real: en el memo 675, doce
 * comprobantes suman S/ 347.50 pero el «monto rendido» es S/ 242.00 — la
 * diferencia son exactamente las dos declaraciones juradas. Una DJ no es
 * documento válido ante SUNAT, así que se digitaliza y se archiva igual, pero
 * no suma al porcentaje que se rinde.
 *
 * `cuenta` es el valor de partida, no una ley: cada rendición puede cambiarlo
 * desde la interfaz, porque la regla varía según quién la revise.
 */
export const TIPOS = [
  { id: "FACTURA",              etiqueta: "Factura",              cuenta: true },
  { id: "BOLETA",               etiqueta: "Boleta",               cuenta: true },
  { id: "TICKET",               etiqueta: "Ticket",               cuenta: true },
  { id: "RHE",                  etiqueta: "Recibo por honorarios", cuenta: true },
  { id: "PLANILLA DE MOVILIDAD", etiqueta: "Planilla de movilidad", cuenta: true },
  { id: "NOTA DE CRÉDITO",      etiqueta: "Nota de crédito",      cuenta: true },
  // Declaración jurada: se digitaliza y se archiva, pero no sustenta ante
  // SUNAT. Es la única que arranca fuera del cómputo.
  { id: "DJ",                   etiqueta: "Declaración jurada",   cuenta: false },
  { id: "OTRO",                 etiqueta: "Otro",                 cuenta: false },
];

/** Los tipos que por defecto no suman al monto rendido. */
export const NO_CUENTAN_POR_DEFECTO = TIPOS.filter((t) => !t.cuenta).map((t) => t.id);

export const etiquetaTipo = (id) =>
  TIPOS.find((t) => t.id === id)?.etiqueta ?? id ?? "";

/** Campos que se heredan del consolidado al comprobante cuando cuadran. */
export const HEREDABLES = [
  "proyecto", "area", "responsable", "categoria", "subcategoria",
  "clasificacion", "descripcion",
];

/**
 * Qué viene a hacer la persona, y sobre qué proceso.
 *
 * Se separa por trabajo y no por tipo de documento: alguien sabe a qué vino,
 * pero puede no saber cómo clasificar el PDF que tiene delante. Y son trabajos
 * distintos de verdad —uno audita algo ya cerrado, el otro lo construye—,
 * aunque el motor de lectura sea el mismo.
 */
export const INTENCIONES = [
  {
    id: "revalidar", titulo: "Revalidar una rendición", area: "Contabilidad",
    descripcion: "Ya existe el documento cerrado. Se cruza contra los " +
                 "comprobantes para ver qué cuadra, qué no tiene sustento y " +
                 "qué importes no coinciden.",
  },
  {
    id: "digitalizar", titulo: "Digitalizar comprobantes", area: "Administración",
    descripcion: "Todavía no hay rendición. Se leen los comprobantes sueltos " +
                 "y la herramienta arma el documento con sus totales.",
  },
  // El tercero no es del área: es quien gastó. Su rendición no nace en la
  // unidad compartida sino en su propio Drive, porque son sus gastos y puede
  // ni siquiera tener acceso a la unidad de contabilidad. Llega al área
  // cuando él comparte la hoja, no antes.
  {
    id: "rendir", titulo: "Rendir mis gastos", area: "Quien viaja", propia: true,
    descripcion: "Desde el teléfono. Fotografía tus comprobantes conforme " +
                 "los recibes, ponle el número de tu memo, y la herramienta " +
                 "arma tu rendición en tu propio Drive.",
  },
];

/** Si la intención trabaja contra el Drive de la persona y no contra el del área. */
export const esPropia = (id) => INTENCIONES.find((i) => i.id === id)?.propia === true;

export const PROCESOS = [
  { id: "caja",     titulo: "Caja chica",      cabecera: "consolidado" },
  { id: "viaticos", titulo: "Memo de viáticos", cabecera: "memo" },
];

const CLAVE_MODO = "inroscan_modo";

export function getModo() {
  try {
    const m = JSON.parse(localStorage.getItem(CLAVE_MODO) ?? "null");
    const valida = INTENCIONES.some((i) => i.id === m?.intencion) &&
                   PROCESOS.some((p) => p.id === m?.proceso);
    return valida ? m : null;
  } catch {
    return null;
  }
}

export const setModo = (m) => localStorage.setItem(CLAVE_MODO, JSON.stringify(m));
export const olvidarModo = () => localStorage.removeItem(CLAVE_MODO);

// --- preferencias por navegador -----------------------------------------

const CLAVE_GEMINI = "inroscan_gemini_key";
const CLAVE_PROYECTO = "inroscan_proyecto";

export const getClaveGemini = () => localStorage.getItem(CLAVE_GEMINI) ?? "";
export const setClaveGemini = (k) => localStorage.setItem(CLAVE_GEMINI, k);
export const borrarClaveGemini = () => localStorage.removeItem(CLAVE_GEMINI);

/**
 * Proyecto por defecto del lote.
 *
 * Se elige al cargar y se aplica a todo lo que entre, pero cada fila se puede
 * cambiar: el consolidado real mezcla cuatro proyectos en una misma caja, así
 * que fijarlo por lote y no dejarlo editar obligaría a subir en tandas.
 * Cuando un comprobante cuadra con una línea del consolidado, el proyecto de
 * esa línea manda sobre este.
 */
export const getProyecto = () => localStorage.getItem(CLAVE_PROYECTO) ?? "";
export const setProyecto = (p) => localStorage.setItem(CLAVE_PROYECTO, p);

/** Las claves de Gemini empiezan con AIza. Otras credenciales de Google no
 *  sirven acá, y el error que devuelve la API no lo explica. */
export const pareceClaveGemini = (k) => /^AIza[\w-]{20,}$/.test(k.trim());

export const enmascarar = (k) =>
  k.length < 12 ? "••••" : `${k.slice(0, 6)}••••${k.slice(-4)}`;
