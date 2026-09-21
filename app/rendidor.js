// La vista de quien gastó.
//
// Es el mismo motor con otra postura. Contabilidad trabaja sentada, con un PDF
// de doce páginas y una tabla de diez columnas; quien viaja trabaja de pie, con
// el teléfono en una mano y la boleta en la otra, y va fotografiando conforme
// le dan los papeles. La tabla ancha no le sirve y la unidad compartida no le
// pertenece.
//
// Tres diferencias de fondo, y ninguna es cosmética:
//
//   1. Se captura primero y se lee después, a propósito. En la calle no se
//      espera medio minuto por foto a que el OCR y la IA terminen: se junta
//      todo y se extrae de una sentada, con señal y con calma.
//   2. Todo nace en «Mi unidad» de la persona, con ella de dueña. No toca la
//      hoja del área ni la unidad compartida, a las que puede no tener acceso.
//   3. El número de memo lo escribe ella. Es el dato que la herramienta no
//      puede adivinar y el que después permite que contabilidad la encuentre.

import { CABECERA_VACIA, calcular, faltaParaCerrar } from "./rendicion.js";
import { TIPOS, NO_CUENTAN_POR_DEFECTO, etiquetaTipo, getClaveGemini } from "./config.js";
import { aPaginas } from "./paginas.js";
import { leer, reiniciarAprendizaje } from "./lectura.js";
import { Cancelado } from "./cola.js";
import { faltantes, claveDe } from "./campos.js";
import { carpetaDeMemo, enlaceCarpeta } from "./mi-unidad.js";
import { subir, fechaCarpeta } from "./drive.js";
import { generar } from "./hoja-rendicion.js";
import { sesion } from "./auth.js";

const $ = (s) => document.querySelector(s);
const crear = (tag, clase, texto) => {
  const e = document.createElement(tag);
  if (clase) e.className = clase;
  if (texto != null) e.textContent = texto;
  return e;
};

/** Lo que se fotografió y todavía no se ha leído. */
let capturas = [];
/** Lo ya leído, una entrada por comprobante (una foto puede traer dos). */
let leidos = [];
let datos = CABECERA_VACIA();
let noCuentan = [...NO_CUENTAN_POR_DEFECTO];
let hoja = null;

/** Lo que main.js presta: avisos, ocupado y el diálogo de la clave. */
let api = {};

// --- persistencia de la cabecera ----------------------------------------

// Solo la cabecera, nunca las fotos. En un teléfono la pestaña se recarga
// sola con cualquier llamada entrante, y volver a teclear el memo y el monto
// es la clase de fricción que hace que la herramienta se abandone. Las fotos
// no se guardan: son megas contra una cuota de kilobytes, y además siguen en
// el carrete.
const CLAVE = "inroscan_mi_rendicion";

function recordarDatos() {
  try { localStorage.setItem(CLAVE, JSON.stringify(datos)); } catch { /* cuota llena */ }
}

function recuperarDatos() {
  try {
    const g = JSON.parse(localStorage.getItem(CLAVE) ?? "null");
    if (g && typeof g === "object") datos = { ...CABECERA_VACIA(), ...g };
  } catch { /* nada que recuperar */ }
}

// --- captura -------------------------------------------------------------

async function recibir(archivos) {
  const lista = [...archivos];
  if (!lista.length || api.ocupadoAhora()) return;

  api.ocupado(true);
  try {
    api.avisar("Preparando las fotos…", "trabajando");
    const nuevas = await aPaginas(lista, (t) => api.avisar(t, "trabajando"));
    if (!nuevas.length) return api.avisar("Eso no era una imagen ni un PDF.", "malo");

    // Una misma boleta fotografiada dos veces no se agrega dos veces: la
    // huella es del contenido, y en la calle es fácil disparar de más.
    const conocidas = new Set([...capturas, ...leidos].map((p) => p.huella));
    const frescas = nuevas.filter((p) => !conocidas.has(p.huella));
    const repetidas = nuevas.length - frescas.length;

    capturas.push(...frescas);
    api.avisar(repetidas
      ? `${frescas.length} agregada${frescas.length === 1 ? "" : "s"}, ${repetidas} repetida${repetidas === 1 ? "" : "s"} que ya tenías.`
      : `${frescas.length} comprobante${frescas.length === 1 ? "" : "s"} por leer.`, "bueno");
  } catch (e) {
    api.avisar(e.message, "malo");
  } finally {
    api.ocupado(false);
    pintar();
  }
}

