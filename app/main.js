// Orquestación e interfaz.
//
// El registro nunca es automático. Se lee, se muestra en una tabla editable, y
// registrar es un botón que aprieta una persona. Contabilidad confía en lo que
// revisó, no en lo que apareció solo.

import {
  PESTANA_REGISTRO, PESTANA_CONSOLIDADO, HEREDABLES, CARPETA_RAIZ, HOJA,
  getClaveGemini, setClaveGemini, borrarClaveGemini, pareceClaveGemini, enmascarar,
  getProyecto, setProyecto,
  INTENCIONES, PROCESOS, getModo, setModo, esPropia,
  TIPOS, NO_CUENTAN_POR_DEFECTO, etiquetaTipo,
} from "./config.js";
import { CABECERA_VACIA, calcular, faltaParaCerrar } from "./rendicion.js";
import { generar } from "./hoja-rendicion.js";
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
import * as rendidor from "./rendidor.js";

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
/** Qué vino a hacer la persona y sobre qué proceso. */
let modo = null;
/** Lo elegido en la pantalla de elección, antes de confirmarlo. */
let eligiendo = { intencion: null, proceso: "caja" };
/** Cabecera de la rendición en curso, solo en modo digitalizar. */
let cabecera = CABECERA_VACIA();
/** Tipos que no suman al sustento. Se ajusta desde la interfaz. */
let noCuentan = [...NO_CUENTAN_POR_DEFECTO];

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
  // Se crea acá y no en cada flujo para que «Cancelar» sirva en todos ellos,
  // incluido el del rendidor, que vive en otro módulo.
  if (v) abortador ??= new AbortController();
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
/** Abandonar un lote largo sin recargar. Lo ya leído se conserva. */
function cancelarLote() {
  abortador?.abort();
  avisar("Cancelando al terminar la página en curso…", "trabajando");
}

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

    avisar(delDominio ? "" : "Entraste con una cuenta de otro dominio.", delDominio ? "" : "malo");

    const recordado = getModo();
    if (recordado) aplicarModo(recordado);
    else { eligiendo = { intencion: null, proceso: "caja" }; volverAElegir(); }
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

/**
 * Deja lista la hoja del área, y solo cuando hace falta.
 *
 * Antes se hacía siempre al entrar. Pero quien viene a rendir sus propios
 * gastos puede no tener acceso a esa hoja —no es suya y no tiene por qué—, y
 * un error de permisos nada más entrar lo dejaba fuera de una herramienta que
 * sí podía usar. Ahora se prepara al elegir un modo del área.
 */
let registroListo = false;

async function asegurarRegistro() {
  if (registroListo) return;
  avisar("Preparando la hoja de registro…", "trabajando");
  await preparar();
  previos = await yaRegistrado();
  registroListo = true;
  avisar("");
}

// --- elegir el trabajo ---------------------------------------------------

/**
 * Un icono por intención.
 *
 * Tres tarjetas de texto obligan a leerlas enteras para distinguirlas. Con
 * un icono la elección se hace de un vistazo y el texto pasa a confirmar, que
 * es el orden natural: primero se reconoce, después se lee.
 */
const ICONOS = {
  // Marca de revisión dentro de un marco: algo que ya existe y se comprueba.
  revalidar: ["M9 11.5l2.5 2.5L18 7.5", "M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"],
  // Las cuatro esquinas de un escáner: algo que todavía no existe y se crea.
  digitalizar: ["M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8", "M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8",
                "M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16", "M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16",
                "M4 12h16"],
  // Un teléfono con cámara: dónde ocurre y con qué.
  rendir: ["M7 2.5h10a1.5 1.5 0 0 1 1.5 1.5v16a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 20V4A1.5 1.5 0 0 1 7 2.5Z",
           "M10.5 19h3"],
};

const icono = (id) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const d of ICONOS[id] ?? []) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  if (id === "rendir") {
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", "12"); c.setAttribute("cy", "10.5"); c.setAttribute("r", "2.6");
    svg.append(c);
  }
  return svg;
};

