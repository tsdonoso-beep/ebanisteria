// La rendición como hoja de Google.
//
// Se crea una hoja nueva por rendición, dentro de la carpeta del día, con la
// misma estructura que la plantilla que hoy se llena a mano. La diferencia no
// es el formato sino el origen: los totales y el porcentaje salen calculados,
// no tecleados, y por tanto no pueden estar mal sumados.

import { cabeceras, motivo, sesion } from "./auth.js";
import { etiquetaTipo } from "./config.js";
import { calcular, filasDePlantilla } from "./rendicion.js";

const UNIDADES = "supportsAllDrives=true&includeItemsFromAllDrives=true";

/** dd/mm/aaaa, que es como se lee en el papel. */
function aPapel(iso) {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso ?? "");
}

const num = (v) => {
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
};

/**
 * Crea la hoja dentro de la carpeta.
 *
 * Se crea por la API de Drive y no por la de Sheets porque así nace ya en su
 * sitio: crearla con Sheets la deja en la raíz del Drive de quien la hizo y
 * habría que moverla después, con una llamada más que puede fallar sola y
 * dejar el archivo perdido.
 */
async function crearHoja(nombre, idCarpeta) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?${UNIDADES}&fields=id,webViewLink`, {
    method: "POST",
    headers: await cabeceras({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      name: nombre,
      mimeType: "application/vnd.google-apps.spreadsheet",
      parents: [idCarpeta],
    }),
  });
  if (!r.ok) throw new Error(`Drive [${r.status}]: ${await motivo(r)}`);
  return r.json();
}

/** Las celdas de la cabecera, en el orden de la plantilla. */
function bloqueCabecera(cab, cuentas) {
  const pct = cuentas.porcentaje === null ? "" : `${cuentas.porcentaje}% RENDIDO`;
  const periodo = [aPapel(cab.periodoDesde), aPapel(cab.periodoHasta)]
    .filter(Boolean).join(" al ");

  return [
    ["MEMORANDUM N°", cab.memo, "", ""],
    ["FECHA DE RENDICIÓN", aPapel(cab.fechaRendicion), "", ""],
    ["", "", "", ""],
    ["MONTO RECIBIDO:", "S/", num(cuentas.recibido), ""],
    ["MONTO RENDIDO:", "S/", num(cuentas.sustentado), pct],
    ["", "", "", ""],
    ["PROYECTO:", cab.proyecto, "", ""],
    ["", "", "", ""],
    ["NOMBRES:", cab.nombres, "", ""],
    ["APELLIDOS:", cab.apellidos, "", ""],
    ["DNI:", cab.dni, "", ""],
    ["ORIGEN Y DESTINO DE VIAJE:", cab.origenDestino, "", ""],
    ["PERIODO DE VIAJE:", periodo, "", ""],
    ["", "", "", ""],
  ];
}

/**
 * Escribe la rendición completa y devuelve su enlace.
 *
 * Lo que no está en la plantilla de papel pero sí acá: el saldo. Si se gastó
 * más de lo recibido hay un reembolso a favor de la persona, y si sobró hay
 * una devolución. En el papel esa cifra había que sacarla mentalmente.
 */
export async function generar({ cabecera, comprobantes, noCuentan, idCarpeta }) {
  const cuentas = calcular(comprobantes, cabecera, noCuentan);
  const filas = filasDePlantilla(comprobantes);

  const nombre = [
    "RENDICION",
    cabecera.memo || "sin-memo",
    [cabecera.nombres, cabecera.apellidos].filter(Boolean).join(" ").trim() || "sin-nombre",
  ].join(" · ");

  const hoja = await crearHoja(nombre, idCarpeta);

  const filasTabla = filas.map((f) => [
    aPapel(f.fecha), etiquetaTipo(f.tipo), f.numero, "S/", num(f.importe),
  ]);

  const saldo = num(cuentas.saldo);
  const cierre = [
    ["", "", "", "S/", num(cuentas.total)],
    ["", "", "", "", ""],
    ["No sustenta (declaraciones juradas)", "", "", "S/", num(cuentas.sinSustentar)],
    [saldo > 0 ? "Saldo por devolver" : saldo < 0 ? "Reembolso a favor" : "Saldo",
     "", "", "S/", Math.abs(saldo)],
  ];

  const valores = [
    ...bloqueCabecera(cabecera, cuentas),
    ["FECHA", "TIPO DE DOCUMENTO", "N° DOCUMENTO", "", "MONTO"],
    ...filasTabla,
    ...cierre,
    ["", "", "", "", ""],
    [`Generado por InroScan · ${sesion()?.correo ?? ""} · ${new Date().toLocaleString("es-PE")}`],
  ];

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${hoja.id}/values/` +
              `A1?valueInputOption=USER_ENTERED`;
  const r = await fetch(url, {
    method: "PUT",
    headers: await cabeceras({ "Content-Type": "application/json" }),
    body: JSON.stringify({ values: valores }),
  });
  if (!r.ok) throw new Error(`Sheets [${r.status}]: ${await motivo(r)}`);

  await darFormato(hoja.id, bloqueCabecera(cabecera, cuentas).length, filasTabla.length);
  return { ...hoja, cuentas, nombre };
}

