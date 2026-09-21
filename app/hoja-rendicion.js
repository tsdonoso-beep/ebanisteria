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

/**
 * Las columnas de la tabla, por letra.
 *
 * Están en constantes y no escritas dentro de cada fórmula porque la tabla ya
 * creció una vez: al añadir proveedor, concepto y categoría, el monto pasó de
 * E a H y el sustento de F a I. Con las letras sueltas por el archivo, mover
 * una columna es encontrar siete fórmulas y no olvidarse de ninguna.
 */
const MONTO = "H";
const SUSTENTA = "I";
/** Cuántas columnas ocupa la tabla, para el formato. */
const ANCHO = 9;

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

/**
 * Idiomas a intentar, en orden de preferencia.
 *
 * `es_PE` parecía obvio y Sheets lo rechaza con «Unsupported locale». La
 * lista de idiomas que admite es de Google y no está publicada entera, así
 * que se prueban candidatos en vez de apostar por uno; si ninguno entra, la
 * hoja se queda como nació y abajo se lee cuál quedó.
 *
 * No están `es_ES` ni `es`, y la razón es de dinero y no de idioma: en España
 * el decimal es coma, así que S/ 1234.50 se mostraría como 1.234,50. En Perú
 * el decimal es punto. Entre una hoja en inglés con los importes bien y una
 * en castellano con los importes cambiados de forma, la primera es menos
 * peligrosa.
 */
const IDIOMAS = ["es_PE", "es_419"];

/** Una propiedad de la hoja, sin reventar si Sheets la rechaza. */
async function intentarPropiedad(idHoja, propiedades, campos) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${idHoja}:batchUpdate`, {
    method: "POST",
    headers: await cabeceras({ "Content-Type": "application/json" }),
    body: JSON.stringify({ requests: [{ updateSpreadsheetProperties: { properties: propiedades, fields: campos } }] }),
  });
  if (r.ok) return true;
  console.warn(`Sheets no aceptó ${campos}:`, await motivo(r));
  return false;
}

async function idiomaDe(idHoja) {
  const r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${idHoja}?fields=properties.locale`,
    { headers: await cabeceras() });
  if (!r.ok) throw new Error(`Sheets [${r.status}]: ${await motivo(r)}`);
  return (await r.json()).properties?.locale ?? "en_US";
}

/**
 * Deja la hoja en castellano si se deja, y devuelve el idioma que quedó.
 *
 * Ninguno de los dos ajustes es imprescindible —la rendición vale igual en
 * inglés— así que un rechazo no puede tumbar el trabajo entero. Antes sí lo
 * hacía: la hoja ya estaba creada y las fotos subidas cuando el idioma
 * fallaba, y la persona se quedaba con una hoja vacía en su Drive y un error
 * en rojo.
 */
async function acomodarIdioma(idHoja) {
  // La zona horaria va aparte: si el idioma no entra, esta ya quedó puesta.
  await intentarPropiedad(idHoja, { timeZone: "America/Lima" }, "timeZone");
  for (const l of IDIOMAS) {
    if (await intentarPropiedad(idHoja, { locale: l }, "locale")) break;
  }
  return idiomaDe(idHoja);
}

/**
 * El separador de argumentos de las fórmulas, deducido del idioma.
 *
 * Donde el decimal es coma, el separador de argumentos es punto y coma, y al
 * revés. En vez de mantener una tabla de idiomas se le pregunta al propio
 * navegador cómo escribe 1,1 en ese idioma: es la misma regla y no se queda
 * vieja.
 *
 * Esto además corrige un error que el fallo del idioma dejó al descubierto:
 * se daba por hecho que en Perú el separador era «;», y no lo es. En es_PE el
 * decimal es punto, así que el separador es la coma —como en inglés—. Las
 * fórmulas escritas con «;» habrían entrado rotas aunque el idioma se hubiera
 * aceptado.
 */
function separadorDe(idioma) {
  try {
    return new Intl.NumberFormat(String(idioma).replace("_", "-"))
      .format(1.1).includes(",") ? ";" : ",";
  } catch {
    return ",";
  }
}

/**
 * Las celdas de la cabecera, en el orden de la plantilla.
 *
 * Los totales van como FÓRMULAS y no como números. Es una hoja de cálculo: en
 * cuanto alguien corrija el importe de una línea —y va a corregirlo, para eso
 * se revisa— un total escrito a mano quedaría mintiendo sin avisar. Con
 * fórmulas, corregir una línea recalcula el total y el porcentaje solos.
 */
