// Orquestación e interfaz.
//
// El registro nunca es automático. Se lee, se muestra en una tabla editable, y
// registrar es un botón que aprieta una persona. Contabilidad confía en lo que
// revisó, no en lo que apareció solo.

import {
  CENTROS_COSTO, PESTANA_REGISTRO,
  getClaveGemini, setClaveGemini, borrarClaveGemini, pareceClaveGemini, enmascarar,
  getCentro, setCentro,
} from "./config.js";
import { entrar, salir, sesion } from "./auth.js";
import { preparar, agregar, huellasRegistradas } from "./sheets.js";
import { carpetaDelDia, subir, fechaCarpeta } from "./drive.js";
import { aPaginas } from "./paginas.js";
import { leer, probarClave } from "./lectura.js";
import { estaCompleto, faltantes } from "./campos.js";

const $ = (s) => document.querySelector(s);
const crear = (tag, clase, texto) => {
  const e = document.createElement(tag);
  if (clase) e.className = clase;
  if (texto != null) e.textContent = texto;
  return e;
};

/** Todo lo cargado en esta sesión, en orden de llegada. */
let comprobantes = [];
let huellasPrevias = new Set();
let trabajando = false;

// --- avisos --------------------------------------------------------------

let temporizador = null;

function avisar(texto, tono = "") {
  const caja = $("#aviso");
  caja.textContent = texto;
  caja.className = `aviso ${tono} ${texto ? "visible" : ""}`;
  clearTimeout(temporizador);
  if (texto && tono !== "trabajando") {
    temporizador = setTimeout(() => avisar(""), 6000);
  }
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
    huellasPrevias = await huellasRegistradas();

    avisar(delDominio ? "" : "Entraste con una cuenta de otro dominio.", delDominio ? "" : "malo");
    renderizar();
  } catch (e) {
    avisar(e.message, "malo");
  }
}

function alSalir() {
  salir();
  comprobantes = [];
  document.body.classList.remove("dentro");
  $("#quien").textContent = "";
  renderizar();
}

// --- carga ---------------------------------------------------------------

async function recibir(archivos) {
  const lista = [...archivos];
  if (!lista.length || trabajando) return;

  if (!$("#centro").value) {
    avisar("Elige el centro de costo antes de cargar.", "malo");
    return;
  }

  trabajando = true;
  actualizarBotones();

  try {
    avisar("Preparando las páginas…", "trabajando");
    const paginas = await aPaginas(lista, (t) => avisar(t, "trabajando"));

    if (!paginas.length) {
      avisar("No había imágenes ni PDF en lo que cargaste.", "malo");
      return;
    }

    for (const p of paginas) {
      comprobantes.push({
        ...p,
        centro: $("#centro").value,
        campos: null,
        via: "",
        estado: "leyendo",
        repetido: huellasPrevias.has(p.huella),
      });
    }
    renderizar();

    // En serie y no en paralelo: el OCR satura el hilo del navegador y
    // lanzarlo todo junto vuelve la pestaña inmanejable sin terminar antes.
    for (const c of comprobantes.filter((c) => c.estado === "leyendo")) {
      const cual = `${c.origen}${c.totalPaginas > 1 ? ` · pág. ${c.pagina}` : ""}`;
      try {
        avisar(`Leyendo ${cual}…`, "trabajando");
        const { campos, via } = await leer(c, (t) => avisar(`${cual} — ${t}`, "trabajando"));
        Object.assign(c, { campos, via, estado: "listo" });
      } catch (e) {
        Object.assign(c, { campos: c.campos, estado: "error", error: e.message });
      }
      renderizar();
    }
    avisar("");
  } catch (e) {
    avisar(e.message, "malo");
  } finally {
    trabajando = false;
    actualizarBotones();
    renderizar();
  }
}

// --- registro ------------------------------------------------------------