/**
 * Formato mínimo pero deliberado: los rótulos en negrita, los montos con dos
 * decimales y alineados, y la cabecera de la tabla marcada. Sin esto la hoja
 * se lee como un volcado de datos y nadie la firmaría.
 */
async function darFormato(idHoja, filasCabecera, filasTabla) {
  const encabezadoTabla = filasCabecera;          // fila 0-indexada de FECHA/TIPO/…
  const primeraFila = encabezadoTabla + 1;
  const ultimaFila = primeraFila + filasTabla + 4;

  const peticiones = [
    // Rótulos de la cabecera en negrita.
    { repeatCell: {
      range: { sheetId: 0, startRowIndex: 0, endRowIndex: filasCabecera, startColumnIndex: 0, endColumnIndex: 1 },
      cell: { userEnteredFormat: { textFormat: { bold: true } } },
      fields: "userEnteredFormat.textFormat.bold" } },
    // Cabecera de la tabla: negrita sobre fondo suave.
    { repeatCell: {
      range: { sheetId: 0, startRowIndex: encabezadoTabla, endRowIndex: primeraFila, startColumnIndex: 0, endColumnIndex: 5 },
      cell: { userEnteredFormat: {
        textFormat: { bold: true },
        backgroundColor: { red: 0.965, green: 0.973, blue: 0.980 },
      } },
      fields: "userEnteredFormat(textFormat,backgroundColor)" } },
    // Los montos con dos decimales y a la derecha: una columna de cifras solo
    // se compara de un vistazo si la coma decimal cae siempre en el mismo sitio.
    { repeatCell: {
      range: { sheetId: 0, startRowIndex: 0, endRowIndex: ultimaFila, startColumnIndex: 4, endColumnIndex: 5 },
      cell: { userEnteredFormat: {
        numberFormat: { type: "NUMBER", pattern: "#,##0.00" },
        horizontalAlignment: "RIGHT",
      } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)" } },
    { repeatCell: {
      range: { sheetId: 0, startRowIndex: 3, endRowIndex: 5, startColumnIndex: 2, endColumnIndex: 3 },
      cell: { userEnteredFormat: {
        numberFormat: { type: "NUMBER", pattern: "#,##0.00" },
        textFormat: { bold: true },
      } },
      fields: "userEnteredFormat(numberFormat,textFormat)" } },
    { updateDimensionProperties: {
      range: { sheetId: 0, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 210 }, fields: "pixelSize" } },
    { updateDimensionProperties: {
      range: { sheetId: 0, dimension: "COLUMNS", startIndex: 1, endIndex: 3 },
      properties: { pixelSize: 170 }, fields: "pixelSize" } },
  ];

  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${idHoja}:batchUpdate`, {
    method: "POST",
    headers: await cabeceras({ "Content-Type": "application/json" }),
    body: JSON.stringify({ requests: peticiones }),
  });
  // El formato es cosmético: si falla, la rendición ya está escrita y vale.
  if (!r.ok) console.warn("No se pudo dar formato a la rendición:", await motivo(r));
}
