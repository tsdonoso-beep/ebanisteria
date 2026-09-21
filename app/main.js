// Orquestación e interfaz.
//
// El registro nunca es automático. Se lee, se muestra en una tabla editable, y
// registrar es un botón que aprieta una persona. Contabilidad confía en lo que
// revisó, no en lo que apareció solo.

import {
  PESTANA_REGISTRO, PESTANA_CONSOLIDADO, HEREDABLES, CARPETA_RAIZ, HOJA,
  getClaveGemini, setClaveGemini, borrarClaveGemini, pareceClaveGemini, enmascarar,
  getProyecto, setProyecto,
} from "./config.js";
import { entrar, salir, sesion } from "./auth.js";
import { preparar, agregar, yaRegistrado } from "./sheets.js";
import { carpetaDelDia, subir, fechaCarpeta } from "./drive.js";
import { aPaginas } from "./paginas.js";
import { textoDePdf } from "./texto-pdf.js";
import { leer, leerConsolidado, probarClave, reiniciarAprendizaje, ocrDesactivado, ritmoActual } from "./lectura.js";
import { Cancelado } from "./cola.js";
import { cuantasRecuerda, olvidarTodo } from "./memoria.js";
import { estaCompleto, faltantes, claveDe } from "./campos.js";
import { cruzar, heredar, resumen } from "./conciliacion.js";

const $ = (s) => document.querySelector(s);
const crear = (tag, clase, texto) => {
  const e = document.createElement(tag);
  if (clase) e.className = clase;
  if (texto != null) e.textContent = texto;
  return e;
};

/** Comprobantes cargados en esta sesión, en orden de llegada. */
let comprobantes = [];
/** Líneas del consolidado leído, si hay uno. */
let rendicion = null;
let cruce = null;
let previos = { huellas: new Set(), claves: new Set() };
let trabajando = false;
/** Permite abandonar un lote largo sin recargar la página. */
let abortador = null;

// --- avisos --------------------------------------------------------------

let temporizador = null;

function avisar(texto, tono = "") {
  const caja = $("#aviso");
  caja.textContent = texto;
  caja.className = `aviso ${tono} ${texto ? "visible" : ""}`;
  clearTimeout(temporizador);
  if (texto && tono !== "trabajando") temporizador = setTimeout(() => avisar(""), 7000);
}

const ocupado = (v) => {
  trabajando = v;
  document.body.classList.toggle("ocupado", v);
  $("#cancelar").hidden = !v;
  if (!v) abortador = null;
  pintarBotones();
};

/**
 * Progreso con numerador y denominador.
 *
 * Un lote de doce páginas con la IA de por medio tarda varios minutos, y sin
 * un «7 de 12» no hay forma de distinguir lento de colgado. Es la diferencia
 * entre esperar tranquilo y recargar a la mitad.
 */
function progreso(hecho, total, detalle) {
  const partes = [`${hecho} de ${total}`];
  if (detalle) partes.push(detalle);
  // Si el OCR se apagó solo, decirlo: explica por qué de pronto va más rápido
  // y por qué se está gastando cuota en páginas que antes salían gratis.
  if (ocrDesactivado()) partes.push("OCR saltado, va directo a la IA");
  if (ritmoActual() > 5) partes.push(`IA a ${ritmoActual()} s por página`);
  avisar(partes.join(" · "), "trabajando");
}

/**
 * Rechaza con explicación en vez de no hacer nada.
 *
 * Un lote de doce páginas ocupa más de un minuto, y durante ese rato un clic
 * en «Consolidado» se descartaba en silencio. Desde fuera no se distingue de
 * un botón roto.
 */
function ocupadoAhora() {
  if (!trabajando) return false;
  avisar("Espera a que termine el lote en curso, o cancélalo.", "malo");
  return true;
}

// --- sesión --------------------------------------------------------------

async function alEntrar() {
  try {
    avisar("Conectando…", "trabajando");
    const { correo, delDominio } = await entrar();

    $("#quien").textContent = correo;
    $("#quien").classList.toggle("ajeno", !delDominio);
    document.body.classList.add("dentro");

    avisar("Preparando la hoja de registro…", "trabajando");
    await preparar();
    previos = await yaRegistrado();

    avisar(delDominio ? "" : "Entraste con una cuenta de otro dominio.", delDominio ? "" : "malo");
    pintar();
  } catch (e) {
    avisar(e.message, "malo");
  }
}