/**
 * Se pregunta antes de mostrar nada más.
 *
 * Revalidar y digitalizar comparten motor pero son trabajos distintos: uno
 * audita un documento ya cerrado, el otro lo construye. Sin saber a cuál vino
 * la persona, la pantalla tendría que ofrecer ambos caminos a la vez y ninguno
 * quedaría claro.
 */
function pintarEleccion() {
  const caja = $("#intenciones");
  caja.replaceChildren(...INTENCIONES.map((i) => {
    const b = crear("button", "intencion");
    b.type = "button";
    b.setAttribute("aria-pressed", String(eligiendo.intencion === i.id));
    const cabeza = crear("span", "cabeza-intencion");
    cabeza.append(icono(i.id), crear("span", "rotulo", i.area));
    // Dónde termina guardado es la diferencia de fondo entre las tres, y la
    // que decide si hace falta permiso sobre la unidad del área. Decirlo en
    // la tarjeta evita elegir mal y descubrirlo al final.
    const destino = crear("span", "destino",
      esPropia(i.id) ? "Queda en tu propio Drive" : "Queda en la unidad del área");

    b.append(
      cabeza,
      crear("b", "", i.titulo),
      crear("p", "", i.descripcion),
      destino,
    );
    b.onclick = () => { eligiendo.intencion = i.id; pintarEleccion(); };
    return b;
  }));

  $("#procesos").replaceChildren(...PROCESOS.map((p) => {
    const b = crear("button", "opcion", p.titulo);
    b.type = "button";
    b.setAttribute("aria-pressed", String(eligiendo.proceso === p.id));
    b.onclick = () => { eligiendo.proceso = p.id; pintarEleccion(); };
    return b;
  }));

  // El proceso se pregunta después, y no antes: sin saber a qué vino, «caja
  // chica o memo» es una pregunta sin contexto. Aparece cuando ya hay
  // intención elegida, que es cuando empieza a significar algo.
  $("#procesos").closest(".procesos").hidden = !eligiendo.intencion;
  $("#confirmarModo").disabled = !eligiendo.intencion;
}

async function aplicarModo(nuevo) {
  modo = nuevo;
  setModo(nuevo);

  const i = INTENCIONES.find((x) => x.id === nuevo.intencion);
  const p = PROCESOS.find((x) => x.id === nuevo.proceso);
  const propia = esPropia(nuevo.intencion);

  $("#modoActivo").hidden = false;
  $("#modoTitulo").textContent = i.titulo;
  $("#modoProceso").textContent = `${i.area} · ${p.titulo}`;

  // La lateral decía «Contabilidad» aunque el modo fuera el del rendidor. Un
  // rótulo fijo que contradice lo que hay en pantalla es peor que no tenerlo.
  $("#ambito").textContent = i.area;
  document.title = `InroScan · ${i.titulo}`;

  // La lateral cambia de contenido, no solo de estado: al rendidor no se le
  // ofrece la unidad compartida ni la hoja del área, que no son suyas.
  $("#navArea").hidden = propia;
  $("#navMio").hidden = !propia;
  $("#recorrido").hidden = propia;
  $("#recorridoMio").hidden = !propia;

  // El área de trabajo se adapta a lo que se vino a hacer.
  $("#h1Trabajo").textContent = propia ? "Mi rendición"
    : nuevo.intencion === "revalidar" ? "Revalidar la rendición"
    : "Digitalizar comprobantes";
  $("#subTrabajo").textContent = propia
    ? "Fotografía, revisa y guárdala en tu propio Drive."
    : nuevo.intencion === "revalidar"
    ? `Se cruza el ${p.cabecera} contra los comprobantes escaneados.`
    : "Se leen, se revisan, y la herramienta arma el documento.";

  $("#eleccion").hidden = true;

  if (propia) {
    $("#zona").hidden = true;
    $("#pie").hidden = true;
    $("#rendidor").hidden = false;
    rendidor.abrir();
    return;
  }

  $("#rendidor").hidden = true;

  $("#nombreCabecera").textContent = p.cabecera === "memo" ? "Memo" : "Consolidado";
  // Cada rendición empieza limpia: los datos de una no deben colarse en otra.
  cabecera = CABECERA_VACIA();
  noCuentan = [...NO_CUENTAN_POR_DEFECTO];
  $("#camposCabecera").replaceChildren();

  $("#zona").hidden = false;
  pintar();

  // El acceso a la hoja del área se comprueba acá, con el modo ya puesto: si
  // falla, el aviso dice qué modo no se puede usar en vez de un error suelto.
  try {
    await asegurarRegistro();
  } catch (e) {
    avisar(`No se pudo abrir la hoja del área: ${e.message}`, "malo");
  }
}

