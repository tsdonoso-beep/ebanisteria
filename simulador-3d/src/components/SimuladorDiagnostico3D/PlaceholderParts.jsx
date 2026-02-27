/**
 * PlaceholderParts.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Renderiza las piezas 3D del ensamble en dos modos:
 *
 *  MODO STL (cuando stlUrls.url está definido):
 *    - Carga el archivo STL real con STLLoader.
 *    - Centra y normaliza la geometría automáticamente.
 *    - "Desarmado virtual" = plano de corte transversal (clip plane) que
 *      revela el interior del ensamble a medida que el slider avanza.
 *    - Doble render (front + back faces) para mostrar la sección sólida.
 *    - Overlays translúcidos que señalan visualmente el error inyectado.
 *
 *  MODO PLACEHOLDER (cuando stlUrls es null):
 *    - Geometrías primitivas que simulan una Caja y Espiga.
 *    - Mantiene toda la lógica de interacción funcionando sin STL.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useRef, useMemo, Suspense } from 'react';
import { useLoader, useFrame, useThree } from '@react-three/fiber';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';

// ── Habilitar LocalClipping en el renderer ─────────────────────────────────
// Necesario para que material.clippingPlanes funcione.
function EnableClipping() {
  const { gl } = useThree();
  gl.localClippingEnabled = true;
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// MODO STL — carga y renderiza el modelo real
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Overlays translúcidos que indican visualmente dónde está el error
 * inyectado en el modelo. Ayudan al docente a buscar en la zona correcta.
 *
 * Nota: No revelan el TIPO de error (eso debe diagnosticarlo el docente),
 * solo marcan la ZONA de inspección relevante.
 */
function ErrorOverlay({ injectedError, bbox }) {
  const mid = useMemo(() => {
    if (!bbox) return new THREE.Vector3();
    return new THREE.Vector3(
      (bbox.max.x + bbox.min.x) / 2,
      (bbox.max.y + bbox.min.y) / 2,
      (bbox.max.z + bbox.min.z) / 2,
    );
  }, [bbox]);

  if (!injectedError?.id || !bbox) return null;

  const rx = (bbox.max.x - bbox.min.x) * 0.55;
  const rz = (bbox.max.z - bbox.min.z) * 0.55;

  switch (injectedError.id) {
    case 'ajuste_suelto':
      // Anillo rojo en la interfaz de unión → señala la holgura
      return (
        <mesh position={[mid.x, mid.y, mid.z]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[Math.max(rx, rz) * 0.7, 0.08, 16, 48]} />
          <meshStandardMaterial color="#ef4444" transparent opacity={0.55} emissive="#7f1d1d" emissiveIntensity={0.4} />
        </mesh>
      );

    case 'caja_mal_centrada':
      // Flecha / caja desplazada en X → señala la desalineación
      return (
        <group position={[mid.x + rx * 0.5, mid.y, mid.z]}>
          <mesh>
            <boxGeometry args={[0.12, (bbox.max.y - bbox.min.y) * 0.6, 0.12]} />
            <meshStandardMaterial color="#f59e0b" transparent opacity={0.6} emissive="#78350f" emissiveIntensity={0.3} />
          </mesh>
        </group>
      );

    case 'espiga_muy_larga':
      // Plano horizontal en la base de la caja → señala la sobresalida
      return (
        <mesh position={[mid.x, bbox.min.y + (bbox.max.y - bbox.min.y) * 0.25, mid.z]}>
          <boxGeometry args={[rx * 1.4, 0.08, rz * 1.4]} />
          <meshStandardMaterial color="#f97316" transparent opacity={0.5} emissive="#7c2d12" emissiveIntensity={0.3} />
        </mesh>
      );

    case 'ajuste_forzado':
      // Halo ámbar denso en la zona de contacto
      return (
        <mesh position={[mid.x, mid.y, mid.z]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[Math.max(rx, rz) * 0.5, 0.15, 16, 48]} />
          <meshStandardMaterial color="#fbbf24" transparent opacity={0.45} emissive="#92400e" emissiveIntensity={0.4} />
        </mesh>
      );

    default:
      return null;
  }
}

