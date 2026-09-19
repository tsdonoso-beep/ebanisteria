// La hoja de cálculo como registro.
//
// No hay base de datos: la hoja es el registro y contabilidad la lee y filtra
// como cualquier otra. Eso impone dos cuidados —crear las pestañas si faltan y
// no pisar filas ajenas al escribir— que es lo que resuelve este módulo.

import {
  HOJA, PESTANA_REGISTRO, PESTANA_CARPETAS, PESTANA_CONSOLIDADO,
  COLUMNAS, COLUMNAS_CONSOLIDADO,
} from "./config.js";
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

  const sembrar = async (titulo, encabezado) => {
    if (existentes.includes(titulo)) return;
    await crearPestana(titulo);
    await escribir(`${titulo}!A1`, [encabezado]);
  };

  await sembrar(PESTANA_REGISTRO, COLUMNAS);
  await sembrar(PESTANA_CONSOLIDADO, COLUMNAS_CONSOLIDADO);
  await sembrar(PESTANA_CARPETAS, ["Fecha", "ID de carpeta", "Creada por", "Creada el"]);
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

/**
 * Lo ya registrado, para avisar antes de duplicar.
 *
 * Se guardan dos identidades porque cazan casos distintos: la huella es del
 * archivo y detecta la misma imagen subida dos veces; la clave es del
 * comprobante y detecta la misma boleta escaneada de nuevo, torcida o desde
 * otro ángulo, que es el caso que de verdad pasa.
 */
export async function yaRegistrado() {
  const col = (nombre) => letraColumna(COLUMNAS.indexOf(nombre));
  const [huellas, claves] = await Promise.all([
    leer(`${PESTANA_REGISTRO}!${col("Huella")}2:${col("Huella")}`),
    leer(`${PESTANA_REGISTRO}!${col("Clave")}2:${col("Clave")}`),
  ]);
  return {
    huellas: new Set(huellas.flat().filter(Boolean)),
    claves: new Set(claves.flat().filter(Boolean)),
  };
}
