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
    "tipo": "BOLETA | FACTURA | TICKET | RHE | PLANILLA DE MOVILIDAD | DJ | NOTA DE CRÉDITO | OTRO",
    "serie": "",
    "numero": "",
    "fecha": "",
    "ruc": "",
    "proveedor": "",
    "moneda": "PEN | USD",
    "subtotal": "",
    "igv": "",
    "importe": "",
    "descripcion": "",
    "categoria": "",
    "responsable": ""
  }
]

Reglas:

- Un objeto por comprobante. Si la imagen tiene tres boletas, devuelve tres
  objetos. Si tiene una sola, un array de UN elemento.
- El criterio para separar es el NÚMERO DE COMPROBANTE, no el contenido. Dos
  objetos distintos tienen que tener números distintos. Si estás por devolver
  dos objetos con el mismo número, no son dos comprobantes: es uno solo y
  debes devolver uno solo.
- Los productos de una boleta NO son comprobantes. Una boleta con cuatro
  platos —un menú, una ensalada, un café, un postre— es UN objeto cuyo
  importe es el total de la boleta, nunca cuatro objetos con el precio de
  cada plato. Este es el error más frecuente: al verlo separado por líneas,
  parece que fueran documentos distintos, y no lo son.
- En la duda, devuelve menos objetos. Un comprobante de más inventa un gasto
  que no existe y descuadra la rendición; uno de menos lo nota la persona al
  revisar.
- "fecha" va en formato AAAA-MM-DD. Si hay fecha de emisión y de vencimiento,
  usa la de emisión.
- "ruc" son los once dígitos del EMISOR, no los del cliente. Empieza en 10, 15,
  17 o 20, y está junto al nombre y la dirección de la empresa, arriba.
- «DJ» es una DECLARACIÓN JURADA: un formato donde la persona declara de su
  puño un gasto sin comprobante —una propina, un mototaxi, un peaje sin
  boleta—. No tiene RUC ni serie; suele llevar el DNI de quien declara y su
  firma. Léela igual que cualquier otra: la herramienta la archiva aunque
  después no la cuente para el sustento.
- En una PLANILLA DE MOVILIDAD no hay empresa emisora: el documento lo firma
  una persona que hizo los viajes, y su nombre es el dato que importa. Ponlo
  en "proveedor" y también en "responsable" —por ejemplo IVAN CAMACHO BRITO o
  FERNANDO ARONI SALCEDO—, NO el nombre impreso en el membrete del
  formulario, que es el de quien lo imprimió y se repite en todas.
- "serie" y "numero" salen del código del comprobante. Circulan varios
  formatos y todos son válidos: F001-6384, EB01-135, FW01-434, y también
  series puramente numéricas como 0001-003936 o 002-001175. La serie es lo
  anterior al guion; el numero, lo posterior sin los ceros de la izquierda.
- "importe" es el total final a pagar, después de descuentos.
- Los montos van como número con punto decimal, sin símbolo ni separador de
  millar: 1234.50, nunca "S/ 1,234.50".
- "descripcion" es en pocas palabras qué se compró, si se distingue: «almuerzo
  para dos», «taxi al aeropuerto», «2 kg de pernos». Es el concepto del gasto,
  y es lo que después permite entender la rendición sin abrir cada foto.
- "categoria" es el único campo que DEDUCES en vez de leer, y sale de lo que se
  compró. Elige exactamente uno de estos rótulos, tal cual:
  ALIMENTACIÓN, TRANSPORTE, HOSPEDAJE, COMBUSTIBLE, PEAJE Y ESTACIONAMIENTO,
  MATERIALES Y HERRAMIENTAS, SERVICIOS, COMUNICACIONES, SALUD, TRÁMITES, OTROS.
  Si el comprobante no deja ver qué se compró, usa OTROS: es preferible a
  adivinar una categoría concreta que suene verosímil y esté mal.
- "moneda" es "USD" solo si el comprobante lo dice; si no, "PEN".

Si un dato no aparece o no se lee con certeza, déjalo como cadena vacía. NO lo
inventes ni lo deduzcas: un campo vacío lo corrige una persona en dos segundos,
pero un dato inventado que parece correcto se registra mal y nadie lo nota.`;

/**
 * Consolidado leído de la capa de texto del PDF.
 *
 * Llega el texto exacto, fila por fila, sin un solo error de lectura: el PDF
 * sale de una hoja de cálculo y lo trae dentro. Lo que queda por hacer no es
 * leer sino repartir cada fila en sus campos, y eso es lo único que se delega.
 */
export const PROMPT_CONSOLIDADO_TEXTO = `Recibes las filas de un CONSOLIDADO DE CAJA CHICA peruano, extraídas del PDF
tal como están. Cada línea es una fila de la tabla; dentro de una línea, los
campos van separados por dos o más espacios, en el mismo orden que las
columnas.

El texto es exacto: NO lo corrijas ni lo interpretes. Tu trabajo es solo
repartir cada fila en sus campos.

Devuelve ÚNICAMENTE este objeto JSON, sin explicación ni bloque de código:

{
  "caja": "",
  "administrador": "",
  "montoAsignado": "",
  "gastosRealizados": "",
  "lineas": [
    {
      "fecha": "", "tipo": "", "numero": "", "proveedor": "", "proyecto": "",
      "area": "", "responsable": "", "categoria": "", "subcategoria": "",
      "clasificacion": "", "descripcion": "", "importe": ""
    }
  ]
}

Reglas:

- Una entrada por CADA fila de datos, en su orden. Las de cabecera y las de
  totales no son filas de datos.
- El valor de una celda puede venir partido en la línea si el texto envolvía
  en el papel: «PLANILLA DE» y «MOVILIDAD» son una sola celda.
- Copia los textos tal cual. Un nombre mal escrito en el papel va mal escrito
  acá: esto se cruza contra los comprobantes, y un dato «arreglado» hace que
  el cuadre mienta.
- "fecha" en formato AAAA-MM-DD. Los importes con punto decimal, sin símbolo
  ni separador de millar.
- La cabecera —caja, administrador, montos— solo está en la primera página. Si
  esta no la trae, deja esos campos vacíos.`;

/**
 * Lectura de un consolidado ESCANEADO, sin capa de texto.
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
