// Los campos de un comprobante peruano, y cómo sacarlos de un texto.
//
// Esta es la primera lectura: expresiones regulares sobre lo que devolvió el
// OCR. Es gratis, instantánea y no consume cuota. Cuando no alcanza, el
// resultado se marca incompleto y recién ahí entra la IA.

export const VACIO = () => ({
  tipo: "", serie: "", numero: "", fechaEmision: "",
  ruc: "", proveedor: "", moneda: "PEN",
  subtotal: "", igv: "", total: "",
});

/** Campos sin los que la fila no sirve para registro contable. */
const IMPRESCINDIBLES = ["ruc", "total", "fechaEmision"];

export const estaCompleto = (c) => IMPRESCINDIBLES.every((k) => String(c[k] ?? "").trim());

export const faltantes = (c) =>
  IMPRESCINDIBLES.filter((k) => !String(c[k] ?? "").trim());

const numero = (s) => {
  if (!s) return "";
  // Los montos peruanos usan coma de millar y punto decimal.
  const n = parseFloat(String(s).replace(/,/g, "").replace(/[^\d.]/g, ""));
  return isNaN(n) ? "" : n.toFixed(2);
};

/** Normaliza a ISO. Las boletas escriben la fecha de tres o cuatro formas. */
function fechaISO(texto) {
  const m = texto.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/);
  if (!m) return "";

  let [, d, mes, a] = m;
  if (a.length === 2) a = `20${a}`;
  const dd = Number(d), mm = Number(mes);
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return "";

  return `${a}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function tipoDe(texto, serie) {
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
    const [, serie, numero] = m;
    // Una fecha ISO entra en el mismo molde: 2026-09 son cuatro dígitos, guion
    // y dos más. Se descarta por el año, que ninguna serie usa.
    if (/^(19|20)\d{2}$/.test(serie) && numero.length <= 2) continue;
    return { serie: serie.toUpperCase(), numero: numero.replace(/^0+(?=\d)/, "") };
  }
  return { serie: "", numero: "" };
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

/** Primera lectura: solo expresiones regulares sobre el texto del OCR. */
export function leerTexto(texto) {
  const c = VACIO();
  const plano = texto.replace(/ /g, " ");

  // Los RUC peruanos empiezan en 10, 15, 17 o 20 y tienen once dígitos.
  c.ruc = plano.match(/\b((?:10|15|17|20)\d{9})\b/)?.[1] ?? "";

  Object.assign(c, serieNumero(plano));

  c.fechaEmision = fechaISO(plano);
  c.tipo = tipoDe(plano, c.serie);
  c.proveedor = proveedorDe(plano);

  // «TOTAL A PAGAR» gana sobre «TOTAL» a secas: en las boletas con descuento
  // el primero es el que se paga de verdad.
  const total = plano.match(/TOTAL\s*A\s*PAGAR\s*:?\s*(?:S\/|US\$|\$)?\s*([\d,]+\.\d{2})/i)
             ?? plano.match(/\bTOTAL\s*:?\s*(?:S\/|US\$|\$)?\s*([\d,]+\.\d{2})/i);
  c.total = numero(total?.[1]);

  c.igv = numero(plano.match(/\bIGV\b[^\d]{0,12}([\d,]+\.\d{2})/i)?.[1]);
  c.subtotal = numero(
    plano.match(/(?:SUB\s*TOTAL|OP\.?\s*GRAVAD[AO]S?)\s*:?\s*(?:S\/|\$)?\s*([\d,]+\.\d{2})/i)?.[1]
  );

  // Si falta el subtotal pero están total e IGV, sale de restar. Es aritmética,
  // no adivinanza, y ahorra una llamada a la IA.
  if (!c.subtotal && c.total && c.igv) {
    c.subtotal = (Number(c.total) - Number(c.igv)).toFixed(2);
  }

  c.moneda = /\b(US\$|USD|D[OÓ]LARES)\b/i.test(plano) ? "USD" : "PEN";
  return c;
}

/** Funde lo que trajo la IA sobre lo que ya había, sin borrar lo que sirve. */
export function fundir(base, nuevos) {
  const salida = { ...base };
  for (const [k, v] of Object.entries(nuevos ?? {})) {
    const valor = String(v ?? "").trim();
    if (valor && !String(salida[k] ?? "").trim()) salida[k] = valor;
  }
  if (salida.total) salida.total = numero(salida.total);
  if (salida.igv) salida.igv = numero(salida.igv);
  if (salida.subtotal) salida.subtotal = numero(salida.subtotal);
  return salida;
}
