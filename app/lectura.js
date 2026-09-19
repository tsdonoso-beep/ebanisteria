// Las dos lecturas: OCR primero, IA solo si hace falta.
//
// Ese orden es el criterio de eficiencia de la herramienta. Tesseract corre
// entero en el navegador: no cuesta, no consume cuota y funciona aunque la
// clave de IA se haya agotado. La IA entra únicamente cuando el OCR no logró
// los campos imprescindibles, que es donde de verdad aporta.

import { GEMINI_MODELO, getClaveGemini } from "./config.js";
import { leerTexto, fundir, estaCompleto, VACIO } from "./campos.js";
import { PROMPT } from "./prompt.js";

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

// --- respaldo con IA -----------------------------------------------------

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
    // Último intento: quedarse con el primer objeto que aparezca.
    const llaves = crudo.match(/\{[\s\S]*\}/);
    if (!llaves) return null;
    try { return JSON.parse(llaves[0]); } catch { return null; }
  }
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function leerConIA(blob, clave) {
  const cuerpo = {
    contents: [{
      parts: [
        { text: PROMPT },
        { inlineData: { mimeType: blob.type || "image/jpeg", data: await enBase64(blob) } },
      ],
    }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
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
    const texto = j?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    return extraerJSON(texto);
  }
  return null;
}

// --- orquestación --------------------------------------------------------

/**
 * Lee una página y devuelve los campos, diciendo con qué se logró.
 *
 * `via` vale «ocr» cuando bastó la primera lectura, «ia» cuando hizo falta el
 * respaldo, y «parcial» cuando ni con IA se completó: esa fila queda para que
 * la persona la termine a mano, no se descarta.
 */
export async function leer(pagina, avisar) {
  let campos = VACIO();
  let via = "ocr";

  try {
    campos = leerTexto(await leerConOcr(pagina.blob, avisar));
  } catch (e) {
    // Que el OCR falle no es el final: la IA puede leer la imagen igual.
    console.warn("OCR falló:", e);
  }

  if (estaCompleto(campos)) return { campos, via };

  const clave = getClaveGemini();
  if (!clave) return { campos, via: "parcial" };

  avisar?.("El OCR no resolvió; consultando a la IA…");
  const deIA = await leerConIA(pagina.blob, clave);
  campos = fundir(campos, deIA);
  via = estaCompleto(campos) ? "ia" : "parcial";

  return { campos, via };
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