async function registrar() {
  const listos = comprobantes.filter((c) => c.estado === "listo" && estaCompleto(c.campos));
  if (!listos.length) {
    avisar("No hay comprobantes completos para registrar.", "malo");
    return;
  }

  trabajando = true;
  actualizarBotones();

  try {
    const carpeta = await carpetaDelDia();
    const filas = [];
    const registrados = [];

    for (const [i, c] of listos.entries()) {
      avisar(`Subiendo ${i + 1} de ${listos.length}…`, "trabajando");

      const nombre = [
        c.campos.fechaEmision || fechaCarpeta(),
        c.campos.ruc || "sin-ruc",
        [c.campos.serie, c.campos.numero].filter(Boolean).join("-") || c.huella.slice(0, 8),
      ].join("_") + ".jpg";

      const archivo = await subir(c.blob, nombre, carpeta);

      filas.push([
        new Date().toISOString(), c.centro,
        c.campos.tipo, c.campos.serie, c.campos.numero, c.campos.fechaEmision,
        c.campos.ruc, c.campos.proveedor, c.campos.moneda,
        c.campos.subtotal, c.campos.igv, c.campos.total,
        archivo.webViewLink, c.origen, c.pagina, c.via, c.huella,
        sesion()?.correo ?? "",
      ]);
      c.enlace = archivo.webViewLink;
      registrados.push(c);
    }

    // Las filas van en una sola llamada: si se cortara a mitad, es preferible
    // que no quede ninguna anotada a que queden la mitad y nadie sepa cuáles.
    await agregar(PESTANA_REGISTRO, filas);

    registrados.forEach((c) => {
      c.estado = "registrado";
      huellasPrevias.add(c.huella);
    });
    avisar(`${filas.length} comprobante${filas.length > 1 ? "s" : ""} registrado${filas.length > 1 ? "s" : ""}.`, "bueno");
  } catch (e) {
    avisar(e.message, "malo");
  } finally {
    trabajando = false;
    actualizarBotones();
    renderizar();
  }
}

// --- interfaz ------------------------------------------------------------

const CAMPOS_TABLA = [
  ["tipo", "Tipo"], ["serie", "Serie"], ["numero", "Número"],
  ["fechaEmision", "F. emisión"], ["ruc", "RUC"], ["proveedor", "Proveedor"],
  ["moneda", "Mon."], ["subtotal", "Subtotal"], ["igv", "IGV"], ["total", "Total"],
];

const ETIQUETA_VIA = { ocr: "OCR", ia: "IA", parcial: "incompleto" };

function filaDe(c) {
  const fila = crear("tr", c.estado === "registrado" ? "registrada" : "");

  const celdaImg = crear("td", "mini");
  const img = crear("img");
  img.src = c.url;
  img.alt = c.origen;
  img.onclick = () => window.open(c.url, "_blank");
  celdaImg.append(img);
  if (c.totalPaginas > 1) celdaImg.append(crear("span", "pag", `pág. ${c.pagina}`));
  fila.append(celdaImg);

  if (c.estado === "leyendo") {
    const td = crear("td", "leyendo", "Leyendo…");
    td.colSpan = CAMPOS_TABLA.length + 1;
    fila.append(td);
    return fila;
  }

  if (c.estado === "error") {
    const td = crear("td", "malo", c.error);
    td.colSpan = CAMPOS_TABLA.length + 1;
    fila.append(td);
    return fila;
  }

  const pendientes = faltantes(c.campos);

  for (const [clave, _] of CAMPOS_TABLA) {
    const td = crear("td");
    const entrada = crear("input");
    entrada.value = c.campos[clave] ?? "";
    entrada.disabled = c.estado === "registrado";
    // Amarillo lo que hay que revisar: es el código de color de IMPOPRINT,
    // que el equipo ya asocia con «acá falta algo».
    if (pendientes.includes(clave)) entrada.classList.add("falta");
    entrada.oninput = () => {
      c.campos[clave] = entrada.value;
      if (c.via !== "manual") c.via = "manual";
      actualizarBotones();
      entrada.classList.toggle("falta", faltantes(c.campos).includes(clave));
    };
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
    estado.append(crear("span", `via ${c.via}`, ETIQUETA_VIA[c.via] ?? c.via));
    if (c.repetido) estado.append(crear("span", "repetido", "ya registrado antes"));
    if (pendientes.length) estado.append(crear("span", "pendiente", "falta completar"));
  }
  fila.append(estado);

  return fila;
}

