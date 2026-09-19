// Los prompts de extracción.
//
// Se iteran acá. Cuando una lectura salga mal, el arreglo casi siempre está en
// este texto y no en el código que lo llama.

/**
 * Lectura de comprobantes sueltos.
 *
 * Devuelve una LISTA, no un objeto: al escanear es habitual poner dos o tres
 * boletas térmicas juntas sobre el cristal, y tratar esa imagen como un solo
 * comprobante perdía todos menos uno sin que nadie lo notara.
 */
export const PROMPT_COMPROBANTE = `Eres un asistente de contabilidad en Perú. Recibes la imagen de uno o varios
comprobantes de pago —es común escanear dos o tres boletas juntas en la misma
hoja— y devuelves los datos de CADA UNO.

Devuelve ÚNICAMENTE un array JSON, sin explicación ni bloque de código:

[
  {
    "tipo": "BOLETA | FACTURA | TICKET | RHE | PLANILLA DE MOVILIDAD | NOTA DE CRÉDITO | OTRO",
    "serie": "",
    "numero": "",
    "fecha": "",
    "ruc": "",
    "proveedor": "",
    "moneda": "PEN | USD",
    "subtotal": "",
    "igv": "",
    "importe": "",
    "descripcion": ""
  }
]

Reglas:

- Un objeto por comprobante. Si la imagen tiene tres boletas, devuelve tres
  objetos. Si tiene uno solo, un array de un elemento.
- Cada comprobante es un documento con su propio número y su propio total. Dos
  productos dentro de la MISMA boleta no son dos comprobantes.
- "fecha" va en formato AAAA-MM-DD. Si hay fecha de emisión y de vencimiento,
  usa la de emisión.
- "ruc" son los once dígitos del EMISOR, no los del cliente. Empieza en 10, 15,
  17 o 20, y está junto al nombre y la dirección de la empresa, arriba.
- "serie" y "numero" salen del código del comprobante. Circulan varios
  formatos y todos son válidos: F001-6384, EB01-135, FW01-434, y también
  series puramente numéricas como 0001-003936 o 002-001175. La serie es lo
  anterior al guion; el numero, lo posterior sin los ceros de la izquierda.
- "importe" es el total final a pagar, después de descuentos.
- Los montos van como número con punto decimal, sin símbolo ni separador de
  millar: 1234.50, nunca "S/ 1,234.50".
- "descripcion" es en pocas palabras qué se compró, si se distingue.
- "moneda" es "USD" solo si el comprobante lo dice; si no, "PEN".

Si un dato no aparece o no se lee con certeza, déjalo como cadena vacía. NO lo
inventes ni lo deduzcas: un campo vacío lo corrige una persona en dos segundos,
pero un dato inventado que parece correcto se registra mal y nadie lo nota.`;

/**
 * Lectura de un consolidado de caja chica.
 *
 * No es un comprobante sino la rendición: una tabla con una línea por gasto.
 * Se lee para cruzarla contra los comprobantes registrados y saber qué está
 * sustentado y qué no.
 */
export const PROMPT_CONSOLIDADO = `Recibes la página de un CONSOLIDADO DE CAJA CHICA peruano: una tabla donde
cada fila es un gasto rendido.

Devuelve ÚNICAMENTE un objeto JSON, sin explicación ni bloque de código:

{
  "caja": "",
  "administrador": "",
  "montoAsignado": "",
  "gastosRealizados": "",
  "lineas": [
    {
      "fecha": "",
      "tipo": "",
      "numero": "",
      "proveedor": "",
      "proyecto": "",
      "area": "",
      "responsable": "",
      "categoria": "",
      "subcategoria": "",
      "clasificacion": "",
      "descripcion": "",
      "importe": ""
    }
  ]
}

Reglas:

- Una entrada de "lineas" por CADA fila de la tabla, en el orden en que
  aparecen. No resumas ni agrupes filas parecidas: si hay tres almuerzos de
  12.00 seguidos, son tres líneas.
- "numero" es el número de comprobante tal como está impreso, con su guion:
  F001-6384, 0001-003936, 002-001175. Las planillas de movilidad traen un
  número corrido sin guion, como 010010: cópialo igual.
- "fecha" en formato AAAA-MM-DD.
- Los importes van como número con punto decimal y sin símbolo ni separador
  de millar.
- Los campos de cabecera —caja, administrador, montos— solo aparecen en la
  primera página. Si esta página no los trae, déjalos vacíos.
- Si una columna no existe en este consolidado, deja el campo vacío en todas
  las líneas.

Copia lo que ves. No corrijas, no completes y no deduzcas: este documento se
usa para cuadrar contra los comprobantes, así que un dato "arreglado" hace que
el cuadre mienta.`;
