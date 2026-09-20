// Comprobaciones de las trampas que ya mordieron una vez.
//
// Cada una nació de un fallo real que llegó a producción. No sustituyen mirar
// la pantalla, pero atrapan la recaída barata.
//
//   node comprobaciones.mjs

import { readFileSync } from "node:fs";

const raiz = new URL(".", import.meta.url).pathname;
const css = readFileSync(raiz + "estilos.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const html = readFileSync(raiz + "index.html", "utf8");
const js = readFileSync(raiz + "app/main.js", "utf8");

const reglas = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
  .map((m) => ({ sel: m[1].trim(), cuerpo: m[2] }))
  .filter((r) => r.sel && !r.sel.startsWith("@"));

/**
 * El elemento al que apunta un selector es su último compuesto, no cualquiera
 * que aparezca. `td.mini img` apunta a la imagen, no a la celda: confundirlos
 * hacía que la comprobación gritara por reglas correctas.
 */
const apuntaA = (sel, tipo) =>
  sel.split(",").map((s) => s.trim().split(/[\s>+~]+/).pop())
     .some((sujeto) => new RegExp(`^${tipo}([.#:\\[]|$)`).test(sujeto));

let fallos = 0;
const check = (ok, bien, mal) => {
  console.log(ok ? "  ✓ " + bien : "  ✗ " + mal);
  if (!ok) fallos++;
};

console.log("\nEstructura");

// Un th o td en block deja de ser celda y las columnas se apilan en escalera.
const celdas = reglas.filter((r) =>
  (apuntaA(r.sel, "th") || apuntaA(r.sel, "td")) &&
  /display:\s*(block|flex|grid|inline)/.test(r.cuerpo));
check(!celdas.length, "ningún th/td con display de bloque",
      "rompe la tabla: " + celdas.map((r) => r.sel).join(" | "));

// El [hidden] del navegador pierde contra cualquier display de autor.
check(/\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(css),
      "la regla global [hidden] sigue puesta",
      "sin [hidden] !important, lo oculto se muestra igual");

console.log("\nBotones");

// Colgar el estilo del tipo lo derrama sobre todo <button>.
const porTipo = reglas.filter((r) => apuntaA(r.sel, "button"));
check(!porTipo.length, "ninguna regla cuelga del elemento button",
      "estilo derramado: " + porTipo.map((r) => r.sel).join(" | "));

const sinClase = [...html.matchAll(/<button([^>]*)>/g)]
  .map((m) => (m[1].match(/class="([^"]+)"/) || [])[1] || "")
  .filter((c) => !/\b(btn|nav-item|llave)\b/.test(c));
check(!sinClase.length, "todo <button> declara qué es",
      `${sinClase.length} botones sin clase`);

const dinamicos = [...js.matchAll(/crear\("button",\s*"([^"]*)"/g)].map((m) => m[1]);
check(dinamicos.every((c) => /\b(btn|nav-item)\b/.test(c)),
      "los botones que crea el código también",
      "creados sin clase: " + dinamicos.filter((c) => !c.includes("btn")));

console.log("\nDetalles que se deforman");

const pildora = reglas.find((r) => r.sel === "td.estado span");
check(pildora && /white-space:\s*nowrap/.test(pildora.cuerpo),
      "los distintivos no se parten en dos líneas",
      "una píldora partida con radio de 99px queda como un globo");

console.log("\nCableado");

const ids = [...new Set([...js.matchAll(/\$\("#([\w-]+)"\)/g)].map((m) => m[1]))];
const faltan = ids.filter((i) => !html.includes(`id="${i}"`));
check(!faltan.length, `los ${ids.length} ids que busca el código existen`,
      "ids que faltan: " + faltan);

console.log(fallos ? `\n${fallos} fallo${fallos > 1 ? "s" : ""}\n` : "\nTodo en orden\n");
process.exit(fallos ? 1 : 0);