// --- lectura -------------------------------------------------------------

async function extraer() {
  if (!capturas.length || api.ocupadoAhora()) return;

  // El OCR del navegador se atraganta con una foto de mano: torcida, con
  // sombra y con el fondo de la mesa. Acá la IA no es el respaldo, es el
  // camino, y sin clave no hay nada que hacer salvo teclearlo todo.
  if (!getClaveGemini()) {
    api.abrirClave("Para leer fotos de comprobantes hace falta la clave. " +
                   "Pégala y vuelve a darle a Extraer.");
    return;
  }

  api.ocupado(true);
  $("#miCancelar").hidden = false;
  reiniciarAprendizaje();

  const pendientes = [...capturas];
  try {
    for (const [n, p] of pendientes.entries()) {
      api.progreso(n + 1, pendientes.length, p.origen);

      try {
        const salidas = await leer(p, (t) => api.progreso(n + 1, pendientes.length, t), api.señal());
        salidas.forEach((r, i) => leidos.push({
          ...p, id: `${p.id}-${i}`, indice: i, campos: { ...r.campos },
          via: r.via, deMemoria: r.deMemoria,
        }));
      } catch (e) {
        if (e instanceof Cancelado || e.name === "AbortError") throw e;
        // Una foto ilegible no tumba las once restantes: entra igual, en
        // blanco, para completarla a mano. Perder la foto sería peor.
        leidos.push({ ...p, campos: { tipo: "", fecha: "", serie: "", numero: "", importe: "" },
                      via: "manual", fallo: e.message });
      }

      capturas = capturas.filter((c) => c.huella !== p.huella);
      pintar();
    }
    api.avisar("Listo. Revisa lo que salió en ámbar antes de guardar.", "bueno");
  } catch (e) {
    api.avisar(e instanceof Cancelado || e.name === "AbortError"
      ? "Lectura cancelada. Lo ya leído se conserva."
      : e.message, "malo");
  } finally {
    $("#miCancelar").hidden = true;
    api.ocupado(false);
    pintar();
  }
}

// --- guardar en el Drive de la persona ----------------------------------

async function guardar() {
  if (api.ocupadoAhora()) return;
  const vivos = leidos.filter((c) => c.campos);
  const falta = faltaParaCerrar(datos, vivos);
  if (falta.length) return api.avisar(`Falta ${falta.join(", ")}.`, "malo");

  api.ocupado(true);
  try {
    api.avisar("Creando tu carpeta en Drive…", "trabajando");
    const idCarpeta = await carpetaDeMemo(datos.memo);

    // Las fotos suben antes que la hoja: una rendición sin los papeles
    // detrás no sustenta nada, y cada fila enlaza a la suya.
    const enlaces = {};
    const subidos = new Map();
    for (const [i, c] of vivos.entries()) {
      api.avisar(`Subiendo la foto ${i + 1} de ${vivos.length}…`, "trabajando");
      if (!subidos.has(c.huella)) {
        const nombre = [
          c.campos.fecha || fechaCarpeta(),
          claveDe(c.campos) || c.huella.slice(0, 8),
        ].join("_") + ".jpg";
        subidos.set(c.huella, (await subir(c.blob, nombre, idCarpeta)).webViewLink);
      }
      enlaces[c.huella] = subidos.get(c.huella);
      c.enlace = subidos.get(c.huella);
    }

    api.avisar("Armando tu rendición…", "trabajando");
    hoja = await generar({ cabecera: datos, comprobantes: vivos, noCuentan, idCarpeta, enlaces });
    hoja.carpeta = enlaceCarpeta(idCarpeta);

    api.avisar("Tu rendición está en tu Drive.", "bueno");
    window.open(hoja.webViewLink, "_blank", "noopener");
  } catch (e) {
    api.avisar(e.message, "malo");
  } finally {
    api.ocupado(false);
    pintar();
  }
}

// --- pintado -------------------------------------------------------------

