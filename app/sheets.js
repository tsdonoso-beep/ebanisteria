// La hoja de cálculo como registro.
//
// No hay base de datos: la hoja es el registro y contabilidad la lee y filtra
// como cualquier otra. Eso impone dos cuidados —crear las pestañas si faltan y
// no pisar filas ajenas al escribir— que es lo que resuelve este módulo.

import { HOJA, PESTANA_REGISTRO, PESTANA_CARPETAS, COLUMNAS } from "./config.js";
import { cabeceras, motivo } from "./auth.js";

const API = `https://sheets.googleapis.com/v4/spreadsheets/${HOJA}`;

async function pedir(url, opciones = {}) {
  const r = await fetch(url, {
    ...opciones,
    headers: await cabeceras(opciones.body ? { "Content-Type": "application/json" } : {}),
  });
  if (!r.ok) throw new Error(`Sheets [${r.status}]: ${await motivo(r)}`);
  return r.json();
}

/** Nombres de las pestañas que ya existen. */
async function pestanas() {
  const j = await pedir(`${API}?fields=sheets.properties.title`);
  return j.sheets.map((s) => s.properties.title);
}

async function crearPestana(titulo) {
  await pedir(`${API}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: titulo } } }] }),
  });
}

/**
 * Deja la hoja lista: las dos pestañas creadas y con encabezado.
 *
 * Se llama una vez por sesión. Es barato y evita el caso incómodo de estrenar
 * la herramienta contra una hoja vacía y que las filas salgan sin títulos.
 */
export async function preparar() {
  const existentes = await pestanas();

  if (!existentes.includes(PESTANA_REGISTRO)) {
    await crearPestana(PESTANA_REGISTRO);
    await escribir(`${PESTANA_REGISTRO}!A1`, [COLUMNAS]);
  }
  if (!existentes.includes(PESTANA_CARPETAS)) {
    await crearPestana(PESTANA_CARPETAS);
    await escribir(`${PESTANA_CARPETAS}!A1`, [["Fecha", "ID de carpeta", "Creada por", "Creada el"]]);
  }
}

function escribir(rango, filas) {
  const url = `${API}/values/${encodeURIComponent(rango)}?valueInputOption=USER_ENTERED`;
  return pedir(url, { method: "PUT", body: JSON.stringify({ values: filas }) });
}

/**
 * Agrega filas al final.
 *
 * insertDataOption=INSERT_ROWS es lo que hace que dos personas registrando a
 * la vez no se pisen: cada llamada inserta filas nuevas en lugar de escribir
 * sobre un rango calculado de antemano.
 */
export async function agregar(pestana, filas) {
  if (!filas.length) return;
  const url = `${API}/values/${encodeURIComponent(pestana + "!A1")}:append` +
              "?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS";
  return pedir(url, { method: "POST", body: JSON.stringify({ values: filas }) });
}

export async function leer(rango) {
  const j = await pedir(`${API}/values/${encodeURIComponent(rango)}`);
  return j.values ?? [];
}

/** Índice de columna a letra de Sheets: 0 → A, 25 → Z, 26 → AA. */
function letraColumna(i) {
  let s = "";
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) {
    s = String.fromCharCode(65 + (n % 26)) + s;
  }
  return s;
}

/** Las huellas ya registradas, para avisar de un comprobante repetido. */
export async function huellasRegistradas() {
  const letra = letraColumna(COLUMNAS.indexOf("Huella"));
  const filas = await leer(`${PESTANA_REGISTRO}!${letra}2:${letra}`);
  return new Set(filas.flat().filter(Boolean));
}
