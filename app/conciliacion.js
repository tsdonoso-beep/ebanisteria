// El cruce entre lo rendido y lo sustentado.
//
// Digitalizar por sí solo no convence a nadie: el consolidado ya existe y se
// arma a mano. Lo que no existe es la respuesta a «de estas 54 líneas, ¿cuáles
// tienen su comprobante?». Eso es lo que sale de acá.

import { claveDe } from "./campos.js";
import { HEREDABLES } from "./config.js";

/** Cuánto puede diferir un importe y seguir considerándose el mismo gasto. */
const TOLERANCIA = 0.05;

const aNumero = (v) => {
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return isNaN(n) ? null : n;
};

/**
 * Empareja comprobantes con líneas del consolidado.
 *
 * Dos pasadas, y el orden no es casual. Primero por número de comprobante, que
 * es identidad de verdad: si coincide, es el mismo documento aunque el importe
 * esté mal tecleado. Solo lo que quede suelto se intenta por fecha e importe,
 * que es una coincidencia plausible y no una prueba — por eso se marca aparte
 * en lugar de darse por buena.
 */
export function cruzar(comprobantes, lineas) {
  const parejas = new Map();   // índice de línea → comprobante
  const porComprobante = new Map();

  const librosLinea = lineas.map((l, i) => ({ i, l, tomada: false }));
  const librosComp = comprobantes.map((c, i) => ({ i, c, tomado: false }));

  // --- pasada 1: por número de comprobante ---
  const porClave = new Map();
  for (const e of librosLinea) {
    const k = claveDe(e.l);
    if (!k) continue;
    if (!porClave.has(k)) porClave.set(k, []);
    porClave.get(k).push(e);
  }

  for (const e of librosComp) {
    const k = claveDe(e.c);
    if (!k) continue;
    const candidata = porClave.get(k)?.find((x) => !x.tomada);
    if (!candidata) continue;

    candidata.tomada = true;
    e.tomado = true;
    parejas.set(candidata.i, { comprobante: e.i, como: "numero" });
    porComprobante.set(e.i, { linea: candidata.i, como: "numero" });
  }

  // --- pasada 2: por fecha e importe ---
  for (const e of librosComp) {
    if (e.tomado) continue;
    const imp = aNumero(e.c.importe);
    if (imp == null || !e.c.fecha) continue;

    const candidata = librosLinea.find((x) => {
      if (x.tomada) return false;
      const li = aNumero(x.l.importe);
      return li != null && x.l.fecha === e.c.fecha && Math.abs(li - imp) <= TOLERANCIA;
    });
    if (!candidata) continue;

    candidata.tomada = true;
    e.tomado = true;
    parejas.set(candidata.i, { comprobante: e.i, como: "fecha-importe" });
    porComprobante.set(e.i, { linea: candidata.i, como: "fecha-importe" });
  }

  // --- diferencias de importe en las parejas que sí cuadraron por número ---
  const discrepancias = [];
  for (const [iLinea, p] of parejas) {
    const li = aNumero(lineas[iLinea].importe);
    const ci = aNumero(comprobantes[p.comprobante].importe);
    if (li == null || ci == null) continue;
    if (Math.abs(li - ci) > TOLERANCIA) {
      discrepancias.push({ linea: iLinea, comprobante: p.comprobante, rendido: li, comprobado: ci });
    }
  }

  return {
    parejas,
    porComprobante,
    discrepancias,
    /** Líneas rendidas sin comprobante que las sustente. */
    sinSustento: librosLinea.filter((x) => !x.tomada).map((x) => x.i),
    /** Comprobantes cargados que no figuran en el consolidado. */
    noDeclarados: librosComp.filter((x) => !x.tomado).map((x) => x.i),
  };
}

/**
 * Copia al comprobante los datos de gestión de su línea del consolidado.
 *
 * El comprobante impreso no dice a qué proyecto se cargó ni quién lo pidió:
 * eso solo vive en la rendición. Cuando el cruce los une, esos campos bajan al
 * registro y dejan de teclearse a mano. No se pisa lo que la persona ya
 * escribió.
 */
export function heredar(comprobante, linea) {
  const salida = { ...comprobante };
  for (const k of HEREDABLES) {
    if (!String(salida[k] ?? "").trim() && String(linea[k] ?? "").trim()) {
      salida[k] = linea[k];
    }
  }
  return salida;
}

/** Números redondos para encabezar el cuadre. */
export function resumen(comprobantes, lineas, cruce) {
  const suma = (xs) => xs.reduce((t, x) => t + (aNumero(x.importe) ?? 0), 0);
  return {
    lineas: lineas.length,
    sustentadas: lineas.length - cruce.sinSustento.length,
    sinSustento: cruce.sinSustento.length,
    noDeclarados: cruce.noDeclarados.length,
    discrepancias: cruce.discrepancias.length,
    totalRendido: suma(lineas).toFixed(2),
    totalComprobado: suma(comprobantes).toFixed(2),
  };
}