/**
 * Vuelve a la elección, y devuelve la cáscara a neutro.
 *
 * Antes solo cambiaba el centro: la pantalla preguntaba «¿qué vas a hacer?»
 * mientras el encabezado ya afirmaba «Mi rendición» y la lateral ofrecía
 * «Empezar de nuevo» sobre algo que aún no había empezado. Tres sitios
 * respondiendo cosas distintas a la vez.
 */
function volverAElegir() {
  eligiendo = { ...modo };
  $("#eleccion").hidden = false;
  $("#zona").hidden = true;
  $("#rendidor").hidden = true;
  $("#pie").hidden = true;
  $("#modoActivo").hidden = true;
  $("#navArea").hidden = true;
  $("#navMio").hidden = true;
  $("#h1Trabajo").textContent = "InroScan";
  $("#subTrabajo").textContent = "Elige a qué viniste: la herramienta cambia según eso.";
  $("#ambito").textContent = "Comprobantes";
  $("#estadoLote").textContent = "";
  document.title = "InroScan";
  pintarEleccion();
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

// --- rendición (modo digitalizar) ---------------------------------------

const CAMPOS_CABECERA = [
  ["memo", "Memorándum N°", true],
  ["fechaRendicion", "Fecha de rendición", true],
  ["montoRecibido", "Monto recibido S/", true],
  ["proyecto", "Proyecto", false],
  ["nombres", "Nombres", false],
  ["apellidos", "Apellidos", false],
  ["dni", "DNI", true],
  ["origenDestino", "Origen y destino", false],
  ["periodoDesde", "Viaje desde", true],
  ["periodoHasta", "Viaje hasta", true],
];

function pintarCabecera() {
  const caja = $("#cabecera");
  const enRendicion = modo?.intencion === "digitalizar";
  caja.hidden = !enRendicion;
  if (!enRendicion) return;

  const pendientes = faltaParaCerrar(cabecera, comprobantes);
  const campos = $("#camposCabecera");
  if (campos.childElementCount) return;   // no se repinta al teclear

  campos.replaceChildren(...CAMPOS_CABECERA.map(([clave, etiqueta, duro]) => {
    const d = crear("div", "campo");
    const l = crear("label", "", etiqueta);
    l.htmlFor = `cab-${clave}`;
    const i = crear("input", duro ? "duro" : "");
    i.id = `cab-${clave}`;
    i.value = cabecera[clave] ?? "";
    i.autocomplete = "off";
    if (clave.startsWith("periodo") || clave === "fechaRendicion") i.type = "date";
    i.oninput = () => { cabecera[clave] = i.value; pintarRendicion(); pintarBotones(); };
    d.append(l, i);
    return d;
  }));
  void pendientes;
}

/**
 * El panel de la rendición, con los conmutadores de qué sustenta.
 *
 * La regla de qué cuenta se muestra y se toca acá en vez de vivir escondida en
 * el código: es el criterio del que sale el porcentaje, y quien lo revisa
 * tiene derecho a verlo y a discutirlo.
 */
function pintarRendicion() {
  const caja = $("#panelRendicion");
  const enRendicion = modo?.intencion === "digitalizar";
  if (!enRendicion || !comprobantes.length) { caja.hidden = true; return; }
  caja.hidden = false;

  const listos = comprobantes.filter((c) => c.estado !== "error" && c.campos);
  const r = calcular(listos, cabecera, noCuentan);
  caja.replaceChildren();

  const cab = crear("div", "cabecera-cuadre");
  cab.append(crear("h3", "", `Rendición ${cabecera.memo || "sin número"}`));
  cab.append(crear("span", "chico",
    [cabecera.nombres, cabecera.apellidos].filter(Boolean).join(" ") || "sin nombre"));
  caja.append(cab);

  const cifras = crear("div", "cifras");
  const tarjeta = (valor, etiqueta, tono = "") => {
    const d = crear("div", `cifra ${tono}`);
    d.append(crear("b", "", valor), crear("span", "", etiqueta));
    return d;
  };
  cifras.append(
    tarjeta(`S/ ${r.recibido}`, "recibido"),
    tarjeta(`S/ ${r.sustentado}`, "monto rendido", "bien"),
    tarjeta(r.porcentaje === null ? "—" : `${r.porcentaje}%`, "rendido",
            r.porcentaje !== null && r.porcentaje < 100 ? "ojo" : ""),
    tarjeta(`S/ ${Math.abs(Number(r.saldo)).toFixed(2)}`,
            r.reembolsa ? "a reembolsar" : r.devuelve ? "por devolver" : "saldo",
            r.reembolsa ? "mal" : ""),
  );
  caja.append(cifras);

  caja.append(crear("p", "rotulo", "Qué sustenta"));
  const tipos = crear("div", "tipos");
  for (const t of r.porTipo) {
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
      pintarRendicion();
    };
    tipos.append(b);
  }
  caja.append(tipos);

  const falta = faltaParaCerrar(cabecera, listos);
  const btn = crear("button", "btn", "Generar la rendición en Sheets");
  btn.type = "button";
  btn.disabled = trabajando || falta.length > 0;
  btn.title = falta.length ? `Falta ${falta.join(", ")}` : "Crea la hoja en la carpeta del día";
  btn.onclick = generarRendicion;
  caja.append(btn);

  if (falta.length) {
    caja.append(crear("p", "chico", `Para cerrarla falta ${falta.join(", ")}.`));
  }
}