/**
 * Lo que hay que pedir para poder cerrar, y lo demás.
 *
 * Nueve campos antes de dejar fotografiar es pedirle una ficha a alguien que
 * está de pie con una boleta en la mano. Solo los cuatro que la rendición no
 * puede cerrar sin ellos quedan a la vista; el resto se pliega, porque son
 * datos que se completan sentado y al final.
 */
const CAMPOS = [
  ["memo", "N° de memo", "text", true],
  ["montoRecibido", "Monto recibido S/", "number", true],
  ["nombres", "Nombres", "text", true],
  ["apellidos", "Apellidos", "text", true],
];

const CAMPOS_EXTRA = [
  ["dni", "DNI", "text", false],
  ["proyecto", "Proyecto", "text", false],
  ["origenDestino", "Origen y destino", "text", false],
  ["periodoDesde", "Viaje desde", "date", false],
  ["periodoHasta", "Viaje hasta", "date", false],
];

function pintarDatos() {
  const caja = $("#misDatos");
  if (caja.childElementCount) return;   // no se repinta mientras se teclea

  const campo = ([clave, etiqueta, tipo, obligatorio]) => {
    const d = crear("div", "campo");
    const l = crear("label", "", etiqueta + (obligatorio ? " *" : ""));
    l.htmlFor = `mi-${clave}`;
    const i = crear("input");
    i.id = `mi-${clave}`;
    i.type = tipo;
    if (tipo === "number") { i.inputMode = "decimal"; i.step = "0.01"; }
    if (clave === "memo") i.placeholder = "675-2026";
    i.value = datos[clave] ?? "";
    i.autocomplete = "off";
    i.oninput = () => {
      datos[clave] = i.value;
      recordarDatos();
      pintarCifras();
      pintarCierre();
      pintarPasos();
    };
    d.append(l, i);
    return d;
  };

  caja.replaceChildren(...CAMPOS.map(campo));
  $("#misDatosExtra").replaceChildren(...CAMPOS_EXTRA.map(campo));
}

function pintarGaleria() {
  const caja = $("#miGaleria");
  caja.replaceChildren(...capturas.map((p) => {
    const d = crear("div", "foto");
    const img = crear("img");
    img.src = p.url;
    img.alt = p.origen;
    img.loading = "lazy";
    img.onclick = () => window.open(p.url, "_blank");
    const x = crear("button", "btn texto", "×");
    x.type = "button";
    x.title = "Quitar esta foto";
    x.onclick = () => {
      capturas = capturas.filter((c) => c !== p);
      URL.revokeObjectURL(p.url);
      pintar();
    };
    d.append(img, x);
    return d;
  }));

  $("#miConteo").textContent = capturas.length
    ? `${capturas.length} foto${capturas.length === 1 ? "" : "s"} por leer`
    : leidos.length ? "Todo lo capturado ya está leído."
    : "Todavía no has capturado nada.";

  $("#miExtraer").disabled = !capturas.length;
  $("#miExtraer").textContent = capturas.length > 1
    ? `Extraer los ${capturas.length} con IA` : "Extraer con IA";
}

function pintarCifras() {
  const caja = $("#misCifras");
  const r = calcular(leidos, datos, noCuentan);

  const tarjeta = (valor, etiqueta, tono = "") => {
    const d = crear("div", `cifra ${tono}`);
    d.append(crear("b", "", valor), crear("span", "", etiqueta));
    return d;
  };

  caja.replaceChildren(
    tarjeta(`S/ ${r.recibido}`, "recibido"),
    tarjeta(`S/ ${r.sustentado}`, "sustentado", "bien"),
    tarjeta(r.porcentaje === null ? "—" : `${r.porcentaje}%`, "rendido",
            r.porcentaje !== null && r.porcentaje < 100 ? "ojo" : ""),
    tarjeta(`S/ ${Math.abs(Number(r.saldo)).toFixed(2)}`,
            r.reembolsa ? "te deben" : r.devuelve ? "debes devolver" : "saldo",
            r.reembolsa ? "mal" : ""),
  );
}

/**
 * Cada comprobante como tarjeta y no como fila.
 *
 * En un teléfono una tabla de diez columnas obliga a arrastrar de lado para
 * ver el importe, que es justo el dato que se revisa. La tarjeta cabe en el
 * ancho y pide solo los cuatro campos que la rendición necesita; el resto ya
 * está en la foto.
 */