function renderizar() {
  const cuerpo = $("#filas");
  cuerpo.replaceChildren(...comprobantes.map(filaDe));
  $("#tabla").classList.toggle("vacia", !comprobantes.length);
  $("#vacio").hidden = comprobantes.length > 0;
  actualizarBotones();
}

function actualizarBotones() {
  const listos = comprobantes.filter((c) => c.estado === "listo" && estaCompleto(c.campos)).length;
  const btn = $("#registrar");
  btn.disabled = trabajando || !listos;
  btn.textContent = listos ? `Registrar ${listos}` : "Registrar";
  $("#limpiar").disabled = trabajando || !comprobantes.length;
  $("#centro").disabled = trabajando;
}

// --- clave de IA ---------------------------------------------------------

function pintarClave() {
  const k = getClaveGemini();
  $("#estadoClave").textContent = k ? enmascarar(k) : "sin configurar";
  $("#estadoClave").classList.toggle("puesta", Boolean(k));
}

function abrirClave() {
  $("#dlgClave").showModal();
  $("#campoClave").value = getClaveGemini();
}

async function guardarClave() {
  const k = $("#campoClave").value.trim();
  if (k && !pareceClaveGemini(k)) {
    avisar("Esa no parece una clave de Gemini: deben empezar con «AIza».", "malo");
    return;
  }
  setClaveGemini(k);
  pintarClave();
  $("#dlgClave").close();
  avisar("Clave guardada en este navegador.", "bueno");
}

async function verificarClave() {
  const k = $("#campoClave").value.trim();
  if (!k) return avisar("Pega una clave primero.", "malo");
  try {
    avisar("Probando la clave…", "trabajando");
    await probarClave(k);
    avisar("La clave funciona.", "bueno");
  } catch (e) {
    avisar(e.message, "malo");
  }
}

// --- arranque ------------------------------------------------------------

function montar() {
  const centro = $("#centro");
  centro.append(...[
    Object.assign(document.createElement("option"), { value: "", textContent: "Centro de costo…" }),
    ...CENTROS_COSTO.map((c) => Object.assign(document.createElement("option"), { value: c, textContent: c })),
  ]);
  centro.value = getCentro();
  centro.onchange = () => setCentro(centro.value);

  $("#entrar").onclick = alEntrar;
  $("#salir").onclick = alSalir;
  $("#registrar").onclick = registrar;
  $("#limpiar").onclick = () => {
    comprobantes.forEach((c) => URL.revokeObjectURL(c.url));
    comprobantes = [];
    renderizar();
  };

  $("#archivos").onchange = (e) => { recibir(e.target.files); e.target.value = ""; };
  $("#camara").onchange = (e) => { recibir(e.target.files); e.target.value = ""; };

  const zona = $("#zona");
  ["dragenter", "dragover"].forEach((ev) => zona.addEventListener(ev, (e) => {
    e.preventDefault();
    zona.classList.add("encima");
  }));
  ["dragleave", "drop"].forEach((ev) => zona.addEventListener(ev, (e) => {
    e.preventDefault();
    zona.classList.remove("encima");
  }));
  zona.addEventListener("drop", (e) => recibir(e.dataTransfer.files));

  $("#btnClave").onclick = abrirClave;
  $("#guardarClave").onclick = guardarClave;
  $("#probarClave").onclick = verificarClave;
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

  pintarClave();
  renderizar();
}

montar();
