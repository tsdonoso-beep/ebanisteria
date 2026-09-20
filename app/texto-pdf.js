// La capa de texto de un PDF, reconstruida en filas.
//
// Un consolidado de caja chica no es un escaneo: sale de una hoja de cálculo y
// lleva su texto dentro, exacto y sin errores de lectura. Rasterizarlo para
// pasarle OCR o una imagen a la IA era tirar ese texto y volver a adivinarlo.
//
// Lo que no resuelve esto es el reparto en columnas. Las celdas van centradas
// en su columna, no alineadas, así que la coordenada x de un fragmento no
// dice a qué campo pertenece sin conocer de antemano el ancho de cada columna
// —y eso cambia entre formatos de consolidado—. Por eso el reparto se sigue
// delegando, pero sobre el texto real en vez de sobre una imagen.

import * as pdfjs from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";

pdfjs.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

/** Cuánto pueden separarse dos fragmentos en vertical y seguir en la misma fila. */
const TOLERANCIA_Y = 4;

/**
 * Agrupa los fragmentos de una página en filas por su coordenada vertical.
 *
 * Sin esto el texto sale en el orden en que el PDF lo dibujó, que para una
 * tabla es un revoltijo: todas las fechas juntas, luego todos los proveedores.
 * Agrupando por «y» vuelve a leerse fila por fila, como en el papel.
 */
function enFilas(items) {
  const filas = [];

  for (const it of items) {
    const texto = it.str.trim();
    if (!texto) continue;

    // transform[4] y [5] son la x y la y donde se dibujó el fragmento.
    const x = it.transform[4];
    const y = it.transform[5];

    const fila = filas.find((f) => Math.abs(f.y - y) < TOLERANCIA_Y);
    if (fila) fila.trozos.push({ x, texto });
    else filas.push({ y, trozos: [{ x, texto }] });
  }

  return filas
    .sort((a, b) => b.y - a.y)                       // de arriba abajo
    .map((f) => f.trozos.sort((a, b) => a.x - b.x)   // de izquierda a derecha
      .map((t) => t.texto).join("  ").trim())
    .filter(Boolean);
}

/**
 * El texto de un PDF, fila por fila. Devuelve null si no hay capa de texto,
 * que es lo que pasa con un consolidado escaneado en papel.
 */
export async function textoDePdf(archivo, avisar) {
  if (archivo.type !== "application/pdf") return null;

  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await archivo.arrayBuffer()) }).promise;
  const paginas = [];

  for (let n = 1; n <= pdf.numPages; n++) {
    avisar?.(`Leyendo el texto — página ${n} de ${pdf.numPages}`);
    const { items } = await (await pdf.getPage(n)).getTextContent();
    paginas.push(enFilas(items));
  }

  // Un PDF escaneado trae página pero no texto. Unas pocas palabras sueltas
  // tampoco sirven: suele ser el pie o un sello sobre la imagen.
  const total = paginas.reduce((t, p) => t + p.length, 0);
  return total < 5 ? null : paginas;
}