/**
 * Carga y renderiza el STL real.
 * Usa doble render (DoubleSide trick) para mostrar sección sólida al cortar.
 */
function STLModel({ url, separationOffset, injectedError }) {
  const rawGeometry = useLoader(STLLoader, url);

  // Clonar, centrar, escalar y recalcular normales — solo una vez
  const geometry = useMemo(() => {
    const geo = rawGeometry.clone();
    geo.computeBoundingBox();
    geo.center();
    const size = new THREE.Vector3();
    geo.boundingBox.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    const scaleFactor = 5.5 / maxDim;
    geo.scale(scaleFactor, scaleFactor, scaleFactor);
    geo.computeBoundingBox();
    geo.computeVertexNormals();
    return geo;
  }, [rawGeometry]);

  const bbox = geometry.boundingBox;
  const modelHeight = bbox.max.y - bbox.min.y;

  // Plano de corte: normal (0,-1,0) → oculta todo lo que esté por encima de `constant`
  // constant empieza en max.y+ε (sin recorte) y baja a ~30 % del modelo
  const clipPlane = useRef(
    new THREE.Plane(new THREE.Vector3(0, -1, 0), bbox.max.y + 0.5),
  );

  // Valor lerpeado para suavizar la animación
  const currentClipY = useRef(bbox.max.y + 0.5);

  useFrame(() => {
    const targetClipY =
      (bbox.max.y + 0.5) - separationOffset * (modelHeight * 0.72 + 0.5);
    currentClipY.current += (targetClipY - currentClipY.current) * 0.1;
    clipPlane.current.constant = currentClipY.current;
  });

  const clippingPlanes = [clipPlane.current];

  return (
    <group>
      {/* Cara exterior — madera clara */}
      <mesh castShadow receiveShadow geometry={geometry}>
        <meshStandardMaterial
          color="#c8922a"
          roughness={0.78}
          metalness={0.02}
          side={THREE.FrontSide}
          clippingPlanes={clippingPlanes}
          clipShadows
        />
      </mesh>

      {/* Cara interior — madera oscura (visible cuando el plano corta el modelo) */}
      <mesh geometry={geometry}>
        <meshStandardMaterial
          color="#7a4a1a"
          roughness={0.9}
          metalness={0.0}
          side={THREE.BackSide}
          clippingPlanes={clippingPlanes}
        />
      </mesh>

      {/* Overlay del error inyectado */}
      <ErrorOverlay injectedError={injectedError} bbox={bbox} />
    </group>
  );
}

