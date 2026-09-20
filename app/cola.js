// Plazos, ritmo y cancelación.
//
// Un lote largo falla de tres maneras distintas, y las tres se ven igual desde
// fuera —la pantalla quieta—, así que las tres se atienden acá.

/** Se lanza cuando la persona cancela; no es un error que haya que reportar. */
export class Cancelado extends Error {
  constructor() { super("Cancelado"); this.name = "Cancelado"; }
}

/**
 * Le pone plazo a una promesa.
 *
 * Sin esto, un trabajador de Tesseract que se queda sin memoria deja la
 * promesa colgada para siempre y el lote entero se congela sin un solo error
 * en consola. Es la forma más difícil de diagnosticar: no parece un fallo,
 * parece lentitud.
 */
export function conPlazo(promesa, ms, queHacia) {
  let reloj;
  const plazo = new Promise((_, rechazar) => {
    reloj = setTimeout(() => rechazar(new Error(`${queHacia} tardó más de ${Math.round(ms / 1000)} s.`)), ms);
  });
  return Promise.race([promesa, plazo]).finally(() => clearTimeout(reloj));
}

export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Serializa las llamadas a la IA y les impone un ritmo mínimo.
 *
 * El plan gratuito de Gemini limita las peticiones por minuto, y un PDF de
 * doce páginas las dispara todas seguidas en cuanto el OCR va terminando. Se
 * agota la cuota a la mitad del lote y el resto falla en cascada.
 *
 * El intervalo no es fijo: cuando Google responde 429 se ensancha, y se va
 * estrechando solo tras varias respuestas buenas. Así un lote grande se
 * autorregula sin obligar a nadie a configurar nada.
 */
export class Ritmo {
  constructor({ minimo = 4500, maximo = 45000 } = {}) {
    this.minimo = minimo;
    this.maximo = maximo;
    this.intervalo = minimo;
    this.ultima = 0;
    this.cola = Promise.resolve();
    this.buenasSeguidas = 0;
  }

  /** Corre `tarea` respetando el turno y el intervalo vigente. */
  turno(tarea) {
    const mio = this.cola.then(async () => {
      const falta = this.intervalo - (Date.now() - this.ultima);
      if (falta > 0) await esperar(falta);
      this.ultima = Date.now();
      return tarea();
    });
    // La cola no debe romperse porque una tarea falle: quien espera detrás
    // tiene derecho a su turno igual.
    this.cola = mio.then(() => {}, () => {});
    return mio;
  }

  /** Google pidió calma: se dobla el intervalo. */
  frenar() {
    this.buenasSeguidas = 0;
    this.intervalo = Math.min(this.maximo, Math.round(this.intervalo * 2));
  }

  /** Varias seguidas sin queja: se puede ir más rápido, pero de a poco. */
  aflojar() {
    if (++this.buenasSeguidas < 3) return;
    this.buenasSeguidas = 0;
    this.intervalo = Math.max(this.minimo, Math.round(this.intervalo * 0.8));
  }

  get segundos() { return Math.round(this.intervalo / 100) / 10; }
}
