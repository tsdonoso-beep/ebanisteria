// Los campos de un comprobante, y cómo sacarlos de un texto.
//
// Esta es la primera lectura: expresiones regulares sobre lo que devolvió el
// OCR. Es gratis, instantánea y no consume cuota. Cuando no alcanza, el
// resultado se marca incompleto y recién ahí entra la IA.

import { normalizarCategoria } from "./config.js";

export const VACIO = () => ({
  tipo: "", serie: "", numero: "", fecha: "", ruc: "", proveedor: "",
  proyecto: "", area: "", responsable: "",
  categoria: "", subcategoria: "", clasificacion: "", descripcion: "",
  moneda: "PEN", subtotal: "", igv: "", importe: "",
});

/** Campos sin los que la fila no sirve para registro contable. */
const IMPRESCINDIBLES = ["fecha", "importe", "numero"];

export const estaCompleto = (c) => IMPRESCINDIBLES.every((k) => String(c?.[k] ?? "").trim());

export const faltantes = (c) =>
  IMPRESCINDIBLES.filter((k) => !String(c?.[k] ?? "").trim());

export const numero = (s) => {
  if (s === 0) return "0.00";
  if (!s) return "";
  // Los montos peruanos usan coma de millar y punto decimal.
  const n = parseFloat(String(s).replace(/,/g, "").replace(/[^\d.-]/g, ""));
  return isNaN(n) ? "" : n.toFixed(2);
};

/**
 * Identidad de un comprobante, para cruzarlo con la línea del consolidado.
 *
 * Se normaliza fuerte —sin ceros a la izquierda, sin guiones, sin mayúsculas—
 * porque el mismo comprobante aparece escrito de formas distintas en el papel
 * y en la rendición: F001-6384 y F001-006384 son el mismo, y 002-001175 se
 * teclea tan fácil como 2-1175.
 */
export function clave(serie, num) {
  const limpia = (v) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+(?=.)/, "");
  const s = limpia(serie), n = limpia(num);
  if (!s && !n) return "";
  return `${s}-${n}`;
}

/** La clave de un comprobante ya leído. */
export const claveDe = (c) => clave(c.serie, c.numero);

/**
 * Parte un «N° de comprobante» escrito de corrido en serie y número.
 *
 * Las planillas de movilidad vienen sin guion (010010): no tienen serie, y
 * forzarles una partición inventaría un dato.
 */
export function partirNumero(texto) {
  const t = String(texto ?? "").trim();
  const m = t.match(/^([A-Za-z0-9]{1,4})\s*[-–—]\s*(\d{1,10})$/);
  if (m) return { serie: m[1].toUpperCase(), numero: m[2].replace(/^0+(?=\d)/, "") };
  return { serie: "", numero: t.replace(/^0+(?=\d)/, "") };
}

