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
  fechaISO, numero, partirNumero,
} from "./campos.js";
import { PROMPT_COMPROBANTE, PROMPT_CONSOLIDADO } from "./prompt.js";

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

async function leerConOcr(blob, avisar) {
  const t = await obtenerTrabajador(avisar);
  const { data } = await t.recognize(blob);
  return data.text ?? "";
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

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function preguntar(blob, prompt, clave, maxTokens = 4096) {
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

  // 429 y 503 son cuota agotada o servicio saturado: se reintenta espaciado.
  // Cualquier otro error es definitivo y se informa de una vez.
  for (let intento = 1; intento <= 3; intento++) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });

    if (r.status === 429 || r.status === 503) {
      if (intento === 3) throw new Error("La cuota de tu clave de IA se agotó o el servicio está saturado.");
      await esperar(intento * 4000);
      continue;
    }
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
export async function leer(pagina, avisar) {
  let texto = "";
  try {
    texto = await leerConOcr(pagina.blob, avisar);
  } catch (e) {
    // Que el OCR falle no es el final: la IA puede leer la imagen igual.
    console.warn("OCR falló:", e);
  }

  const porOcr = leerTexto(texto);
  const varios = pareceVarios(texto);

  if (!varios && estaCompleto(porOcr)) return [{ campos: porOcr, via: "ocr" }];

  const claveIA = getClaveGemini();
  if (!claveIA) {
    // Sin clave se entrega lo que haya. Si se sospechan varios, se avisa en la
    // fila: es preferible que la persona lo sepa y lo separe a mano antes que
    // registrar uno y perder el resto en silencio.
    return [{ campos: porOcr, via: "parcial", sospechaVarios: varios }];
  }

  avisar?.(varios ? "Parece haber más de un comprobante; consultando a la IA…"
                  : "El OCR no resolvió; consultando a la IA…");

  const respuesta = await preguntar(pagina.blob, PROMPT_COMPROBANTE, claveIA);
  const lista = Array.isArray(respuesta) ? respuesta : respuesta ? [respuesta] : [];

  if (!lista.length) return [{ campos: porOcr, via: "parcial", sospechaVarios: varios }];

  return lista.map((crudo, i) => {
    const deIA = desdeIA(crudo);
    // Lo del OCR solo se funde sobre el primero: si hay dos comprobantes en la
    // imagen, el RUC o el total que sacó el OCR pertenecen a uno de los dos, y
    // repartirlos a todos inventaría datos.
    const campos = i === 0 && lista.length === 1 ? fundir(deIA, porOcr) : deIA;
    return { campos, via: estaCompleto(campos) ? "ia" : "parcial" };
  });
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