function pintarTarjetas() {
  const caja = $("#misTarjetas");
  caja.replaceChildren(...leidos.map((c) => {
    const d = crear("article", "tarjeta-comp");

    const img = crear("img");
    img.src = c.url;
    img.alt = c.origen;
    img.loading = "lazy";
    img.onclick = () => window.open(c.url, "_blank");
    d.append(img);

    const cuerpo = crear("div", "cuerpo");
    const pendientes = faltantes(c.campos);

    const sel = crear("select");
    sel.setAttribute("aria-label", "Tipo de documento");
    sel.append(crear("option", "", "¿Qué es?"));
    sel.firstChild.value = "";
    for (const t of TIPOS) {
      const o = crear("option", "", t.etiqueta);
      o.value = t.id;
      if (c.campos.tipo === t.id) o.selected = true;
      sel.append(o);
    }
    if (!c.campos.tipo) sel.classList.add("falta");
    sel.onchange = () => { c.campos.tipo = sel.value; c.via = "manual"; pintar(); };
    cuerpo.append(sel);

    const linea = crear("div", "linea");
    for (const [campo, etiqueta, tipo] of [
      ["fecha", "Fecha", "date"], ["numero", "N° de documento", "text"],
      ["importe", "Importe S/", "number"],
    ]) {
      const i = crear("input");
      i.type = tipo;
      i.placeholder = etiqueta;
      i.setAttribute("aria-label", etiqueta);
      if (tipo === "number") { i.inputMode = "decimal"; i.step = "0.01"; }
      i.value = c.campos[campo] ?? "";
      if (pendientes.includes(campo)) i.classList.add("falta");
      i.oninput = () => {
        c.campos[campo] = i.value;
        c.via = "manual";
        i.classList.toggle("falta", faltantes(c.campos).includes(campo));
        pintarCifras();
        pintarCierre();
      };
      linea.append(i);
    }
    cuerpo.append(linea);

    const pie = crear("div", "pie-tarjeta");
    if (c.fallo) pie.append(crear("span", "alerta", "no se pudo leer: complétalo"));
    else if (pendientes.length) pie.append(crear("span", "pendiente",
      pendientes.length > 2 ? `faltan ${pendientes.length} datos` : `falta ${pendientes.join(" y ")}`));
    else if (c.deMemoria) pie.append(crear("span", "via ocr", "ya leído antes"));
    if (c.campos.proveedor) pie.append(crear("span", "chico", c.campos.proveedor));

    const x = crear("button", "btn texto", "Quitar");
    x.type = "button";
    x.onclick = () => {
      leidos = leidos.filter((o) => o !== c);
      if (![...leidos, ...capturas].some((o) => o.huella === c.huella)) URL.revokeObjectURL(c.url);
      pintar();
    };
    pie.append(x);
    cuerpo.append(pie);

    d.append(cuerpo);
    return d;
  }));
}

/** Los conmutadores de qué sustenta, con la DJ como caso de siempre. */
function pintarSustento() {
  const caja = $("#miSustento");
  const r = calcular(leidos, datos, noCuentan);
  caja.replaceChildren(...r.porTipo.map((t) => {
    const cuenta = !noCuentan.includes(t.tipo);
    const b = crear("button", "tipo-toggle");
    b.type = "button";
    b.setAttribute("aria-pressed", String(cuenta));
    b.append(
      crear("span", "marca", cuenta ? "✓" : ""),
      crear("span", "", `${etiquetaTipo(t.tipo)} · ${t.cuantos}`),
      crear("b", "", `S/ ${t.importe}`),
    );
    b.onclick = () => {
      noCuentan = cuenta ? [...noCuentan, t.tipo] : noCuentan.filter((x) => x !== t.tipo);
      pintar();
    };
    return b;
  }));
}

