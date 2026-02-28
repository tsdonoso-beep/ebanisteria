/**
 * catalogoData.js
 * Datos de los 11 modelos del Juego de Ensamble con tolerancias técnicas
 * y configuración por familia de junta para el visor 3D de fabricación.
 */

export const CATEGORIAS = [
  {
    id: 'ensambles',
    label: 'Ensambles',
    icon: '🔩',
    items: [
      {
        id: 'N1', label: 'A Tarugo',
        familia: 'tarugo',
        stl: '/models/01-tarugo.stl',
        tolerancias: [
          { parte: 'Tarugo Ø (macho)',      nominal: '10.0 mm', real: '9.8 mm',  nota: 'Huelgo -0.2 mm: expansión radial al absorber cola vinílica.' },
          { parte: 'Perforación Ø (hembra)', nominal: '10.0 mm', real: '10.0 mm', nota: 'Profundidad = ½ longitud del tarugo + 2 mm de holgura axial.' },
        ],
      },
      {
        id: 'N2', label: 'Caja y Espiga',
        familia: 'caja-espiga',
        stl: '/models/02-caja-espiga.stl',
        tolerancias: [
          { parte: 'Caja (hembra) ancho',   nominal: '10.0 mm', real: '10.0 mm', nota: 'Medida nominal de referencia.' },
          { parte: 'Espiga (macho) ancho',   nominal: '10.0 mm', real: '9.8 mm',  nota: 'Tolerancia -0.2 mm: la madera se expande al humedecer con cola.' },
          { parte: 'Espiga (macho) largo',   nominal: '40.0 mm', real: '39.0 mm', nota: '1 mm de holgura axial en el fondo de la caja.' },
        ],
      },
      {
        id: 'N3', label: 'A Horquilla',
        familia: 'horquilla',
        stl: '/models/03-orquilla.stl',
        tolerancias: [
          { parte: 'Ranura horquilla ancho', nominal: '12.0 mm', real: '12.0 mm', nota: 'Ancho = 1/3 del espesor de la pieza.' },
          { parte: 'Lengüeta (macho) ancho', nominal: '12.0 mm', real: '11.8 mm', nota: 'Huelgo -0.2 mm para inserción sin cuña.' },
          { parte: 'Profundidad ranura',      nominal: '35.0 mm', real: '35.0 mm', nota: 'Profundidad = ½ anchura de la pieza huésped.' },
        ],
      },
      {
        id: 'N4', label: 'Media Madera',
        familia: 'media-madera',
        stl: '/models/04-media-madera.stl',
        tolerancias: [
          { parte: 'Rebaje profundidad A',   nominal: '½ espesor', real: '15.0 mm', nota: 'Exactamente la mitad del espesor de 30 mm.' },
          { parte: 'Rebaje profundidad B',   nominal: '½ espesor', real: '15.0 mm', nota: 'Ambas piezas simétricas; la suma = espesor total.' },
          { parte: 'Ancho de rebaje',        nominal: '= ancho pieza', real: '40.0 mm', nota: 'Huelgo lateral 0 mm para máxima superficie de cola.' },
        ],
      },
      {
        id: 'N5', label: 'Cola de Milano',
        familia: 'cola-milano',
        stl: '/models/05-cola-milano.stl',
        tolerancias: [
          { parte: 'Ángulo cola (madera blanda)', nominal: '1:6 (9.5°)', real: '9.5°', nota: 'Para coníferas; madera dura usa 1:8 (7.1°).' },
          { parte: 'Cola base (macho)',       nominal: '12.0 mm', real: '11.8 mm', nota: 'Huelgo -0.2 mm en flancos.' },
          { parte: 'Hueco base (hembra)',     nominal: '12.0 mm', real: '12.0 mm', nota: 'Nominal. No rebasar: riesgo de fractura en paredes.' },
        ],
      },
    ],
  },
  {
    id: 'juntas',
    label: 'Juntas',
    icon: '🔗',
    items: [
      {
        id: 'N6', label: 'A Tarugo',
        familia: 'tarugo',
        stl: '/models/06-junta-tarugo.stl',
        tolerancias: [
          { parte: 'Tarugo Ø',               nominal: '8.0 mm',  real: '7.8 mm',  nota: 'Huelgo -0.2 mm estándar. Espaciado máx. 150 mm entre tarugos.' },
          { parte: 'Perforación profundidad', nominal: '20.0 mm', real: '20.0 mm', nota: 'Igual en ambas piezas; centrado en el espesor.' },
        ],
      },
      {
        id: 'N7', label: 'Machihembrada',
        familia: 'machihembrada',
        stl: '/models/07-junta-machihembrada.stl',
        tolerancias: [
          { parte: 'Ranura (hembra) ancho',  nominal: '6.0 mm',  real: '6.0 mm',  nota: 'Centrada en el canto de la pieza.' },
          { parte: 'Lengüeta (macho) ancho', nominal: '6.0 mm',  real: '5.8 mm',  nota: 'Huelgo -0.2 mm para facilitar el deslizamiento.' },
          { parte: 'Profundidad ranura',      nominal: '12.0 mm', real: '12.0 mm', nota: 'Aprox. 2× el ancho de la ranura.' },
        ],
      },
      {
        id: 'N8', label: 'Media Madera',
        familia: 'media-madera',
        stl: '/models/08-junta-media-madera.stl',
        tolerancias: [
          { parte: 'Rebaje A (profundidad)',  nominal: '15.0 mm', real: '15.0 mm', nota: '½ del espesor de 30 mm.' },
          { parte: 'Rebaje B (profundidad)',  nominal: '15.0 mm', real: '15.0 mm', nota: 'Simétrico a A. Tolerancia 0 mm entre caras de contacto.' },
        ],
      },
    ],
  },
  {
    id: 'empalmes',
    label: 'Empalmes',
    icon: '📏',
    items: [
      {
        id: 'N9', label: 'Media Madera',
        familia: 'media-madera',
        stl: '/models/09-empalme-media-madera.stl',
        tolerancias: [
          { parte: 'Solapamiento mínimo',    nominal: '1.5× ancho', real: '60.0 mm', nota: 'Para pieza de 40 mm de ancho.' },
          { parte: 'Rebaje profundidad',      nominal: '½ espesor', real: '15.0 mm', nota: 'No exceder ½; reduce resistencia estructural.' },
        ],
      },
      {
        id: 'N10', label: 'A Horquilla',
        familia: 'horquilla',
        stl: '/models/10-empalme-horquilla.stl',
        tolerancias: [
          { parte: 'Ranura horquilla',       nominal: '12.0 mm', real: '12.0 mm', nota: 'Ancho = 1/3 espesor de la pieza.' },
          { parte: 'Lengüeta empalme',       nominal: '12.0 mm', real: '11.8 mm', nota: 'Huelgo -0.2 mm.' },
        ],
      },
      {
        id: 'N11', label: 'Horquilla y Media M.',
        familia: 'horquilla',
        stl: '/models/11-empalme-horquilla-media.stl',
        tolerancias: [
          { parte: 'Rebaje media madera',    nominal: '½ espesor', real: '15.0 mm', nota: 'Primera parte del empalme compuesto.' },
          { parte: 'Ranura horquilla',       nominal: '12.0 mm', real: '12.0 mm', nota: 'Segunda parte; misma tolerancia que N10.' },
          { parte: 'Solapamiento total',     nominal: '60.0 mm', real: '60.0 mm', nota: 'Combina ambos mecanismos.' },
        ],
      },
    ],
  },
];

// Flat map for easy lookup by ID
export const MODELOS_MAP = Object.fromEntries(
  CATEGORIAS.flatMap(cat => cat.items.map(item => [item.id, { ...item, categoria: cat.label }]))
);

// Labels for the 5 manufacturing phases
export const FASE_LABELS = [
  { pct: 0,   label: 'Bloques en bruto',     desc: 'Material en PVC/madera sin ningún corte.' },
  { pct: 25,  label: 'Trazado y marcado',    desc: 'Se marca el material a eliminar (resaltado en rojo).' },
  { pct: 50,  label: 'Corte y perfilado',    desc: 'El material sobrante se remueve; aparece el perfil de la unión.' },
  { pct: 75,  label: 'Posicionamiento',      desc: 'Las piezas se alinean frente a frente listas para ensamblar.' },
  { pct: 100, label: 'Ensamblaje completo',  desc: 'Las piezas se insertan y quedan perfectamente unidas.' },
];