function alSalir() {
  salir();
  comprobantes.forEach((c) => URL.revokeObjectURL(c.url));
  comprobantes = [];
  rendicion = cruce = null;
  document.body.classList.remove("dentro");
  $("#quien").textContent = "";
  pintar();
}

// --- carga de comprobantes ----------------------------------------------

async function recibirComprobantes(archivos) {
  const lista = [...archivos];
  if (!lista.length) return;
  if (ocupadoAhora()) return;

  abortador = new AbortController();
  ocupado(true);
  reiniciarAprendizaje();

  try {
    avisar("Preparando las páginas…", "trabajando");
    const paginas = await aPaginas(lista, (t) => avisar(t, "trabajando"));
    if (!paginas.length) return avisar("No había imágenes ni PDF en lo que cargaste.", "malo");

    const proyecto = $("#proyecto").value.trim();

    for (const [n, p] of paginas.entries()) {
      const cual = `${p.origen}${p.totalPaginas > 1 ? ` · pág. ${p.pagina}` : ""}`;
      progreso(n + 1, paginas.length, cual);

      let leidos;
      try {
        leidos = await leer(p, (t) => progreso(n + 1, paginas.length, `${cual} — ${t}`), abortador.signal);
      } catch (e) {
        if (e instanceof Cancelado || e.name === "AbortError") throw e;
        // Un fallo en una página no cancela el lote: se anota en su fila y se
        // sigue, que es lo contrario de perder las once restantes.
        comprobantes.push({ ...p, estado: "error", error: e.message, campos: null });
        pintar();
        continue;
      }

      // Una imagen puede traer varios comprobantes: cada uno es su propia
      // fila, aunque compartan archivo y huella.
      leidos.forEach((r, i) => {
        comprobantes.push({
          ...p,
          id: `${p.id}-${i}`,
          indice: i,
          deVarios: leidos.length > 1,
          campos: { ...r.campos, proyecto: r.campos.proyecto || proyecto },
          via: r.via,
          deMemoria: r.deMemoria,
          sospechaVarios: r.sospechaVarios,
          estado: "listo",
        });
      });
      pintar();
    }

    recalcularCruce();
    const conError = comprobantes.filter((c) => c.estado === "error").length;
    avisar(conError ? `Listo, con ${conError} página${conError > 1 ? "s" : ""} que falló.` : "",
           conError ? "malo" : "");
  } catch (e) {
    avisar(e instanceof Cancelado || e.name === "AbortError"
      ? "Lote cancelado. Lo ya leído se conserva."
      : e.message, "malo");
  } finally {
    ocupado(false);
    pintar();
  }
}

// --- carga del consolidado ----------------------------------------------

async function recibirConsolidado(archivos) {
  const lista = [...archivos];
  if (!lista.length) return;
  if (ocupadoAhora()) return;

  // Sin clave no se puede leer una tabla de cincuenta filas. Antes esto era un
  // aviso que se desvanecía en siete segundos: desde abajo, donde está la
  // tabla, no se veía, y el botón parecía no hacer nada. Ahora se abre el
  // diálogo de la clave, que es lo único que desbloquea la situación.
  if (!getClaveGemini()) {
    avisar("El consolidado es una tabla de decenas de filas: necesita clave de IA.", "malo");
    abrirClave("Para leer un consolidado hace falta la clave. Pégala y vuelve a cargarlo.");
    return;
  }

  ocupado(true);
  try {
    // Se saca la capa de texto antes de rasterizar: si el PDF la tiene, la
    // lectura sale exacta y la imagen solo se usa de respaldo.
    const texto = await textoDePdf(lista[0], (t) => avisar(t, "trabajando"));
    const paginas = await aPaginas(lista, (t) => avisar(t, "trabajando"));
    if (!paginas.length) return avisar("No se pudo abrir ese archivo.", "malo");

    paginas.forEach((p, i) => { p.texto = texto?.[i] ?? null; });
    if (!texto) {
      avisar("El consolidado no trae capa de texto; se leerá de la imagen.", "trabajando");
    }

    const acumulado = { caja: "", administrador: "", montoAsignado: "", gastosRealizados: "", lineas: [] };

    for (const [i, p] of paginas.entries()) {
      progreso(i + 1, paginas.length, "consolidado");
      const parte = await leerConsolidado(p, (t) => avisar(t, "trabajando"));

      // La cabecera solo viene en la primera página; las demás traen tabla.
      acumulado.caja ||= parte.caja;
      acumulado.administrador ||= parte.administrador;
      acumulado.montoAsignado ||= parte.montoAsignado;
      acumulado.gastosRealizados ||= parte.gastosRealizados;
      acumulado.lineas.push(...parte.lineas);
    }

    acumulado.origen = lista[0].name;
    rendicion = acumulado;
    recalcularCruce();

    avisar(`Consolidado leído: ${acumulado.lineas.length} líneas.`, "bueno");
  } catch (e) {
    avisar(e.message, "malo");
  } finally {
    ocupado(false);
    pintar();
  }
}

