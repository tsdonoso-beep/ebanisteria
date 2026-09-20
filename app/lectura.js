// Las dos lecturas: OCR primero, IA solo si hace falta.
//
// Ese orden es el criterio de eficiencia de la herramienta. Tesseract corre
// entero en el navegador: no cuesta, no consume cuota y funciona aunque la
// clave de IA se haya agotado. La IA entra únicamente cuando el OCR no logró
// los campos imprescindibles o cuando la imagen trae más de un comprobante,
// que es donde de verdad aporta.

import { GEMINI_MODELO, getClaveGemini } from "./config.js";
import {
  leerTexto, desdeIA, fundir, estaCompleto, pareceVarios, VACIO,
  fechaISO, numero, partirNumero, claveDe,
} from "./campos.js";
import { PROMPT_COMPROBANTE, PROMPT_CONSOLIDADO } from "./prompt.js";
import { conPlazo, esperar, Ritmo, Cancelado } from "./cola.js";

/** Plazo del OCR de una página. Pasado eso se da por muerto el trabajador. */
const PLAZO_OCR = 45_000;
/** Plazo de una llamada a la IA, ya descontadas sus propias esperas. */
const PLAZO_IA = 90_000;

/** Un solo ritmo para toda la aplicación: la cuota es de la clave, no de la página. */
const ritmo = new Ritmo();
export const ritmoActual = () => ritmo.segundos;

// --- OCR en el navegador -------------------------------------------------

let trabajador = null;

/**
 * El trabajador de Tesseract se crea una sola vez y se reutiliza.
 *
 * Crearlo es caro: baja unos megas de modelo la primera vez y los deja en
 * caché del navegador. Se levanta al primer uso y no antes, para que abrir la
 * herramienta y no subir nada no cueste esa descarga.
 */
async function obtenerTrabajador(avisar) {
  if (trabajador) return trabajador;

  avisar?.("Preparando el lector (solo la primera vez)…");
  if (!window.Tesseract) throw new Error("El lector OCR no cargó.");
  trabajador = await Tesseract.createWorker("spa");
  return trabajador;
}

/**
 * OCR de una página, con plazo.
 *
 * Tras varias páginas grandes el trabajador puede quedarse sin memoria y morir
 * en silencio: la promesa no se resuelve nunca y el lote se congela sin error.
 * El plazo lo convierte en un fallo normal, y el trabajador se tira para que
 * la siguiente página empiece con uno sano.
 */
async function leerConOcr(blob, avisar) {
  const t = await obtenerTrabajador(avisar);
  try {
    const { data } = await conPlazo(t.recognize(blob), PLAZO_OCR, "El OCR");
    return data.text ?? "";
  } catch (e) {
    await tirarTrabajador();
    throw e;
  }
}

async function tirarTrabajador() {
  const viejo = trabajador;
  trabajador = null;
  try { await viejo?.terminate(); } catch { /* ya estaba muerto */ }
}

// --- llamada a la IA -----------------------------------------------------

const enBase64 = (blob) => new Promise((resolve, reject) => {
  const lector = new FileReader();
  lector.onload = () => resolve(String(lector.result).split(",")[1]);
  lector.onerror = () => reject(new Error("No se pudo leer el archivo."));
  lector.readAsDataURL(blob);
});

/** Gemini devuelve el JSON dentro de un bloque de código más veces que sin él. */
function extraerJSON(texto) {
  const bloque = texto.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const crudo = (bloque ? bloque[1] : texto).trim();
  try {
    return JSON.parse(crudo);
  } catch {
    // Último intento: quedarse con el primer array u objeto que aparezca.
    const trozo = crudo.match(/[[{][\s\S]*[\]}]/);
    if (!trozo) return null;
    try { return JSON.parse(trozo[0]); } catch { return null; }
  }
}

