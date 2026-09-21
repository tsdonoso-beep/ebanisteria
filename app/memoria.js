// Lo que ya se leyó no se vuelve a leer.
//
// Cada consulta a la IA cuesta cuota, y hoy se perdía por nada: recargar la
// página, volver a subir el mismo lote o repetir un comprobante que apareció
// en otra rendición obligaba a pagarlo de nuevo. La lectura de un papel no
// cambia con el tiempo, así que guardarla es gratis y evidente.
//
// Se guardan los CAMPOS, nunca las imágenes. Una imagen comprimida ocupa entre
// doscientos y quinientos kilobytes, y el almacén del navegador ronda los cinco
// megas: una decena de comprobantes lo agotaría y rompería la sesión entera.
// Un juego de campos ocupa unos trescientos bytes, así que caben miles.

const CLAVE = "inroscan_memoria";

/** Tope de entradas. Al pasarlo se sueltan las más viejas. */
const MAXIMO = 4000;

/** Cuánto vale una lectura antes de releerla por si el motor mejoró. */
const VIGENCIA_MS = 90 * 24 * 60 * 60 * 1000;   // 90 días

let cache = null;

function cargar() {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(CLAVE) ?? "{}");
  } catch {
    // Un almacén corrupto no debe impedir trabajar: se empieza de cero.
    cache = {};
  }
  return cache;
}

function guardar() {
  const entradas = Object.entries(cache);

  // Se podan las más antiguas antes de escribir, no después de fallar: si el
  // almacén se llena, el navegador lanza y se perdería la escritura entera.
  if (entradas.length > MAXIMO) {
    entradas.sort((a, b) => (b[1].cuando ?? 0) - (a[1].cuando ?? 0));
    cache = Object.fromEntries(entradas.slice(0, MAXIMO));
  }

  try {
    localStorage.setItem(CLAVE, JSON.stringify(cache));
  } catch {
    // Sin sitio: se conserva lo de esta sesión en memoria y se sigue. Perder
    // la memoria entre sesiones es molesto; perder el lote en curso, no.
    console.warn("La memoria de lecturas no cabe en este navegador.");
  }
}

/**
 * Lo leído antes para esa huella, o null.
 *
 * La huella es del contenido del archivo, así que la misma boleta escaneada
 * dos veces en el mismo archivo acierta, pero fotografiada de nuevo no: son
 * imágenes distintas aunque el papel sea el mismo. Es el comportamiento
 * correcto —una foto nueva puede leerse mejor— y por eso la detección de
 * duplicados usa el número del comprobante y no esto.
 */
export function recordar(huella) {
  const e = cargar()[huella];
  if (!e) return null;
  if (Date.now() - (e.cuando ?? 0) > VIGENCIA_MS) return null;
  return { campos: e.campos, via: e.via, deMemoria: true };
}

/** Anota una lectura. Las incompletas no se guardan: se querrán reintentar. */
export function anotar(huella, campos, via) {
  if (!huella || via === "parcial") return;
  cargar()[huella] = { campos, via, cuando: Date.now() };
  guardar();
}

/** Cuántas lecturas hay guardadas, para poder decirlo en la interfaz. */
export const cuantasRecuerda = () => Object.keys(cargar()).length;

export function olvidarTodo() {
  cache = {};
  try { localStorage.removeItem(CLAVE); } catch { /* da igual */ }
}