/**
 * Rehace el cruce y baja al comprobante los datos de gestión de su línea.
 *
 * Se llama tras cada carga porque el cruce cambia con cada comprobante nuevo:
 * una línea que estaba sin sustento deja de estarlo en cuanto aparece su
 * boleta.
 */
function recalcularCruce() {
  if (!rendicion) return (cruce = null);

  cruce = cruzar(comprobantes.map((c) => c.campos ?? {}), rendicion.lineas);

  for (const [iComp, p] of cruce.porComprobante) {
    const c = comprobantes[iComp];
    if (c?.campos) c.campos = heredar(c.campos, rendicion.lineas[p.linea]);
  }
}

// --- registro ------------------------------------------------------------

function filaDeComprobante(c, enlace) {
  const k = c.campos;
  return [
    new Date().toISOString(), k.fecha, k.tipo, k.serie, k.numero, k.ruc, k.proveedor,
    k.proyecto, k.area, k.responsable, k.categoria, k.subcategoria,
    k.clasificacion, k.descripcion,
    k.moneda, k.subtotal, k.igv, k.importe,
    enlace, c.origen, c.pagina, c.via, c.huella, claveDe(k), sesion()?.correo ?? "",
  ];
}

async function registrar() {
  const listos = comprobantes.filter((c) => c.estado === "listo" && estaCompleto(c.campos));
  if (!listos.length) return avisar("No hay comprobantes completos para registrar.", "malo");

  ocupado(true);
  try {
    const carpeta = await carpetaDelDia();
    const filas = [];

    // Varios comprobantes de la misma imagen comparten archivo: se sube una
    // sola vez y las dos filas apuntan al mismo enlace.
    const subidos = new Map();

    for (const [i, c] of listos.entries()) {
      avisar(`Subiendo ${i + 1} de ${listos.length}…`, "trabajando");

      if (!subidos.has(c.huella)) {
        const nombre = [
          c.campos.fecha || fechaCarpeta(),
          c.campos.ruc || "sin-ruc",
          claveDe(c.campos) || c.huella.slice(0, 8),
        ].join("_") + ".jpg";
        subidos.set(c.huella, (await subir(c.blob, nombre, carpeta)).webViewLink);
      }

      const enlace = subidos.get(c.huella);
      filas.push(filaDeComprobante(c, enlace));
      c.enlace = enlace;
    }

    // Las filas van en una sola llamada: si se cortara a mitad, es preferible
    // que no quede ninguna anotada a que queden la mitad y nadie sepa cuáles.
    await agregar(PESTANA_REGISTRO, filas);

    // Solo se anota la clave, no la huella: los hermanos de una misma imagen
    // comparten huella de forma legítima, y marcarla dejaría al segundo
    // comprobante señalado como repetido por existir el primero.
    listos.forEach((c) => {
      c.estado = "registrado";
      const k = claveDe(c.campos);
      if (k) previos.claves.add(k);
    });
    avisar(`${filas.length} comprobante${filas.length > 1 ? "s" : ""} registrado${filas.length > 1 ? "s" : ""}.`, "bueno");
  } catch (e) {
    avisar(e.message, "malo");
  } finally {
    ocupado(false);
    pintar();
  }
}