function bloqueCabecera(cab, cuentas, rangos, s) {
  const periodo = [aPapel(cab.periodoDesde), aPapel(cab.periodoHasta)]
    .filter(Boolean).join(" al ");

  // El porcentaje se protege de la división por cero: sin monto recibido, la
  // celda queda vacía en vez de mostrar un error de hoja de cálculo.
  const pct = `=IF(C4=0${s}""${s}TEXT(C5/C4${s}"0%")&" RENDIDO")`;

  // Un campo sin llenar tiene que quedar en blanco, no escribir «null»: en una
  // hoja que alguien firma, esa palabra parece un error del sistema.
  const t = (v) => (v == null ? "" : String(v));

  return [
    ["MEMORANDUM N°", t(cab.memo), "", ""],
    ["FECHA DE RENDICIÓN", aPapel(cab.fechaRendicion), "", ""],
    ["", "", "", ""],
    ["MONTO RECIBIDO:", "S/", num(cuentas.recibido), ""],
    ["MONTO RENDIDO:", "S/", rangos.sustentado, pct],
    ["", "", "", ""],
    ["PROYECTO:", t(cab.proyecto), "", ""],
    ["", "", "", ""],
    ["NOMBRES:", t(cab.nombres), "", ""],
    ["APELLIDOS:", t(cab.apellidos), "", ""],
    ["DNI:", t(cab.dni), "", ""],
    ["ORIGEN Y DESTINO DE VIAJE:", t(cab.origenDestino), "", ""],
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
export async function generar({ cabecera, comprobantes, noCuentan, idCarpeta, enlaces = {} }) {
  const cuentas = calcular(comprobantes, cabecera, noCuentan);
  const filas = filasDePlantilla(comprobantes);
  const excluidos = new Set(noCuentan ?? []);

  const nombre = [
    "RENDICION",
    cabecera.memo || "sin-memo",
    [cabecera.nombres, cabecera.apellidos].filter(Boolean).join(" ").trim() || "sin-nombre",
  ].join(" · ");

  const hoja = await crearHoja(nombre, idCarpeta);

  // El idioma se acomoda ANTES de escribir, y no es cosmético: decide si las
  // fórmulas se separan con coma o con punto y coma. Escribirlas primero y
  // cambiar el idioma después las dejaría rotas, porque se interpretan al
  // escribirse. Por eso las de abajo usan el separador del idioma que quedó,
  // en vez de dar por hecho el que se pidió.
  // Devuelve el idioma que realmente quedó, que puede no ser el pedido.
  const idioma = await acomodarIdioma(hoja.id);
  const s = separadorDe(idioma);

  // Se calculan antes las filas donde caerá la tabla, porque las fórmulas del
  // total necesitan saber su rango y la cabecera va escrita más arriba.
  const ALTO_CABECERA = 14;
  const filaEncabezado = ALTO_CABECERA + 1;         // 1-indexada, como en la hoja
  const primera = filaEncabezado + 1;
  const ultima = primera + filas.length - 1;

  const rangos = filas.length
    ? {
        total: `=SUM(${MONTO}${primera}:${MONTO}${ultima})`,
        // La columna SUSTENTA guarda si esa línea cuenta. Sumar con SUMIF en
        // vez de fijar el número deja que el criterio siga vivo: cambiar una
        // celda de «no» a «sí» recalcula el monto rendido y el porcentaje al
        // instante.
        sustentado: `=SUMIF(${SUSTENTA}${primera}:${SUSTENTA}${ultima}${s}"sí"${s}${MONTO}${primera}:${MONTO}${ultima})`,
        sinSustentar: `=SUMIF(${SUSTENTA}${primera}:${SUSTENTA}${ultima}${s}"no"${s}${MONTO}${primera}:${MONTO}${ultima})`,
      }
    : { total: 0, sustentado: 0, sinSustentar: 0 };

  const filasTabla = filas.map((f) => {
    const enlace = enlaces[f.clave];
    return [
      aPapel(f.fecha),
      etiquetaTipo(f.tipo),
      // El número enlaza a la imagen en Drive: quien revise la rendición llega
      // al papel con un clic, en vez de buscarlo en una carpeta.
      enlace ? `=HYPERLINK("${enlace}"${s}"${f.numero}")` : f.numero,
      f.proveedor,
      f.descripcion,
      f.categoria,
      "S/",
      num(f.importe),
      excluidos.has(f.tipo) ? "no" : "sí",
    ];
  });

  // La fila del total queda justo debajo de la última: es a la que apuntan el
  // saldo y el reembolso.
  const filaTotal = ultima + 1;
  const hueco = (rotulo, valor) => [rotulo, "", "", "", "", "", "S/", valor, ""];

  const cierre = [
    hueco("", rangos.total),
    ["", "", "", "", "", "", "", "", ""],
    hueco("No sustenta", rangos.sinSustentar),
    // El saldo también es fórmula, y su signo decide el rótulo en la hoja.
    hueco(
      filas.length
        ? `=IF(C4-${MONTO}${filaTotal}>0${s}"Saldo por devolver"${s}IF(C4-${MONTO}${filaTotal}<0${s}"Reembolso a favor"${s}"Saldo"))`
        : "Saldo",
      filas.length ? `=ABS(C4-${MONTO}${filaTotal})` : 0),
  ];

  const valores = [
    ...bloqueCabecera(cabecera, cuentas, rangos, s),
    ["FECHA", "TIPO DE DOCUMENTO", "N° DOCUMENTO", "PROVEEDOR", "CONCEPTO",
     "CATEGORÍA", "", "MONTO", "SUSTENTA"],
    ...filasTabla,
    ...cierre,
    ["", "", "", "", "", ""],
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

  await darFormato(hoja.id, ALTO_CABECERA, filasTabla.length);
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
  const colMonto = MONTO.charCodeAt(0) - 65;      // «H» → 7

  const peticiones = [
    // Rótulos de la cabecera en negrita.
    { repeatCell: {
      range: { sheetId: 0, startRowIndex: 0, endRowIndex: filasCabecera, startColumnIndex: 0, endColumnIndex: 1 },
      cell: { userEnteredFormat: { textFormat: { bold: true } } },
      fields: "userEnteredFormat.textFormat.bold" } },
    // Cabecera de la tabla: negrita sobre fondo suave.
    { repeatCell: {
      range: { sheetId: 0, startRowIndex: encabezadoTabla, endRowIndex: primeraFila, startColumnIndex: 0, endColumnIndex: ANCHO },
      cell: { userEnteredFormat: {
        textFormat: { bold: true },
        backgroundColor: { red: 0.965, green: 0.973, blue: 0.980 },
      } },
      fields: "userEnteredFormat(textFormat,backgroundColor)" } },
    // Los montos con dos decimales y a la derecha: una columna de cifras solo
    // se compara de un vistazo si la coma decimal cae siempre en el mismo sitio.
    { repeatCell: {
      range: { sheetId: 0, startRowIndex: 0, endRowIndex: ultimaFila, startColumnIndex: colMonto, endColumnIndex: colMonto + 1 },
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
    // El concepto es texto libre y puede ser largo: se ajusta en la celda en
    // vez de desbordar sobre la categoría o quedar cortado.
    { repeatCell: {
      range: { sheetId: 0, startRowIndex: primeraFila, endRowIndex: ultimaFila, startColumnIndex: 4, endColumnIndex: 5 },
      cell: { userEnteredFormat: { wrapStrategy: "WRAP", verticalAlignment: "TOP" } },
      fields: "userEnteredFormat(wrapStrategy,verticalAlignment)" } },
    // La categoría es deducida, no leída: va en versalita gris para que no se
    // lea con el mismo peso que lo que sí está impreso en el papel.
    { repeatCell: {
      range: { sheetId: 0, startRowIndex: primeraFila, endRowIndex: ultimaFila, startColumnIndex: 5, endColumnIndex: 6 },
      cell: { userEnteredFormat: {
        textFormat: { fontSize: 9, foregroundColor: { red: 0.32, green: 0.38, blue: 0.48 } },
      } },
      fields: "userEnteredFormat.textFormat" } },
    ...[[0, 1, 95], [1, 2, 150], [2, 3, 130], [3, 4, 190], [4, 5, 240], [5, 6, 165],
        [6, 7, 36], [7, 8, 105], [8, 9, 85]].map(([desde, hasta, ancho]) => ({
      updateDimensionProperties: {
        range: { sheetId: 0, dimension: "COLUMNS", startIndex: desde, endIndex: hasta },
        properties: { pixelSize: ancho }, fields: "pixelSize",
      } })),
  ];

  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${idHoja}:batchUpdate`, {
    method: "POST",
    headers: await cabeceras({ "Content-Type": "application/json" }),
    body: JSON.stringify({ requests: peticiones }),
  });
  // El formato es cosmético: si falla, la rendición ya está escrita y vale.
  if (!r.ok) console.warn("No se pudo dar formato a la rendición:", await motivo(r));
}
