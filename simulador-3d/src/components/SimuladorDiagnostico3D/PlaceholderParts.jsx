/**
 * PlaceholderParts.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Representación 3D de las piezas del ensamble "Caja y Espiga" (Mortise & Tenon).
 *
 * ESTADO ACTUAL: Usa geometrías primitivas de Three.js como PLACEHOLDERS.
 * Estas formas permiten probar y demostrar toda la interacción y lógica del
 * componente sin necesitar los archivos STL reales.
 *
 * CUANDO LLEGUEN LOS STL:
 *   1. Descomentar la sección "STL Loader" de abajo.
 *   2. Comentar/eliminar los componentes <HembraMockup> y <MachoMockup>.
 *   3. Pasar { macho: '/ruta/espiga.stl', hembra: '/ruta/caja.stl' } en la prop stlUrls.
 *
 * Errores inyectados y su efecto visual:
 * ─────────────────────────────────────────────────────────────────────────────
 *  ajuste_suelto    → Espiga 12 % más delgada; gap visible cuando está ensamblada.
 *  caja_mal_centrada → Mortise desplazado 0.3 u. en X; desalineación notoria.
 *  espiga_muy_larga  → Espiga 25 % más larga; sobresale del fondo cuando ensamblada.
 *  ajuste_forzado    → Espiga 8 % más gruesa; se muestra en ámbar como aviso.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// ── Constantes geométricas base ────────────────────────────────────────────

/** Dimensiones nominales de la pieza huésped (hembra/caja) */
const HEMBRA = {
  bodyW: 3.2,    // ancho total
  bodyH: 4.2,    // altura total
  bodyD: 2.2,    // profundidad
  slotW: 1.1,    // ancho del mortise
  slotH: 2.6,    // altura del mortise
  slotD: 1.6,    // profundidad del mortise (cuánto penetra la espiga)
};

/** Dimensiones nominales de la pieza macho (espiga/tenon) */
const MACHO = {
  bodyW: 3.2,
  bodyH: 4.2,
  bodyD: 2.2,
  tenonW: 1.1,   // ancho de la espiga (debe coincidir con slotW de la hembra)
  tenonH: 2.6,   // altura de la espiga
  tenonD: 1.6,   // longitud de la espiga (profundidad que penetra)
};

/** Separación máxima (en unidades Three.js) cuando el slider está al 100 % */
const MAX_SEPARATION = 5.5;

// ── Materiales ─────────────────────────────────────────────────────────────

const MAT_WOOD_LIGHT = new THREE.MeshStandardMaterial({
  color: '#c8922a',
  roughness: 0.78,
  metalness: 0.02,
});

const MAT_WOOD_DARK = new THREE.MeshStandardMaterial({
  color: '#8b5e1a',
  roughness: 0.82,
  metalness: 0.02,
});

const MAT_ERROR_SLOT = new THREE.MeshStandardMaterial({
  color: '#ef4444',
  roughness: 0.5,
  metalness: 0.1,
  emissive: '#7f1d1d',
  emissiveIntensity: 0.3,
});

const MAT_ERROR_AMBER = new THREE.MeshStandardMaterial({
  color: '#f59e0b',
  roughness: 0.5,
  metalness: 0.1,
  emissive: '#78350f',
  emissiveIntensity: 0.3,
});

// ─── Helper: calcula las dimensiones reales de la espiga según el error ────

function getTenonDims(injectedError) {
  const base = { w: MACHO.tenonW, h: MACHO.tenonH, d: MACHO.tenonD };
  if (!injectedError) return base;
  switch (injectedError.id) {
    case 'ajuste_suelto':
      // Espiga más delgada — gap visible
      return { w: base.w * 0.82, h: base.h * 0.88, d: base.d };
    case 'espiga_muy_larga':
      // Espiga más larga — sobresale del fondo
      return { w: base.w, h: base.h, d: base.d * 1.28 };
    case 'ajuste_forzado':
      // Espiga más gruesa — se marcaría en color ámbar
      return { w: base.w * 1.08, h: base.h * 1.06, d: base.d };
    default:
      return base;
  }
}

/** Desplazamiento X del mortise cuando el error es "caja_mal_centrada" */
function getMortiseOffset(injectedError) {
  return injectedError?.id === 'caja_mal_centrada' ? 0.32 : 0;
}

// ─── Pieza Hembra (Mortise / Caja) ────────────────────────────────────────

/**
 * Construye la pieza con el mortise usando 4 sub-cajas que forman el hueco interno.
 * Esto evita la necesidad de operaciones booleanas CSG en Three.js.
 *
 *  ┌───────────────┐
 *  │  ┌─────────┐  │  ← techo
 *  │  │  HUECO  │  │
 *  │  │ (slot)  │  │
 *  │  └─────────┘  │  ← suelo
 *  └───────────────┘
 *      pared izq    pared der
 */