async function registrarConsolidado() {
  if (!rendicion?.lineas.length) return;

  ocupado(true);
  try {
    const ahora = new Date().toISOString();
    const quien = sesion()?.correo ?? "";
    const filas = rendicion.lineas.map((l) => [
      ahora, rendicion.caja, rendicion.administrador, l.fecha, l.tipo,
      l.numeroCrudo || claveDe(l), l.proveedor, l.proyecto, l.area, l.responsable,
      l.categoria, l.subcategoria, l.clasificacion, l.descripcion, l.importe,
      claveDe(l), rendicion.origen, quien,
    ]);

    await agregar(PESTANA_CONSOLIDADO, filas);
    avisar(`Consolidado registrado: ${filas.length} líneas.`, "bueno");
  } catch (e) {
    avisar(e.message, "malo");
  } finally {
    ocupado(false);
  }
}

// --- tabla de comprobantes ----------------------------------------------

const CAMPOS_TABLA = [
  "tipo", "serie", "numero", "fecha", "ruc", "proveedor",
  "proyecto", "responsable", "descripcion", "importe",
];

const ETIQUETA_VIA = { ocr: "OCR", ia: "IA", parcial: "incompleto", manual: "editado" };

function filaDe(c, i) {
  const fila = crear("tr", c.estado === "registrado" ? "registrada" : "");

  const celdaImg = crear("td", "mini");
  if (c.indice > 0) {
    // El segundo comprobante de una misma imagen no repite la miniatura: se
    // marca como continuación para que se vea de un golpe que van juntos.
    celdaImg.append(crear("span", "sigue", "↳"));
  } else {
    const img = crear("img");
    img.src = c.url;
    img.alt = c.origen;
    img.onclick = () => window.open(c.url, "_blank");
    celdaImg.append(img);
    if (c.totalPaginas > 1) celdaImg.append(crear("span", "pag", `p. ${c.pagina}`));
  }
  fila.append(celdaImg);

  if (c.estado === "error") {
    const td = crear("td", "malo", c.error);
    td.colSpan = CAMPOS_TABLA.length + 2;
    fila.append(td);
    return fila;
  }

  const pendientes = faltantes(c.campos);

  for (const campo of CAMPOS_TABLA) {
    const td = crear("td");
    const entrada = crear("input");
    entrada.value = c.campos[campo] ?? "";
    entrada.disabled = c.estado === "registrado";
    // Amarillo lo que hay que revisar: es el código de color de IMPOPRINT,
    // que el equipo ya asocia con «acá falta algo».
    if (pendientes.includes(campo)) entrada.classList.add("falta");
    entrada.oninput = () => {
      c.campos[campo] = entrada.value;
      c.via = "manual";
      entrada.classList.toggle("falta", faltantes(c.campos).includes(campo));
      pintarBotones();
    };
    entrada.onchange = () => { recalcularCruce(); pintar(); };
    td.append(entrada);
    fila.append(td);
  }

  const estado = crear("td", "estado");
  if (c.estado === "registrado") {
    const a = crear("a", "", "en Drive");
    a.href = c.enlace;
    a.target = "_blank";
    estado.append(a);
  } else {
    // «incompleto» y «falta completar» decían lo mismo dos veces. Un solo
    // distintivo, y que nombre los campos: saber que falta la fecha ahorra
    // buscarla celda por celda.
    if (!pendientes.length) estado.append(crear("span", `via ${c.via}`, ETIQUETA_VIA[c.via] ?? c.via));
    if (c.deVarios) estado.append(crear("span", "varios", "hoja compartida"));
    if (c.sospechaVarios) estado.append(crear("span", "alerta", "¿varios? falta IA"));
    if (previos.claves.has(claveDe(c.campos))) {
      estado.append(crear("span", "repetido", "ya registrado"));
    } else if (previos.huellas.has(c.huella) && !c.deVarios) {
      estado.append(crear("span", "repetido", "imagen repetida"));
    }

    const p = cruce?.porComprobante.get(i);
    if (p) {
      estado.append(crear("span", `cuadra ${p.como === "numero" ? "" : "flojo"}`,
        p.como === "numero" ? "cuadra" : "cuadra por fecha e importe"));
    } else if (rendicion) {
      estado.append(crear("span", "alerta", "no declarado"));
    }
    if (pendientes.length) {
      // Nombrar hasta dos campos; más de eso no cabe y no ayuda.
      const falta = pendientes.length > 2
        ? `faltan ${pendientes.length} datos`
        : `falta ${pendientes.join(" y ")}`;
      estado.append(crear("span", "pendiente", falta));
    }
  }
  fila.append(estado);

  const quitar = crear("td", "quitar");
  if (c.estado !== "registrado") {
    const x = crear("button", "btn texto", "×");
    x.title = "Descartar esta fila";
    x.onclick = () => {
      // Solo se suelta la imagen si ninguna otra fila la comparte: dos
      // comprobantes de la misma hoja apuntan a la misma miniatura.
      const i = comprobantes.indexOf(c);
      comprobantes.splice(i, 1);
      if (!comprobantes.some((o) => o.huella === c.huella)) URL.revokeObjectURL(c.url);
      recalcularCruce();
      pintar();
    };
    quitar.append(x);
  }
  fila.append(quitar);
  return fila;
}