async function preguntar(blob, prompt, clave, maxTokens = 4096, señal) {
  const cuerpo = {
    contents: [{
      parts: [
        { text: prompt },
        { inlineData: { mimeType: blob.type || "image/jpeg", data: await enBase64(blob) } },
      ],
    }],
    generationConfig: { temperature: 0.1, maxOutputTokens: maxTokens },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/` +
              `${GEMINI_MODELO}:generateContent?key=${encodeURIComponent(clave)}`;

  // 429 y 503 son cuota agotada o servicio saturado: se reintenta espaciado y
  // se ensancha el ritmo, para que lo que venga detrás no repita el choque.
  // Cualquier otro error es definitivo y se informa de una vez.
  for (let intento = 1; intento <= 3; intento++) {
    if (señal?.aborted) throw new Cancelado();

    const r = await ritmo.turno(() => conPlazo(
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
        signal: señal,
      }), PLAZO_IA, "La IA"));

    if (r.status === 429 || r.status === 503) {
      ritmo.frenar();
      if (intento === 3) {
        throw new Error(
          "La cuota de tu clave de IA se agotó. Espera unos minutos, o reparte " +
          "el lote entre varias personas: cada clave tiene su propio límite."
        );
      }
      await esperar(intento * 8000);
      continue;
    }
    ritmo.aflojar();
    if (!r.ok) {
      const detalle = (await r.text()).slice(0, 200);
      if (r.status === 400 && /API_KEY/i.test(detalle)) {
        throw new Error("La clave de IA no es válida para Gemini. Debe empezar con «AIza».");
      }
      throw new Error(`IA [${r.status}]: ${detalle}`);
    }

    const j = await r.json();
    return extraerJSON(j?.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
  }
  return null;
}

// --- cuándo vale la pena el OCR -----------------------------------------

/**
 * Historial reciente de si el OCR bastó.
 *
 * En un lote de planillas escaneadas el OCR no resuelve casi ninguna, pero se
 * le pagan igual sus diez o veinte segundos por página antes de llamar a la
 * IA, que es quien acaba leyéndola. En un PDF de doce páginas eso son varios
 * minutos tirados, y desde fuera parece que la herramienta se colgó.
 *
 * Tras unos cuantos fracasos seguidos se deja de intentar y se va directo a la
 * IA. Cada lote nuevo vuelve a probar: el siguiente puede ser de boletas
 * limpias donde el OCR sí alcanza y no cuesta cuota.
 */
let ocrReciente = [];

function anotarOcr(sirvio) {
  ocrReciente.push(sirvio);
  if (ocrReciente.length > 5) ocrReciente.shift();
}

function valeLaPenaElOcr() {
  if (!getClaveGemini()) return true;  // sin IA, el OCR es lo único que hay
  return !(ocrReciente.length >= 4 && ocrReciente.every((x) => !x));
}

/** Al empezar un lote se olvida lo aprendido: puede ser material distinto. */
export function reiniciarAprendizaje() { ocrReciente = []; }

export const ocrDesactivado = () => !valeLaPenaElOcr();

// --- comprobantes --------------------------------------------------------

/**
 * Lee una imagen y devuelve UNO O VARIOS comprobantes.
 *
 * Devuelve lista siempre, porque escanear dos o tres boletas juntas es
 * habitual y tratarlas como una sola perdía todas menos una sin aviso.
 *
 * `via` dice con qué se logró: «ocr» cuando bastó la primera lectura, «ia»
 * cuando hizo falta el respaldo, y «parcial» cuando ni así se completó — esa
 * fila queda para terminarla a mano, no se descarta.
 */
export async function leer(pagina, avisar, señal) {
  if (señal?.aborted) throw new Cancelado();

  let texto = "";
  if (valeLaPenaElOcr()) {
    try {
      texto = await leerConOcr(pagina.blob, avisar);
    } catch (e) {
      // Que el OCR falle no es el final: la IA puede leer la imagen igual.
      console.warn("OCR falló:", e);
    }
  }

  const porOcr = leerTexto(texto);
  const varios = pareceVarios(texto);

  if (!varios && estaCompleto(porOcr)) {
    anotarOcr(true);
    return [{ campos: porOcr, via: "ocr" }];
  }
  anotarOcr(false);

  const claveIA = getClaveGemini();
  if (!claveIA) {
    // Sin clave se entrega lo que haya. Si se sospechan varios, se avisa en la
    // fila: es preferible que la persona lo sepa y lo separe a mano antes que
    // registrar uno y perder el resto en silencio.
    return [{ campos: porOcr, via: "parcial", sospechaVarios: varios }];
  }

  avisar?.(varios ? "Parece haber más de un comprobante; consultando a la IA…"
                  : "El OCR no resolvió; consultando a la IA…");

  const respuesta = await preguntar(pagina.blob, PROMPT_COMPROBANTE, claveIA, 4096, señal);
  const lista = Array.isArray(respuesta) ? respuesta : respuesta ? [respuesta] : [];

  if (!lista.length) return [{ campos: porOcr, via: "parcial", sospechaVarios: varios }];

  const leidos = unificarRepetidos(lista.map(desdeIA));

  return leidos.map((deIA, i) => {
    // Lo del OCR solo se funde cuando hay un único comprobante: si la imagen
    // trae dos, el RUC o el total que sacó el OCR pertenecen a uno de los dos,
    // y repartirlos a todos inventaría datos.
    const campos = leidos.length === 1 ? fundir(deIA, porOcr) : deIA;
    return { campos, via: estaCompleto(campos) ? "ia" : "parcial" };
  });
}

/**
 * Funde los que comparten número de comprobante.
 *
 * Red de seguridad contra el error más caro de la extracción: ante una boleta
 * de restaurante con cuatro platos, la IA tiende a devolver cuatro objetos
 * —uno por línea— con el mismo número y el precio de cada plato. Registrarlos
 * inventa gastos que no existen y descuadra la rendición contra la caja.
 *
 * Dos documentos distintos no pueden compartir número, así que cuando se
 * repite se conserva uno solo, con el importe MAYOR: en ese reparto el total
 * de la boleta es siempre el más grande de los trozos.
 *
 * No depende de que el prompt se obedezca, que es justo lo que no se puede dar
 * por sentado.
 */
function unificarRepetidos(lista) {
  const porClave = new Map();
  const sueltos = [];

  for (const c of lista) {
    const k = claveDe(c);
    if (!k) { sueltos.push(c); continue; }  // sin número no hay con qué comparar

    const previo = porClave.get(k);
    if (!previo) { porClave.set(k, c); continue; }

    const mayor = (Number(c.importe) || 0) > (Number(previo.importe) || 0) ? c : previo;
    const otro = mayor === c ? previo : c;
    // Se queda el del importe mayor, completado con lo que el otro sí traía.
    porClave.set(k, fundir(mayor, otro));
  }

  return [...porClave.values(), ...sueltos];
}

// --- consolidado ---------------------------------------------------------

/**
 * Lee una página de un consolidado de caja chica.
 *
 * Siempre por IA: es una tabla de decenas de filas, y reconstruirla con
 * expresiones regulares sobre el texto del OCR —que llega con las columnas
 * desordenadas— sería frágil justo donde la exactitud importa más, porque de
 * esto sale el cuadre.
 */
export async function leerConsolidado(pagina, avisar) {
  const claveIA = getClaveGemini();
  if (!claveIA) {
    throw new Error("Leer un consolidado necesita clave de IA: es una tabla, no un comprobante.");
  }

  avisar?.("Leyendo la tabla del consolidado…");
  const j = await preguntar(pagina.blob, PROMPT_CONSOLIDADO, claveIA, 8192);
  if (!j) throw new Error("No se pudo leer la tabla de esta página.");

  const lineas = (Array.isArray(j.lineas) ? j.lineas : []).map((l) => {
    const { serie, numero: num } = partirNumero(l.numero);
    return {
      ...VACIO(),
      fecha: fechaISO(l.fecha),
      tipo: String(l.tipo ?? "").trim(),
      serie, numero: num,
      numeroCrudo: String(l.numero ?? "").trim(),
      proveedor: String(l.proveedor ?? "").trim(),
      proyecto: String(l.proyecto ?? "").trim(),
      area: String(l.area ?? "").trim(),
      responsable: String(l.responsable ?? "").trim(),
      categoria: String(l.categoria ?? "").trim(),
      subcategoria: String(l.subcategoria ?? "").trim(),
      clasificacion: String(l.clasificacion ?? "").trim(),
      descripcion: String(l.descripcion ?? "").trim(),
      importe: numero(l.importe),
    };
  });

  return {
    caja: String(j.caja ?? "").trim(),
    administrador: String(j.administrador ?? "").trim(),
    montoAsignado: numero(j.montoAsignado),
    gastosRealizados: numero(j.gastosRealizados),
    lineas,
  };
}

/** Comprueba que la clave sirva, sin gastar una lectura real. */
export async function probarClave(clave) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/` +
              `${GEMINI_MODELO}:generateContent?key=${encodeURIComponent(clave)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: "responde: ok" }] }] }),
  });
  if (r.ok) return true;
  throw new Error(`La clave no funcionó [${r.status}]: ${(await r.text()).slice(0, 160)}`);
}
