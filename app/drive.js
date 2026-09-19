// Escritura en Drive desde el navegador.
//
// Todo cuelga de una carpeta en unidad compartida, así que los archivos
// pertenecen a la organización y no a quien los subió.

import { CARPETA_RAIZ, PESTANA_CARPETAS } from "./config.js";
import { cabeceras, motivo, sesion } from "./auth.js";
import { agregar, leer } from "./sheets.js";

// Sin supportsAllDrives Drive responde «File not found» en una unidad
// compartida aunque la carpeta exista y haya permiso de sobra. Va en CADA
// llamada, no solo en la primera.
const UNIDADES = "supportsAllDrives=true&includeItemsFromAllDrives=true";

/** Carpetas del día ya creadas, en memoria, para no releer la hoja por archivo. */
const cacheCarpetas = new Map();

export const fechaCarpeta = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function crearCarpeta(nombre, padre) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?${UNIDADES}&fields=id`, {
    method: "POST",
    headers: await cabeceras({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      name: nombre,
      mimeType: "application/vnd.google-apps.folder",
      parents: [padre],
    }),
  });
  if (!r.ok) throw new Error(`Drive [${r.status}]: ${await motivo(r)}`);
  return (await r.json()).id;
}

/**
 * La carpeta del día, creándola si es la primera vez.
 *
 * No se busca con files.list a propósito: con drive.file ese listado solo
 * devuelve lo que creó la sesión de esta misma persona, así que quien no la
 * creó no la encontraría y haría una carpeta duplicada con el mismo nombre.
 * El ID se anota en la hoja, que sí ven todos, y crear dentro de una carpeta
 * ajena funciona sin problema.
 */
export async function carpetaDelDia(fecha = fechaCarpeta()) {
  if (cacheCarpetas.has(fecha)) return cacheCarpetas.get(fecha);

  const filas = await leer(`${PESTANA_CARPETAS}!A2:B`);
  const anotada = filas.find((f) => f[0] === fecha)?.[1];
  if (anotada) {
    cacheCarpetas.set(fecha, anotada);
    return anotada;
  }

  const id = await crearCarpeta(fecha, CARPETA_RAIZ);
  await agregar(PESTANA_CARPETAS, [[fecha, id, sesion()?.correo ?? "", new Date().toISOString()]]);
  cacheCarpetas.set(fecha, id);
  return id;
}

/** Sube un blob y devuelve su id y enlace. */
export async function subir(blob, nombre, idCarpeta) {
  const lim = "-----inroscan" + Math.random().toString(36).slice(2);
  const meta = { name: nombre, parents: [idCarpeta] };

  // El cuerpo multipart se arma a mano porque el archivo va en binario: con
  // FormData el navegador impone su propio boundary y Drive rechaza el
  // formato que espera para uploadType=multipart.
  const cuerpo = new Blob([
    `--${lim}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(meta),
    `\r\n--${lim}\r\nContent-Type: ${blob.type || "application/octet-stream"}\r\n\r\n`,
    blob,
    `\r\n--${lim}--`,
  ]);

  const url = `https://www.googleapis.com/upload/drive/v3/files` +
              `?uploadType=multipart&${UNIDADES}&fields=id,name,webViewLink`;

  const r = await fetch(url, {
    method: "POST",
    headers: await cabeceras({ "Content-Type": `multipart/related; boundary=${lim}` }),
    body: cuerpo,
  });
  if (!r.ok) throw new Error(`Drive [${r.status}]: ${await motivo(r)}`);
  return r.json();
}