// --- cuadre --------------------------------------------------------------

function pintarCuadre() {
  const caja = $("#cuadre");
  caja.replaceChildren();
  if (!rendicion) return (caja.hidden = true);
  caja.hidden = false;

  const r = resumen(comprobantes.map((c) => c.campos ?? {}), rendicion.lineas, cruce);

  const cabecera = crear("div", "cabecera-cuadre");
  cabecera.append(crear("h3", "", `Caja ${rendicion.caja || "—"} · ${rendicion.administrador || "—"}`));
  cabecera.append(crear("span", "chico", rendicion.origen ?? ""));
  caja.append(cabecera);

  const cifras = crear("div", "cifras");
  const tarjeta = (valor, etiqueta, tono = "") => {
    const d = crear("div", `cifra ${tono}`);
    d.append(crear("b", "", String(valor)), crear("span", "", etiqueta));
    return d;
  };
  cifras.append(
    tarjeta(`${r.sustentadas}/${r.lineas}`, "líneas sustentadas", r.sinSustento ? "" : "bien"),
    tarjeta(r.sinSustento, "sin comprobante", r.sinSustento ? "mal" : ""),
    tarjeta(r.noDeclarados, "no declarados", r.noDeclarados ? "ojo" : ""),
    tarjeta(r.discrepancias, "importes que no cuadran", r.discrepancias ? "mal" : ""),
    tarjeta(`S/ ${r.totalRendido}`, "rendido"),
  );
  caja.append(cifras);

  if (cruce.sinSustento.length) {
    const det = crear("details");
    det.append(crear("summary", "", `${cruce.sinSustento.length} líneas rendidas sin comprobante`));
    const ul = crear("ul", "lista-cuadre");
    for (const i of cruce.sinSustento) {
      const l = rendicion.lineas[i];
      ul.append(crear("li", "", `${l.fecha} · ${l.numeroCrudo || "sin número"} · ${l.proveedor} · S/ ${l.importe}`));
    }
    det.append(ul);
    caja.append(det);
  }

  if (cruce.discrepancias.length) {
    const det = crear("details");
    det.append(crear("summary", "", `${cruce.discrepancias.length} importes que no cuadran`));
    const ul = crear("ul", "lista-cuadre");
    for (const d of cruce.discrepancias) {
      const l = rendicion.lineas[d.linea];
      ul.append(crear("li", "", `${l.numeroCrudo || claveDe(l)}: rendido S/ ${d.rendido.toFixed(2)} · comprobante S/ ${d.comprobado.toFixed(2)}`));
    }
    det.append(ul);
    caja.append(det);
  }

  const btn = crear("button", "btn sec", `Registrar las ${rendicion.lineas.length} líneas del consolidado`);
  btn.onclick = registrarConsolidado;
  btn.disabled = trabajando;
  caja.append(btn);
}

// --- pintado -------------------------------------------------------------

/**
 * Desglose del lote en cuatro cifras.
 *
 * Es el panel que contesta «¿en qué estoy?» sin leer fila por fila. Importa
 * sobre todo cuando el lote es de veinte o treinta páginas y la tabla ya no
 * cabe en la pantalla.
 */
