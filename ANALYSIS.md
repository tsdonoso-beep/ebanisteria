# Análisis del Repositorio: MSE-SFT Ebanistería

## Descripción General

Plataforma web de **capacitación docente de 150 horas pedagógicas** para el programa **MSE-SFT Ebanistería** (Educación para el Trabajo), desarrollado para **PRONIED / MINEDU** (Perú). Forma docentes de secundaria en reconocimiento, operación y mantenimiento de equipos de un taller de ebanistería.

## Estructura del Proyecto

| Archivo | Propósito |
|---|---|
| `index.html` | Portal principal: vista isométrica SVG, buscador, chatbot IA, navegación |
| `modulo1.html` | M1 — Inducción y Zonificación General (15h) |
| `modulo2.html` | M2 — Investigación: Medición y Análisis (35h) |
| `modulo3.html` | M3 — Innovación: Maquinaria y Fabricación Digital (40h) |
| `modulo4.html` | M4 — Almacén: Logística, Enchapado y Acabado (35h) |
| `modulo5.html` | M5 — Pedagogía: Design Thinking y Evaluación (25h) |
| `actividades.html` | Actividades integradoras con proyectos transversales |
| `styles.css` | Design system v7: variables CSS, componentes, responsive |
| `principios_operacion.json` | Base de datos de 68 bienes con manuales, mantenimiento, IPERC y simuladores |
| `roadmap.md` | Desglose curricular completo de 150h |
| `EBANISTERÍA.xlsx` | Hoja de cálculo complementaria (inventario) |
| `Manual de Operatividad - Ebanistería.pdf` | Manual PDF de operatividad (17 MB) |

## Arquitectura Técnica

- **Stack**: HTML + CSS + JavaScript vanilla (sin frameworks ni bundler)
- **Datos**: JSON plano (`principios_operacion.json`) cargado vía `fetch()`
- **Iconos**: Lucide Icons (CDN)
- **Fuentes**: Inter + JetBrains Mono (Google Fonts)
- **Patrón**: Cada página HTML es autónoma con su propio `<script>` que carga el JSON y renderiza dinámicamente

## Funcionalidades Principales

1. **Vista Isométrica SVG** — Mapa interactivo del taller con hotspots por equipo, filtrable por grado escolar (1° a 5°)
2. **Panel de Detalle slide-in** — Cada bien muestra: principios, manual de operatividad, mantenimiento (limpieza/lubricación/afilado/calibración), fichas IPERC y estado de simulador
3. **Buscador global** — Búsqueda por nombre, código, marca o principios
4. **Chatbot "Ebanista IA"** — Sistema basado en reglas que responde consultas sobre equipos, módulos, grados, IPERC y simuladores
5. **Simulador de Código G** — Editor y visualizador canvas de trayectorias CNC con ejemplos precargados (cuadrado, círculo, estrella)
6. **Simulador de Pintura** — Canvas interactivo para practicar técnica de barnizado con controles de distancia/presión y medición de cobertura
7. **Quiz Gamificado** — 20 preguntas técnicas con retroalimentación inmediata, sistema de puntuación y niveles de aprobación
8. **Actividades Integradoras** — Flujos paso a paso para proyectos reales (Silla Escolar 5°, Estantería Melamina 4°)
9. **Filtros por subcategoría** — Cada módulo tiene filtros contextuales (Medición, Sujeción, CNC/Digital, Enchapado, etc.)

## Base de Datos (68 bienes)

| Categoría | Prefijo | Ejemplos |
|---|---|---|
| Herramientas | HER | Higrómetro, calibradores, escuadras, gubias, sierras manuales |
| Equipos estacionarios | EQU | Torno, sierra cinta, esmeril de banco, taladro columna |
| Especiales | ESP | Enchapadora, ruteadora, sierra caladora, taladro portátil |
| Complementarios | COM | Fresas CNC, muestrarios, modelos didácticos, cintas sierra |
| Producción | PRO | Maqueta anatomía tronco |
| Seguridad | SEG/IND | EPP pintado, EPP general |

### Estadísticas clave
- **24 bienes** con ficha IPERC (peligros, riesgos, controles)
- **8 bienes** que requieren simulación virtual previa antes de uso presencial
- Cada bien tiene: id, código, nombre, categoría, módulo, grados, marca/modelo, guión de video, principios de funcionamiento, manuales (operatividad + mantenimiento con 4 campos), IPERC y flag de simulador

## Design System (CSS v7)

- Paleta institucional MINEDU: rojo primario `#B71C1C`, azul acento `#1565C0`
- 5 colores por módulo: M1 naranja, M2 azul, M3 verde, M4 púrpura, M5 rojo
- Sistema de cards, grids responsivos (5/3/2/1 columnas), badges, progress bars
- Panel lateral animado (slide-in 460px con cubic-bezier)
- Chatbot flotante con FAB (Floating Action Button)
- Responsive: breakpoints en 1024px y 768px
- Animaciones: fadeIn, scaleIn, hotspotPulse

## Áreas de Mejora Identificadas

1. **Código duplicado** — La lógica de `openDetail()`, `closeDetail()`, carga de JSON y renderizado se repite en cada archivo HTML. Se podría extraer a un archivo JS compartido.
2. **Sin sistema de build** — No hay `package.json`, bundler ni minificación. Apropiado para la simplicidad actual pero limita escalabilidad.
3. **Inline styles extensivos** — Mucho CSS está inline en los HTML, dificultando mantenimiento y consistencia.
4. **Simulador G-Code limitado** — Solo soporta G00/G01 (movimientos lineales). No implementa arcos G02/G03.
5. **Sin persistencia** — No hay localStorage ni backend. El progreso del quiz y estados de módulos no se guardan entre sesiones.
6. **Sin tests** — No hay tests automatizados de ningún tipo.
7. **Accesibilidad** — Falta aria-labels, roles semánticos y soporte de teclado en elementos interactivos (hotspots SVG, cards clickeables).
8. **SEO y meta tags** — Solo `index.html` tiene meta description; los módulos individuales no.