/** Normaliza a ISO. Las boletas escriben la fecha de tres o cuatro formas. */
export function fechaISO(texto) {
  const t = String(texto ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(t.trim())) return t.trim();

  const m = t.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/);
  if (!m) return "";

  let [, d, mes, a] = m;
  if (a.length === 2) a = `20${a}`;
  const dd = Number(d), mm = Number(mes);
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return "";

  return `${a}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function tipoDe(texto, serie) {
  // La declaración jurada se reconoce por su encabezado y no tiene ni RUC ni
  // serie, así que hay que buscarla antes de intentar deducir por la serie.
  if (/DECLARACI[OÓ]N\s+JURADA/i.test(texto)) return "DJ";
  // El orden importa: «planilla de movilidad» y «recibo por honorarios» son
  // frases propias, y buscarlas antes evita que un «FACTURA» suelto en el pie
  // de página se lleve la clasificación.
  if (/PLANILLA\s+DE\s+MOVILIDAD/i.test(texto)) return "PLANILLA DE MOVILIDAD";
  if (/RECIBO\s+POR\s+HONORARIOS/i.test(texto)) return "RHE";
  if (/\bNOTA\s+DE\s+CR[EÉ]DITO\b/i.test(texto)) return "NOTA DE CRÉDITO";
  if (/\bFACTURA\b/i.test(texto) || /^F/i.test(serie)) return "FACTURA";
  if (/\bBOLETA\b/i.test(texto) || /^B/i.test(serie)) return "BOLETA";
  if (/\bTICKET\b/i.test(texto)) return "TICKET";
  return "";
}

/**
 * Razón social del emisor.
 *
 * Heurística deliberadamente conservadora: se queda con la primera línea larga
 * que parezca nombre de empresa y que no sea la dirección ni el propio título
 * del comprobante. Cuando no convence, prefiere devolver vacío y dejar que lo
 * corrija la IA o la persona, antes que colar una dirección como proveedor.
 */
function proveedorDe(texto) {
  for (const cruda of texto.split("\n").slice(0, 12)) {
    const linea = cruda.trim();
    if (linea.length < 6 || linea.length > 70) continue;
    if (/\d{6,}/.test(linea)) continue;
    if (/\b(RUC|BOLETA|FACTURA|TICKET|AV|AV\.|JR|JR\.|CALLE|MZ|LOTE|NRO)\b/i.test(linea)) continue;
    if (/^[\d\s/.:-]+$/.test(linea)) continue;
    if (/[A-Za-zÁÉÍÓÚÑ]{4,}/.test(linea)) return linea.replace(/\s+/g, " ");
  }
  return "";
}

/**
 * Serie y número del comprobante.
 *
 * El formato con letra —F001-6384, EB01-135, FW01-434— es solo una parte de lo
 * que circula. En los consolidados de caja chica reales aparecen también series
 * puramente numéricas (0001-003936, 002-001175), y una expresión que solo
 * buscara la letra inicial perdería alrededor de un tercio de las filas.
 */
function serieNumero(texto) {
  const re = /\b([A-Z]{1,2}\d{2,3}|\d{3,4})\s*[-–—]\s*(\d{1,8})\b/g;

  for (const m of texto.matchAll(re)) {
    const [, serie, num] = m;
    // Una fecha ISO entra en el mismo molde: 2026-09 son cuatro dígitos, guion
    // y dos más. Se descarta por el año, que ninguna serie usa.
    if (/^(19|20)\d{2}$/.test(serie) && num.length <= 2) continue;
    return { serie: serie.toUpperCase(), numero: num.replace(/^0+(?=\d)/, "") };
  }
  return { serie: "", numero: "" };
}

/**
 * Señales de que la imagen trae más de un comprobante.
 *
 * El OCR no sabe separar dos boletas puestas juntas en el cristal: devuelve un
 * único texto con los dos encima. Dos RUC distintos, o dos números de
 * comprobante distintos, delatan el caso — y entonces la lectura pasa a la IA,
 * que sí puede repartirlos.
 */
export function pareceVarios(texto) {
  const rucs = new Set((texto.match(/\b(?:10|15|17|20)\d{9}\b/g) ?? []));
  if (rucs.size > 1) return true;

  const numeros = new Set(
    [...texto.matchAll(/\b(?:[A-Z]{1,2}\d{2,3}|\d{3,4})\s*[-–—]\s*\d{1,8}\b/g)]
      .map((m) => m[0].replace(/\s/g, ""))
      .filter((s) => !/^(19|20)\d{2}-\d{1,2}$/.test(s))
  );
  return numeros.size > 1;
}

/** Primera lectura: solo expresiones regulares sobre el texto del OCR. */
export function leerTexto(texto) {
  const c = VACIO();
  const plano = String(texto ?? "").replace(/\u00a0/g, " ");

  // Los RUC peruanos empiezan en 10, 15, 17 o 20 y tienen once dígitos.
  c.ruc = plano.match(/\b((?:10|15|17|20)\d{9})\b/)?.[1] ?? "";

  Object.assign(c, serieNumero(plano));
  c.fecha = fechaISO(plano);
  c.tipo = tipoDe(plano, c.serie);
  c.proveedor = proveedorDe(plano);

  // «TOTAL A PAGAR» gana sobre «TOTAL» a secas: en las boletas con descuento
  // el primero es el que se paga de verdad.
  const total = plano.match(/TOTAL\s*A\s*PAGAR\s*:?\s*(?:S\/|US\$|\$)?\s*([\d,]+\.\d{2})/i)
             ?? plano.match(/\bTOTAL\s*:?\s*(?:S\/|US\$|\$)?\s*([\d,]+\.\d{2})/i);
  c.importe = numero(total?.[1]);

  c.igv = numero(plano.match(/\bIGV\b[^\d]{0,12}([\d,]+\.\d{2})/i)?.[1]);
  c.subtotal = numero(
    plano.match(/(?:SUB\s*TOTAL|OP\.?\s*GRAVAD[AO]S?)\s*:?\s*(?:S\/|\$)?\s*([\d,]+\.\d{2})/i)?.[1]
  );

  // Si falta el subtotal pero están el importe y el IGV, sale de restar. Es
  // aritmética, no adivinanza, y ahorra una llamada a la IA.
  if (!c.subtotal && c.importe && c.igv) {
    c.subtotal = (Number(c.importe) - Number(c.igv)).toFixed(2);
  }

  c.moneda = /\b(US\$|USD|D[OÓ]LARES)\b/i.test(plano) ? "USD" : "PEN";
  return c;
}

/** Normaliza lo que devolvió la IA a la forma interna. */
export function desdeIA(obj) {
  const c = VACIO();
  if (!obj) return c;

  for (const k of Object.keys(c)) {
    const v = obj[k];
    if (v != null && String(v).trim()) c[k] = String(v).trim();
  }
  // La IA puede devolver el número entero en vez de partido.
  if (!c.serie && /[-–—]/.test(c.numero)) Object.assign(c, partirNumero(c.numero));

  // Y al revés: las planillas de movilidad no tienen serie —su número va
  // corrido, 010010— así que la IA lo deposita en «serie» y deja «numero»
  // vacío. Una serie sola no identifica nada: si no hay número, lo que hay
  // en serie ES el número.
  // Los ceros a la izquierda se conservan tal como están impresos: la planilla
  // 010010 se escribe así en el consolidado y en el papel, y recortarlos haría
  // que la misma planilla se viera distinta según por qué camino se leyó. Para
  // emparejar ya normaliza clave(), que es donde corresponde.
  if (!c.numero && /^\d+$/.test(c.serie)) {
    c.numero = c.serie;
    c.serie = "";
  }

  c.fecha = fechaISO(c.fecha || obj.fechaEmision);
  c.importe = numero(c.importe || obj.total);
  c.igv = numero(c.igv);
  c.subtotal = numero(c.subtotal);
  c.moneda = c.moneda === "USD" ? "USD" : "PEN";
  // La categoría es lo único que la IA deduce, y por eso es lo único que hay
  // que encarrilar: sin esto «Alimentacion», «ALIMENTOS» y «Comida» serían
  // tres categorías distintas y no se podría sumar por ninguna.
  c.categoria = normalizarCategoria(c.categoria);
  return c;
}

/** Funde lo que trajo la IA sobre lo que ya había, sin borrar lo que sirve. */
export function fundir(base, nuevos) {
  const salida = { ...base };
  for (const [k, v] of Object.entries(nuevos ?? {})) {
    const valor = String(v ?? "").trim();
    if (valor && !String(salida[k] ?? "").trim()) salida[k] = valor;
  }
  return salida;
}