function pintarResumen() {
  const caja = $("#resumen");
  const vivos = comprobantes.filter((c) => c.estado !== "error");
  if (!vivos.length) { caja.hidden = true; return; }
  caja.hidden = false;

  const registrados = vivos.filter((c) => c.estado === "registrado").length;
  const porCompletar = vivos.filter((c) => c.estado === "listo" && !estaCompleto(c.campos)).length;
  const listos = vivos.filter((c) => c.estado === "listo" && estaCompleto(c.campos)).length;
  const conIA = vivos.filter((c) => c.via === "ia" && !c.deMemoria).length;
  const deMemoria = vivos.filter((c) => c.deMemoria).length;
  const suma = vivos.reduce((t, c) => t + (Number(c.campos?.importe) || 0), 0);

  const tarjeta = (valor, titulo, nota, tono = "") => {
    const d = crear("div", `tarjeta-cifra ${tono}`);
    d.append(crear("span", "rotulo", titulo), crear("b", "", String(valor)), crear("p", "", nota));
    return d;
  };

  caja.replaceChildren(
    tarjeta(vivos.length, "Comprobantes", `S/ ${suma.toFixed(2)} en total`),
    tarjeta(conIA, "Leídos con IA",
            deMemoria ? `${deMemoria} recuperados de lecturas anteriores`
            : conIA ? "el OCR no resolvió estos"
            : !getClaveGemini() ? "sin clave configurada: solo OCR"
            : "los resolvió el OCR, sin cuota",
            !conIA && !getClaveGemini() && porCompletar ? "ojo" : ""),
    tarjeta(porCompletar, "Por completar", porCompletar ? "revisa las celdas en ámbar" : "no falta ningún dato",
            porCompletar ? "ojo" : ""),
    tarjeta(registrados || listos, registrados ? "Registrados" : "Listos para registrar",
            registrados ? "ya están en Drive y en la hoja" : "nada se guarda hasta que lo apruebes",
            registrados ? "bien" : ""),
  );
}

function pintar() {
  $("#filas").replaceChildren(...comprobantes.map(filaDe));
  pintarResumen();
  $("#tabla").hidden = !comprobantes.length;
  $("#vacio").hidden = comprobantes.length > 0;
  pintarCuadre();
  pintarBotones();
}

function pintarBotones() {
  const pendientes = comprobantes.filter((c) => c.estado === "listo");
  const listos = pendientes.filter((c) => estaCompleto(c.campos)).length;
  const incompletos = pendientes.length - listos;

  const btn = $("#registrar");
  btn.disabled = trabajando || !listos;
  btn.textContent = listos ? `Registrar ${listos}` : "Registrar";

  // El pie solo aparece cuando hay algo que decidir: vacío, sería una barra
  // muerta ocupando el sitio donde debería estar la invitación a cargar.
  $("#pie").hidden = !comprobantes.length;
  $("#pieTitulo").textContent = listos
    ? `${listos} comprobante${listos === 1 ? "" : "s"} listo${listos === 1 ? "" : "s"} para registrar`
    : incompletos ? "Faltan datos por completar" : "Nada por registrar todavía";
  $("#pieNota").textContent = incompletos
    ? `${incompletos} fila${incompletos > 1 ? "s" : ""} con celdas en ámbar. Se registran solo las completas.`
    : listos ? "La imagen va a Drive y la fila a la hoja del área."
    : "";
  // Un botón apagado sin motivo parece roto. Si no se puede registrar, el
  // título dice qué falta para poder.
  btn.title = listos ? `Se registrarán ${listos} de ${pendientes.length}`
    : incompletos ? `Completa los campos en ámbar de ${incompletos} fila${incompletos > 1 ? "s" : ""}`
    : "Carga comprobantes primero";

  $("#estadoLote").textContent = pendientes.length
    ? `${listos} listo${listos === 1 ? "" : "s"}${incompletos ? ` · ${incompletos} por completar` : ""}`
    : "";
  $("#limpiar").disabled = trabajando || !comprobantes.length;
}

// --- clave de IA ---------------------------------------------------------

