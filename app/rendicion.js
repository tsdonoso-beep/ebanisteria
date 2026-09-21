// La rendición: qué se recibió, qué se sustenta y qué falta.
//
// Es la aritmética que hoy se hace a mano en la plantilla, y por eso mismo
// conviene que la haga la máquina: un porcentaje mal calculado no lo nota
// nadie hasta que alguien lo audita.
//
// La distinción que manda acá es cuáles documentos sustentan. Sale de la
// plantilla real del memo 675: doce comprobantes suman S/ 347.50, pero el
// «monto rendido» es S/ 242.00 y la diferencia son exactamente las dos
// declaraciones juradas. Una DJ no vale ante SUNAT, así que se archiva pero
// no sustenta.

import { NO_CUENTAN_POR_DEFECTO } from "./config.js";

const aNumero = (v) => {
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
};

const dos = (n) => (Math.round(n * 100) / 100).toFixed(2);

/** Cabecera de una rendición, con los campos que pide la plantilla. */
export const CABECERA_VACIA = () => ({
  memo: "", fechaRendicion: "", montoRecibido: "",
  proyecto: "", nombres: "", apellidos: "", dni: "",
  origenDestino: "", periodoDesde: "", periodoHasta: "",
});

/**
 * Cuentas de la rendición.
 *
 * `noCuentan` son los tipos excluidos del sustento. Llega como parámetro y no
 * como constante porque la regla cambia según quién revise: la interfaz deja
 * marcarlos y el número se recalcula a la vista, en lugar de esconder el
 * criterio dentro del código.
 */
export function calcular(comprobantes, cabecera, noCuentan = NO_CUENTAN_POR_DEFECTO) {
  const excluidos = new Set(noCuentan);
  const vivos = comprobantes.filter((c) => c?.importe !== undefined || c?.campos);
  // Se conserva la huella al aplanar: es lo que después enlaza fila e imagen.
  const campos = vivos.map((c) => (c.campos ? { ...c.campos, huella: c.huella } : c));

  const recibido = aNumero(cabecera?.montoRecibido);
  const total = campos.reduce((t, c) => t + aNumero(c.importe), 0);
  const sustentado = campos
    .filter((c) => !excluidos.has(c.tipo))
    .reduce((t, c) => t + aNumero(c.importe), 0);

  // Lo que no sustenta se informa aparte en vez de desaparecer: está
  // digitalizado y archivado, y quien revisa tiene derecho a verlo.
  const sinSustentar = total - sustentado;

  // El saldo se mide contra lo REALMENTE gastado, no contra lo que sustenta:
  // una DJ es dinero que salió del bolsillo aunque SUNAT no la acepte.
  const saldo = recibido - total;

  const porTipo = {};
  for (const c of campos) {
    const t = c.tipo || "OTRO";
    porTipo[t] ??= { tipo: t, cuantos: 0, importe: 0, cuenta: !excluidos.has(t) };
    porTipo[t].cuantos++;
    porTipo[t].importe += aNumero(c.importe);
  }

  return {
    comprobantes: campos.length,
    recibido: dos(recibido),
    total: dos(total),
    sustentado: dos(sustentado),
    sinSustentar: dos(sinSustentar),
    /** Positivo: sobró y hay que devolver. Negativo: se gastó de más. */
    saldo: dos(saldo),
    devuelve: saldo > 0.005,
    reembolsa: saldo < -0.005,
    /** El número que mira todo el mundo. Sin monto recibido no hay porcentaje. */
    porcentaje: recibido > 0 ? Math.round((sustentado / recibido) * 100) : null,
    porTipo: Object.values(porTipo)
      .map((t) => ({ ...t, importe: dos(t.importe) }))
      .sort((a, b) => Number(b.importe) - Number(a.importe)),
  };
}

/** Las filas de la rendición, en el orden y las columnas de la plantilla. */
export function filasDePlantilla(comprobantes) {
  return comprobantes
    .map((c) => c.campos ?? c)
    .slice()
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
    .map((c) => ({
      fecha: c.fecha,
      tipo: c.tipo,
      numero: [c.serie, c.numero].filter(Boolean).join("-") || c.numero || "",
      importe: dos(aNumero(c.importe)),
      // Para poder enlazar cada fila con su imagen en Drive.
      clave: c.huella ?? [c.serie, c.numero].filter(Boolean).join("-"),
    }));
}

/** Lo que falta para poder cerrar la rendición. */
export function faltaParaCerrar(cabecera, comprobantes) {
  const falta = [];
  if (!String(cabecera?.memo ?? "").trim()) falta.push("número de memo");
  if (!aNumero(cabecera?.montoRecibido)) falta.push("monto recibido");
  if (!String(cabecera?.nombres ?? "").trim() &&
      !String(cabecera?.apellidos ?? "").trim()) falta.push("a nombre de quién");
  if (!comprobantes.length) falta.push("al menos un comprobante");
  return falta;
}