/** Fallback de carga mientras el STL se descarga */
function LoadingFallback() {
  const meshRef = useRef();
  useFrame(({ clock }) => {
    if (meshRef.current) {
      meshRef.current.rotation.y = clock.getElapsedTime() * 0.8;
    }
  });
  return (
    <mesh ref={meshRef}>
      <octahedronGeometry args={[1.2, 0]} />
      <meshStandardMaterial color="#4b5563" wireframe />
    </mesh>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MODO PLACEHOLDER — geometrías primitivas de Caja y Espiga
// (usado cuando stlUrls es null)
// ═══════════════════════════════════════════════════════════════════════════

const MAT_HEMBRA = new THREE.MeshStandardMaterial({ color: '#8b5e1a', roughness: 0.82, metalness: 0.02 });
const MAT_MACHO  = new THREE.MeshStandardMaterial({ color: '#c8922a', roughness: 0.78, metalness: 0.02 });
const MAT_AMBER  = new THREE.MeshStandardMaterial({ color: '#f59e0b', roughness: 0.5, metalness: 0.1, emissive: '#78350f', emissiveIntensity: 0.3 });
const MAT_RED    = new THREE.MeshStandardMaterial({ color: '#ef4444', roughness: 0.5, metalness: 0.1, emissive: '#7f1d1d', emissiveIntensity: 0.3 });

const SLOT_W = 1.1, SLOT_H = 2.6, SLOT_D = 1.6;
const BODY_W = 3.2, BODY_H = 4.2, BODY_D = 2.2;
const MAX_SEP = 5.5;

function getTenonDims(errorId) {
  switch (errorId) {
    case 'ajuste_suelto':   return { w: SLOT_W * 0.82, h: SLOT_H * 0.88, d: SLOT_D };
    case 'espiga_muy_larga': return { w: SLOT_W,        h: SLOT_H,        d: SLOT_D * 1.28 };
    case 'ajuste_forzado':  return { w: SLOT_W * 1.08, h: SLOT_H * 1.06, d: SLOT_D };
    default:                return { w: SLOT_W,         h: SLOT_H,        d: SLOT_D };
  }
}

function PlaceholderFallback({ separationOffset, injectedError }) {
  const machoRef = useRef();
  const { w: tW, h: tH, d: tD } = getTenonDims(injectedError?.id);
  const mortiseOffX = injectedError?.id === 'caja_mal_centrada' ? 0.32 : 0;
  const wallW = (BODY_W - SLOT_W) / 2;
  const capH  = (BODY_H - SLOT_H) / 2;
  const isForced = injectedError?.id === 'ajuste_forzado';

  const HEMBRA_Z = -BODY_D / 2 - 0.01;
  const MACHO_Z0 =  BODY_D / 2;

  useFrame(() => {
    if (!machoRef.current) return;
    const target = MACHO_Z0 + separationOffset * MAX_SEP;
    machoRef.current.position.z += (target - machoRef.current.position.z) * 0.12;
  });

  return (
    <group>
      {/* Hembra */}
      <group position={[0, 0, HEMBRA_Z]}>
        <mesh position={[-(SLOT_W / 2 + wallW / 2) + mortiseOffX, 0, 0]} material={MAT_HEMBRA} castShadow receiveShadow><boxGeometry args={[wallW, BODY_H, BODY_D]} /></mesh>
        <mesh position={[ (SLOT_W / 2 + wallW / 2) + mortiseOffX, 0, 0]} material={MAT_HEMBRA} castShadow receiveShadow><boxGeometry args={[wallW, BODY_H, BODY_D]} /></mesh>
        <mesh position={[mortiseOffX,  SLOT_H / 2 + capH / 2, 0]} material={MAT_HEMBRA} castShadow receiveShadow><boxGeometry args={[SLOT_W, capH, BODY_D]} /></mesh>
        <mesh position={[mortiseOffX, -SLOT_H / 2 - capH / 2, 0]} material={MAT_HEMBRA} castShadow receiveShadow><boxGeometry args={[SLOT_W, capH, BODY_D]} /></mesh>
        <mesh position={[mortiseOffX, 0, -(BODY_D / 2 - (BODY_D - SLOT_D) / 2)]} material={MAT_HEMBRA} castShadow receiveShadow><boxGeometry args={[SLOT_W, SLOT_H, BODY_D - SLOT_D]} /></mesh>
      </group>
      {/* Macho */}
      <group ref={machoRef} position={[0, 0, MACHO_Z0]}>
        <mesh material={MAT_MACHO} castShadow receiveShadow><boxGeometry args={[BODY_W, BODY_H, BODY_D]} /></mesh>
        <mesh position={[0, 0, BODY_D / 2 + tD / 2]} material={isForced ? MAT_AMBER : MAT_MACHO} castShadow receiveShadow><boxGeometry args={[tW, tH, tD]} /></mesh>
      </group>
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Componente público
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param {number}  separationOffset  0 = ensamblado / 1 = corte completo
 * @param {Object}  injectedError     { id, label }
 * @param {Object}  stlUrls           null | { url: string }
 */
export default function PlaceholderParts({ separationOffset, injectedError, stlUrls }) {
  const useSTL = stlUrls?.url;

  return (
    <>
      <EnableClipping />
      {useSTL ? (
        <Suspense fallback={<LoadingFallback />}>
          <STLModel
            url={stlUrls.url}
            separationOffset={separationOffset}
            injectedError={injectedError}
          />
        </Suspense>
      ) : (
        <PlaceholderFallback
          separationOffset={separationOffset}
          injectedError={injectedError}
        />
      )}
    </>
  );
}