/** Abre el diálogo, opcionalmente diciendo qué lo disparó. */
function abrirClave(motivo = "") {
  $("#campoClave").value = getClaveGemini();
  $("#motivoClave").textContent = motivo;
  $("#motivoClave").hidden = !motivo;
  $("#dlgClave").showModal();
}

function pintarClave() {
  const k = getClaveGemini();
  $("#estadoClave").textContent = k ? enmascarar(k) : "sin configurar";
  // El consolidado no funciona sin clave: decirlo en el propio ítem evita
  // que alguien lo intente y crea que está roto.
  $("#avisoConsolidado").textContent = k ? "cuadre" : "falta clave";
  $("#avisoConsolidado").classList.toggle("falta-clave", !k);
}

// --- arranque ------------------------------------------------------------

function conectarCarga(idBoton, manejador) {
  const entrada = $(idBoton);
  entrada.onchange = (e) => { manejador(e.target.files); e.target.value = ""; };
}

function montar() {
  const proyecto = $("#proyecto");
  // Un valor con arroba es del autocompletado del navegador, no un proyecto.
  // Se descarta al leerlo para que un correo guardado antes no reaparezca.
  const guardado = getProyecto();
  proyecto.value = guardado.includes("@") ? "" : guardado;
  proyecto.onchange = () => {
    const v = proyecto.value.trim();
    if (v.includes("@")) { proyecto.value = ""; return; }
    setProyecto(v);
  };

  $("#entrar").onclick = alEntrar;
  $("#salir").onclick = alSalir;
  $("#registrar").onclick = registrar;
  $("#cancelar").onclick = () => {
    abortador?.abort();
    avisar("Cancelando al terminar la página en curso…", "trabajando");
  };
  $("#limpiar").onclick = () => {
    comprobantes.forEach((c) => URL.revokeObjectURL(c.url));
    comprobantes = [];
    recalcularCruce();
    pintar();
  };

  conectarCarga("#archivos", recibirComprobantes);
  conectarCarga("#camara", recibirComprobantes);
  conectarCarga("#consolidado", recibirConsolidado);

  const zona = $("#zona");
  ["dragenter", "dragover"].forEach((ev) => zona.addEventListener(ev, (e) => {
    e.preventDefault();
    zona.classList.add("encima");
  }));
  ["dragleave", "drop"].forEach((ev) => zona.addEventListener(ev, (e) => {
    e.preventDefault();
    zona.classList.remove("encima");
  }));
  zona.addEventListener("drop", (e) => recibirComprobantes(e.dataTransfer.files));

  $("#btnClave").onclick = () => abrirClave();
  $("#guardarClave").onclick = () => {
    const k = $("#campoClave").value.trim();
    if (k && !pareceClaveGemini(k)) {
      return avisar("Esa no parece una clave de Gemini: deben empezar con «AIza».", "malo");
    }
    setClaveGemini(k);
    pintarClave();
    $("#dlgClave").close();
    avisar("Clave guardada en este navegador.", "bueno");
  };
  $("#probarClave").onclick = async () => {
    const k = $("#campoClave").value.trim();
    if (!k) return avisar("Pega una clave primero.", "malo");
    try {
      avisar("Probando la clave…", "trabajando");
      await probarClave(k);
      avisar("La clave funciona.", "bueno");
    } catch (e) {
      avisar(e.message, "malo");
    }
  };
  $("#borrarClave").onclick = () => {
    borrarClaveGemini();
    pintarClave();
    $("#dlgClave").close();
  };

  // Cerrar la pestaña con un lote a medias pierde el trabajo: lo cargado vive
  // en memoria y las imágenes nunca llegaron a Drive.
  window.addEventListener("beforeunload", (e) => {
    if (comprobantes.some((c) => c.estado !== "registrado")) e.preventDefault();
  });

  // Adónde va a parar lo que se registra. Estaba a un par de clics en Drive
  // y en la práctica nadie lo encontraba.
  $("#verCarpeta").href = `https://drive.google.com/drive/folders/${CARPETA_RAIZ}`;
  $("#verHoja").href = `https://docs.google.com/spreadsheets/d/${HOJA}/edit`;

  $("#btnAyuda").onclick = () => $("#dlgAyuda").showModal();

  pintarClave();
  pintar();
}

montar();