function pintarCierre() {
  const falta = faltaParaCerrar(datos, leidos.filter((c) => c.campos));
  const btn = $("#miHoja");
  btn.disabled = falta.length > 0;
  btn.title = falta.length ? `Falta ${falta.join(", ")}` : "Se crea en tu propio Drive";

  $("#miFalta").textContent = falta.length ? `Para guardarla falta ${falta.join(", ")}.` : "";
  $("#miFalta").hidden = !falta.length;

  const hecho = $("#miHecho");
  hecho.replaceChildren();
  hecho.hidden = !hoja;
  if (!hoja) return;
  const a = crear("a", "btn sec", "Abrir mi rendición");
  a.href = hoja.webViewLink;
  a.target = "_blank";
  a.rel = "noopener";
  const b = crear("a", "btn texto", "Ver la carpeta");
  b.href = hoja.carpeta;
  b.target = "_blank";
  b.rel = "noopener";
  hecho.append(a, b,
    crear("p", "chico", "Compártela con contabilidad desde el botón «Compartir» de Google."));
}

/**
 * Marca cada paso como hecho.
 *
 * Cinco tarjetas del mismo peso visual no dicen en cuál estás. Con la marca,
 * el recorrido se lee de un vistazo y se ve qué falta sin tener que
 * releerlo entero.
 */
function pintarPasos() {
  const completo = (c) => leidos.length && !faltantes(c.campos).length && c.campos.tipo;
  const estado = {
    paso1: Boolean(String(datos.memo).trim() && Number(datos.montoRecibido) &&
                   (datos.nombres || datos.apellidos)),
    paso2: capturas.length > 0 || leidos.length > 0,
    paso3: leidos.length > 0,
    misResultados: leidos.length > 0 && leidos.every(completo),
    miCierre: Boolean(hoja),
  };
  for (const [id, hecho] of Object.entries(estado)) {
    $(`#${id}`)?.classList.toggle("completo", hecho);
  }
}

export function pintar() {
  pintarDatos();
  pintarGaleria();
  const hay = leidos.length > 0;
  $("#misResultados").hidden = !hay;
  $("#miCierre").hidden = !hay;
  if (hay) { pintarCifras(); pintarTarjetas(); pintarSustento(); pintarCierre(); }
  pintarPasos();
}

// --- montaje -------------------------------------------------------------

export function montar(prestado) {
  api = prestado;
  recuperarDatos();

  const conectar = (id, fn) => {
    const e = $(id);
    e.onchange = (ev) => { fn(ev.target.files); ev.target.value = ""; };
  };
  conectar("#miCamara", recibir);
  conectar("#misArchivos", recibir);

  $("#miExtraer").onclick = extraer;
  $("#miCancelar").onclick = () => api.cancelar();
  $("#miHoja").onclick = guardar;
  $("#miEmpezar").onclick = () => {
    if (api.ocupadoAhora()) return;
    if (!confirm("¿Empezar una rendición nueva? Se borra lo capturado en esta pantalla.")) return;
    [...capturas, ...leidos].forEach((p) => URL.revokeObjectURL(p.url));
    capturas = []; leidos = []; hoja = null;
    datos = CABECERA_VACIA();
    noCuentan = [...NO_CUENTAN_POR_DEFECTO];
    recordarDatos();
    $("#misDatos").replaceChildren();
    $("#misDatosExtra").replaceChildren();
    pintar();
  };
}

/** Al entrar al modo: se prellena con quien está en sesión. */
export function abrir() {
  const correo = sesion()?.correo ?? "";
  if (!datos.nombres && !datos.apellidos && correo) {
    // De t.donoso@inroprin.com no sale un nombre, pero sí una pista útil que
    // la persona corrige en un toque. Es menos trabajo que empezar en blanco.
    const [usuario] = correo.split("@");
    const partes = usuario.split(/[._-]+/).filter(Boolean);
    if (partes.length > 1) {
      datos.nombres = partes[0].replace(/^\w/, (c) => c.toUpperCase());
      datos.apellidos = partes.slice(1).map((p) => p.replace(/^\w/, (c) => c.toUpperCase())).join(" ");
    }
  }
  if (!datos.fechaRendicion) datos.fechaRendicion = fechaCarpeta();
  $("#misDatos").replaceChildren();
  $("#misDatosExtra").replaceChildren();
  pintar();
}

/** Para avisar antes de cerrar la pestaña con fotos sin guardar. */
export const hayPendiente = () => (capturas.length + leidos.length) > 0 && !hoja;
