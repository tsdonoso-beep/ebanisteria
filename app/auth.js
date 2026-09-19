// Identidad y token, con Google Identity Services.
//
// La aplicación actúa como la persona que entra, no como una cuenta de
// servicio. Eso deja dos cosas resueltas de una vez: no hay clave privada que
// custodiar en un sitio estático, y cada archivo queda con el rastro de quién
// lo subió.

import { CLIENT_ID } from "./config.js";

const ALCANCES = [
  // Solo los archivos que esta aplicación crea. Nunca el Drive completo.
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/spreadsheets",
  "openid", "email",
].join(" ");

let token = null;
let expira = 0;
let correo = null;
let clienteToken = null;

export const sesion = () => (correo ? { correo } : null);

/** Margen para no usar un token que vence mientras se sube un lote largo. */
const MARGEN_MS = 60_000;

function inicializar() {
  if (clienteToken) return;
  if (!window.google?.accounts?.oauth2) {
    throw new Error("La librería de Google no cargó. Revisa la conexión.");
  }
  clienteToken = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: ALCANCES,
    // Sugerencia para la pantalla de Google, no un control de acceso: una
    // aplicación estática no puede imponerlo. Lo que restringe de verdad es
    // la pantalla de consentimiento en modo Internal.
    hd: "inroprin.com",
    callback: () => {},
  });
}

/** Pide un token nuevo. `prompt` vacío reaprovecha el consentimiento dado. */
function pedirToken(prompt = "") {
  return new Promise((resolve, reject) => {
    inicializar();
    clienteToken.callback = (resp) => {
      if (resp.error) return reject(new Error(resp.error_description || resp.error));
      token = resp.access_token;
      expira = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
      resolve(token);
    };
    clienteToken.requestAccessToken({ prompt });
  });
}

export async function entrar() {
  await pedirToken("");
  const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error("No se pudo leer el perfil de la cuenta.");

  const { email } = await r.json();
  correo = email;
  return { correo, delDominio: email.endsWith("@inroprin.com") };
}

export function salir() {
  if (token) google.accounts.oauth2.revoke(token, () => {});
  token = null;
  expira = 0;
  correo = null;
}

/**
 * El token de acceso dura una hora. Registrar un lote grande puede cruzar ese
 * límite a media subida, así que se renueva solo antes de vencer en vez de
 * fallarle a la persona con medio lote adentro.
 */
export async function tokenVigente() {
  if (!correo) throw new Error("No hay sesión iniciada.");
  if (!token || Date.now() > expira - MARGEN_MS) await pedirToken("");
  return token;
}

/** Cabeceras de autorización para las llamadas a las APIs de Google. */
export async function cabeceras(extra = {}) {
  return { Authorization: `Bearer ${await tokenVigente()}`, ...extra };
}

/** Saca el motivo real del cuerpo del error; el código HTTP solo no basta. */
export async function motivo(r) {
  const cuerpo = await r.text();
  try {
    return JSON.parse(cuerpo).error?.message ?? cuerpo.slice(0, 300);
  } catch {
    return cuerpo.slice(0, 300);
  }
}