async function generarRendicion() {
  const listos = comprobantes.filter((c) => c.estado !== "error" && c.campos);
  ocupado(true);
  try {
    const idCarpeta = await carpetaDelDia();

    // Las imágenes suben antes que la hoja: una rendición sin los papeles
    // detrás no sustenta nada, y así cada fila puede enlazar al suyo.
    const enlaces = {};
    const subidos = new Map();
    for (const [i, c] of listos.entries()) {
      avisar(`Subiendo el sustento ${i + 1} de ${listos.length}…`, "trabajando");
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

    avisar("Creando la hoja de la rendición…", "trabajando");
    const hecho = await generar({ cabecera, comprobantes: listos, noCuentan, idCarpeta, enlaces });

    avisar(`Rendición creada: ${hecho.nombre}`, "bueno");
    // Se abre sola: el trabajo termina en esa hoja, no en esta pantalla.
    window.open(hecho.webViewLink, "_blank", "noopener");
  } catch (e) {
    avisar(e.message, "malo");
  } finally {
    ocupado(false);
    pintar();
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
  pintarCabecera();
  pintarRendicion();
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
  $("#pie").hidden = !comprobantes.length || esPropia(modo?.intencion);
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
  $("#cancelar").onclick = cancelarLote;
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
    if (comprobantes.some((c) => c.estado !== "registrado") ||
        rendidor.hayPendiente()) e.preventDefault();
  });

  // Adónde va a parar lo que se registra. Estaba a un par de clics en Drive
  // y en la práctica nadie lo encontraba.
  $("#verCarpeta").href = `https://drive.google.com/drive/folders/${CARPETA_RAIZ}`;
  $("#verHoja").href = `https://docs.google.com/spreadsheets/d/${HOJA}/edit`;

  // El rendidor vive en su propio módulo y recibe de acá lo compartido:
  // avisos, el estado de ocupado y el diálogo de la clave. Así no duplica la
  // barra de progreso ni se entera de cómo funciona esta pantalla.
  rendidor.montar({
    avisar,
    ocupado,
    ocupadoAhora,
    progreso,
    abrirClave,
    señal: () => abortador?.signal,
    cancelar: cancelarLote,
  });

  $("#btnAyuda").onclick = () => $("#dlgAyuda").showModal();
  $("#modoActivo").onclick = volverAElegir;
  $("#confirmarModo").onclick = () => aplicarModo({ ...eligiendo });

  pintarClave();
  pintar();
}

montar();