function HembraMockup({ injectedError, position }) {
  const mortiseOffsetX = getMortiseOffset(injectedError);

  // Medidas de los muros del mortise
  const wallW   = (HEMBRA.bodyW - HEMBRA.slotW) / 2;   // ancho de cada pared lateral
  const capH    = (HEMBRA.bodyH - HEMBRA.slotH) / 2;   // altura de techo y suelo

  return (
    <group position={position} castShadow receiveShadow>
      {/* Pared izquierda */}
      <mesh
        position={[-(HEMBRA.slotW / 2 + wallW / 2) + mortiseOffsetX, 0, 0]}
        castShadow receiveShadow material={MAT_WOOD_DARK}
      >
        <boxGeometry args={[wallW, HEMBRA.bodyH, HEMBRA.bodyD]} />
      </mesh>

      {/* Pared derecha */}
      <mesh
        position={[(HEMBRA.slotW / 2 + wallW / 2) + mortiseOffsetX, 0, 0]}
        castShadow receiveShadow material={MAT_WOOD_DARK}
      >
        <boxGeometry args={[wallW, HEMBRA.bodyH, HEMBRA.bodyD]} />
      </mesh>

      {/* Techo del mortise */}
      <mesh
        position={[mortiseOffsetX, HEMBRA.slotH / 2 + capH / 2, 0]}
        castShadow receiveShadow material={MAT_WOOD_DARK}
      >
        <boxGeometry args={[HEMBRA.slotW, capH, HEMBRA.bodyD]} />
      </mesh>

      {/* Suelo del mortise */}
      <mesh
        position={[mortiseOffsetX, -(HEMBRA.slotH / 2 + capH / 2), 0]}
        castShadow receiveShadow material={MAT_WOOD_DARK}
      >
        <boxGeometry args={[HEMBRA.slotW, capH, HEMBRA.bodyD]} />
      </mesh>

      {/* Fondo del mortise (cara trasera — profundidad del hueco) */}
      <mesh
        position={[mortiseOffsetX, 0, -(HEMBRA.bodyD / 2 - (HEMBRA.bodyD - HEMBRA.slotD) / 2)]}
        castShadow receiveShadow material={MAT_WOOD_DARK}
      >
        <boxGeometry args={[HEMBRA.slotW, HEMBRA.slotH, HEMBRA.bodyD - HEMBRA.slotD]} />
      </mesh>

      {/* Indicador visual del eje de mortise (línea de referencia) */}
      {injectedError?.id === 'caja_mal_centrada' && (
        <mesh position={[mortiseOffsetX, 0, HEMBRA.bodyD / 2 + 0.01]} material={MAT_ERROR_SLOT}>
          <planeGeometry args={[HEMBRA.slotW, HEMBRA.slotH]} />
        </mesh>
      )}
    </group>
  );
}

// ─── Pieza Macho (Tenon / Espiga) ─────────────────────────────────────────

function MachoMockup({ injectedError, position }) {
  const { w: tW, h: tH, d: tD } = getTenonDims(injectedError);
  const isForced = injectedError?.id === 'ajuste_forzado';

  return (
    <group position={position} castShadow receiveShadow>
      {/* Cuerpo principal */}
      <mesh castShadow receiveShadow material={MAT_WOOD_LIGHT}>
        <boxGeometry args={[MACHO.bodyW, MACHO.bodyH, MACHO.bodyD]} />
      </mesh>

      {/* Espiga (tenon) — centrada en la cara delantera del cuerpo */}
      <mesh
        position={[0, 0, MACHO.bodyD / 2 + tD / 2]}
        castShadow receiveShadow
        material={isForced ? MAT_ERROR_AMBER : MAT_WOOD_LIGHT}
      >
        <boxGeometry args={[tW, tH, tD]} />
      </mesh>

      {/* Aristas de referencia de la espiga (marca nominal) */}
      <lineSegments position={[0, 0, MACHO.bodyD / 2 + tD / 2]}>
        <edgesGeometry args={[new THREE.BoxGeometry(tW, tH, tD)]} />
        <lineBasicMaterial color={isForced ? '#f59e0b' : '#d97706'} />
      </lineSegments>
    </group>
  );
}

// ─── Componente principal PlaceholderParts ─────────────────────────────────

/**
 * @param {number}  separationOffset  0 = ensamblado, 1 = separado
 * @param {Object}  injectedError     { id, label } del error inyectado
 * @param {Object}  stlUrls           { macho, hembra } — rutas a STL reales (futuro)
 */
function PlaceholderParts({ separationOffset, injectedError, stlUrls }) {
  const machoRef   = useRef();
  const hembraRef  = useRef();

  /**
   * Posición inicial de la pieza macho: su espiga toca el mortise de la hembra.
   * Hembra en Z negativo, Macho en Z positivo; el joint es en Z = 0.
   *
   * Cuando separationOffset > 0, el macho se aleja en +Z.
   */
  const HEMBRA_Z  = -HEMBRA.bodyD / 2 - 0.01;   // cara frontal del mortise en Z=0
  const MACHO_Z_0 = MACHO.bodyD / 2;             // cara trasera del macho en Z=0 (ensamblado)

  useFrame(() => {
    if (!machoRef.current) return;
    const targetZ = MACHO_Z_0 + separationOffset * MAX_SEPARATION;
    // Lerp suave para animación fluida
    machoRef.current.position.z += (targetZ - machoRef.current.position.z) * 0.12;
  });

  // ── TODO (futuro): reemplazar por STL Loader ──────────────────────────────
  // Si se proveen URLs de STL, cargar con:
  //
  //   import { useLoader } from '@react-three/fiber';
  //   import { STLLoader } from 'three/examples/jsm/loaders/STLLoader';
  //
  //   const geometryMacho  = useLoader(STLLoader, stlUrls.macho);
  //   const geometryHembra = useLoader(STLLoader, stlUrls.hembra);
  //
  //   <mesh ref={machoRef} geometry={geometryMacho}  material={MAT_WOOD_LIGHT} />
  //   <mesh ref={hembraRef} geometry={geometryHembra} material={MAT_WOOD_DARK}  />
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <group>
      {/* ── Pieza Hembra (estática) ── */}
      <group ref={hembraRef}>
        <HembraMockup
          injectedError={injectedError}
          position={[0, 0, HEMBRA_Z]}
        />
      </group>

      {/* ── Pieza Macho (se mueve con el slider) ── */}
      <group ref={machoRef} position={[0, 0, MACHO_Z_0]}>
        <MachoMockup
          injectedError={injectedError}
          position={[0, 0, 0]}
        />
      </group>
    </group>
  );
}

export default PlaceholderParts;
