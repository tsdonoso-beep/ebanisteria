// El Drive de la propia persona.
//
// Lo que hace el rendidor no es del área: son sus gastos, su memo y su
// rendición. Por eso no toca la unidad compartida ni la hoja de contabilidad
// —a la que además puede no tener acceso— sino que todo nace en su «Mi
// unidad», con él como dueño. Lo comparte cuando quiere y con quien quiere.
//
// Esto funciona con drive.file por una propiedad cómoda del alcance: los
// archivos que esta aplicación crea para esta persona sí los vuelve a ver al
// listar. La carpeta de la primera vez se encuentra la segunda, y no se
// duplica. Es lo contrario de lo que pasa en la unidad compartida, donde la
// carpeta la crea otro y hay que anotar el ID en la hoja.

import { cabeceras, motivo } from "./auth.js";

const CARPETA = "application/vnd.google-apps.folder";
const RAIZ = "InroScan · Mis rendiciones";

/** Para no repetir la búsqueda por cada archivo del mismo envío. */
const cache = new Map();

const entrecomillar = (s) => String(s).replace(/['\\]/g, "\\$&");

async function pedir(url, opciones = {}) {
  const r = await fetch(url, {
    ...opciones,
    headers: await cabeceras(opciones.body ? { "Content-Type": "application/json" } : {}),
  });
  if (!r.ok) throw new Error(`Drive [${r.status}]: ${await motivo(r)}`);
  return r.json();
}

/**
 * Busca la carpeta por nombre, o la crea.
 *
 * Sin `padre` nace en la raíz de «Mi unidad», que es donde la persona la va a
 * buscar sin que nadie le explique dónde está.
 */
async function carpeta(nombre, padre) {
  const clave = `${padre ?? "raiz"}/${nombre}`;
  if (cache.has(clave)) return cache.get(clave);

  const filtros = [
    `name='${entrecomillar(nombre)}'`,
    `mimeType='${CARPETA}'`,
    "trashed=false",
    padre ? `'${entrecomillar(padre)}' in parents` : "'root' in parents",
  ].join(" and ");

  const hallado = await pedir(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(filtros)}` +
    "&fields=files(id)&pageSize=1");

  const id = hallado.files?.[0]?.id ?? (await pedir(
    "https://www.googleapis.com/drive/v3/files?fields=id",
    { method: "POST", body: JSON.stringify({
      name: nombre, mimeType: CARPETA, ...(padre ? { parents: [padre] } : {}),
    }) })).id;

  cache.set(clave, id);
  return id;
}

/**
 * La carpeta donde va una rendición: una por memo, dentro de la general.
 *
 * Separar por memo no es orden por el orden: cuando contabilidad pregunte por
 * el memo 675, la persona comparte una carpeta y adentro están la hoja y las
 * doce fotos, en vez de rebuscar entre los gastos de todo el año.
 */
export async function carpetaDeMemo(memo) {
  const raiz = await carpeta(RAIZ);
  const nombre = String(memo ?? "").trim();
  return nombre ? carpeta(nombre.toUpperCase(), raiz) : raiz;
}

/** Para enlazar a «dónde quedó» sin hacer buscar por el Drive. */
export const enlaceCarpeta = (id) => `https://drive.google.com/drive/folders/${id}`;
