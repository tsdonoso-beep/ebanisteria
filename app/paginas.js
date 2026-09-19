// De archivos sueltos a páginas.
//
// La unidad de registro es el comprobante, y un comprobante es una imagen o
// una página de PDF. Un PDF de doce páginas son doce filas, no una.

import * as pdfjs from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";

pdfjs.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

/**
 * A qué resolución se rasteriza cada página.
 *
 * Con menos, el OCR empieza a perder los números pequeños de las boletas
 * térmicas, que es justo lo que hay que leer bien. Con mucho más, el archivo
 * pesa de más y la lectura se vuelve lenta sin leer mejor.
 */
const ESCALA = 2;

/** Calidad del JPEG. El texto impreso aguanta bien esta compresión. */
const CALIDAD = 0.85;

const lienzoABlob = (lienzo) =>
  new Promise((r) => lienzo.toBlob(r, "image/jpeg", CALIDAD));

/** Huella del contenido, para reconocer un comprobante ya registrado. */
export async function huella(blob) {
  const resumen = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(resumen)]
    .map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function paginasDePdf(archivo, avisar) {
  const datos = new Uint8Array(await archivo.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: datos }).promise;
  const salida = [];

  for (let n = 1; n <= pdf.numPages; n++) {
    avisar?.(`${archivo.name} — página ${n} de ${pdf.numPages}`);

    const pagina = await pdf.getPage(n);
    const vista = pagina.getViewport({ scale: ESCALA });
    const lienzo = document.createElement("canvas");
    lienzo.width = vista.width;
    lienzo.height = vista.height;

    await pagina.render({ canvasContext: lienzo.getContext("2d"), viewport: vista }).promise;
    const blob = await lienzoABlob(lienzo);

    salida.push({ blob, origen: archivo.name, pagina: n, totalPaginas: pdf.numPages });
    // El lienzo de una página A4 a escala 2 ocupa varios megas; soltarlo acá
    // evita que un PDF largo se coma la memoria de la pestaña.
    lienzo.width = lienzo.height = 0;
  }
  return salida;
}

/**
 * Convierte lo que entre —imágenes, PDF, foto de cámara— en una lista de
 * páginas listas para leer.
 */
export async function aPaginas(archivos, avisar) {
  const salida = [];

  for (const archivo of archivos) {
    if (archivo.type === "application/pdf") {
      salida.push(...await paginasDePdf(archivo, avisar));
    } else if (archivo.type.startsWith("image/")) {
      avisar?.(archivo.name);
      salida.push({ blob: archivo, origen: archivo.name, pagina: 1, totalPaginas: 1 });
    }
    // Lo demás se ignora en silencio: arrastrar una carpeta con archivos
    // sueltos es común y no debería interrumpir el lote entero.
  }

  return Promise.all(salida.map(async (p) => ({
    ...p,
    id: crypto.randomUUID(),
    huella: await huella(p.blob),
    url: URL.createObjectURL(p.blob),
  })));
}
