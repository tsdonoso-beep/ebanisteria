/**
 * VisorCanvas.jsx — Simulador 3D de Ensambles
 * ─────────────────────────────────────────────────────────────────────────
 * Línea de tiempo de 2 fases:
 *   0%   → Piezas separadas (visualmente claras)
 *   100% → Piezas ensambladas (la pieza B penetra en A como en el ensamble real)
 *
 * Algoritmo:
 *   1. Cargar STL (contiene las 2 piezas SEPARADAS como una sola malla)
 *   2. Union-Find para detectar los componentes conectados
 *   3. Ordenar por volumen de bounding-box (descarte dowels/tarugos pequeños)
 *   4. Calcular posición de ensamble: cerrar el gap + penetración = 50% de la
 *      pieza más corta (p.ej. el tenón entra en la mortaja)
 *   5. Animar B desde posición separada → posición ensamblada
 * ─────────────────────────────────────────────────────────────────────────
 */

import React, { useRef, useMemo, Suspense } from 'react';
import { Canvas, useLoader, useFrame } from '@react-three/fiber';
import { OrbitControls, ContactShadows, Grid, Html } from '@react-three/drei';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';

// ── Colores ────────────────────────────────────────────────────────────────
const COL_A = '#c8922a';   // madera clara  (pieza inferior / receptora)
const COL_B = '#7b4f1a';   // madera oscura (pieza superior / insertada)

// ── Amplitud de separación extra al 0% (unidades de escena) ───────────────
const SEP = 2.5;

// ══════════════════════════════════════════════════════════════════════════
// splitMeshByComponents
// Union-Find sobre los triángulos de la malla.
// Devuelve las geometrías ordenadas por VOLUMEN de bounding-box (descendente)
// → esto descarta piezas pequeñas como tarugos/dowels automáticamente.
// ══════════════════════════════════════════════════════════════════════════

function splitMeshByComponents(geometry) {
  const pos   = geometry.attributes.position;
  const nVert = pos.count;

  // ── Paso 1: Mapear vértices con la misma posición a un índice canónico ──
  const posMap = new Map();
  const canon  = new Int32Array(nVert);
  for (let i = 0; i < nVert; i++) {
    const kx = Math.round(pos.getX(i) * 1000);
    const ky = Math.round(pos.getY(i) * 1000);
    const kz = Math.round(pos.getZ(i) * 1000);
    const key = `${kx},${ky},${kz}`;
    if (posMap.has(key)) { canon[i] = posMap.get(key); }
    else { posMap.set(key, i); canon[i] = i; }
  }

  // ── Paso 2: Union-Find ──────────────────────────────────────────────────
  const parent = Int32Array.from({ length: nVert }, (_, i) => i);
  function find(a) {
    while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
  }
  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  const numTris = Math.floor(nVert / 3);
  for (let t = 0; t < numTris; t++) {
    union(canon[t * 3], canon[t * 3 + 1]);
    union(canon[t * 3 + 1], canon[t * 3 + 2]);
  }

  // ── Paso 3: Agrupar triángulos por raíz ───────────────────────────────
  const groups = new Map();
  for (let t = 0; t < numTris; t++) {
    const root = find(canon[t * 3]);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(t);
  }

  // ── Paso 4: Construir geometrías para todos los componentes ────────────
  const hasNormal = !!geometry.attributes.normal;
  const allGeos   = [];

  for (const tris of groups.values()) {
    const vCount = tris.length * 3;
    const posArr = new Float32Array(vCount * 3);
    const nrmArr = new Float32Array(vCount * 3);

    for (let vi = 0; vi < vCount; vi++) {
      const orig = tris[Math.floor(vi / 3)] * 3 + (vi % 3);
      posArr[vi * 3]     = pos.getX(orig);
      posArr[vi * 3 + 1] = pos.getY(orig);
      posArr[vi * 3 + 2] = pos.getZ(orig);
      if (hasNormal) {
        const n = geometry.attributes.normal;
        nrmArr[vi * 3]     = n.getX(orig);
        nrmArr[vi * 3 + 1] = n.getY(orig);
        nrmArr[vi * 3 + 2] = n.getZ(orig);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    if (hasNormal) {
      geo.setAttribute('normal', new THREE.BufferAttribute(nrmArr, 3));
    } else {
      geo.computeVertexNormals();
    }
    geo.computeBoundingBox();
    allGeos.push(geo);
  }

  // ── Paso 5: Ordenar por VOLUMEN de bounding-box (desc) ─────────────────
  // → las 2 piezas principales (tablas) tienen volumen >> dowels/tarugos
  const sizeVec = new THREE.Vector3();
  allGeos.sort((a, b) => {
    a.boundingBox.getSize(sizeVec);
    const va = sizeVec.x * sizeVec.y * sizeVec.z;
    b.boundingBox.getSize(sizeVec);
    const vb = sizeVec.x * sizeVec.y * sizeVec.z;
    return vb - va;
  });

  return allGeos;  // las 2 primeras son siempre las piezas principales
}

// ══════════════════════════════════════════════════════════════════════════
// STLPiezasUnion
// ══════════════════════════════════════════════════════════════════════════

function STLPiezasUnion({ url, progreso, mostrarCotas, tolerancias }) {
  const rawGeo  = useLoader(STLLoader, url);
  const matBRef = useRef();

  // ── Preprocesar y calcular posición de ensamble ──────────────────────
  const { geoA, geoB, assembledPosB } = useMemo(() => {
    // Centrar y escalar la malla completa a ~5.5 unidades
    const geo = rawGeo.clone();
    geo.computeBoundingBox();
    geo.center();
    const size = new THREE.Vector3();
    geo.boundingBox.getSize(size);
    const escala = 5.5 / Math.max(size.x, size.y, size.z);
    geo.scale(escala, escala, escala);
    geo.computeVertexNormals();

    // Dividir en componentes (ordenados por volumen)
    const partes = splitMeshByComponents(geo);

    if (partes.length < 2) {
      // Solo 1 componente — mostrar completo sin animación
      partes[0].computeBoundingBox();
      return { geoA: partes[0], geoB: null, assembledPosB: 0 };
    }

    // Tomar las 2 piezas de mayor volumen
    const p1 = partes[0];
    const p2 = partes[1];

    // geoA = pieza inferior (centro Y más bajo), geoB = pieza superior
    const cy1 = (p1.boundingBox.min.y + p1.boundingBox.max.y) / 2;
    const cy2 = (p2.boundingBox.min.y + p2.boundingBox.max.y) / 2;
    const [geoA, geoB] = cy1 <= cy2 ? [p1, p2] : [p2, p1];

    // Gap entre piezas en el STL (siempre > 0 porque vienen separadas)
    const gapY = geoB.boundingBox.min.y - geoA.boundingBox.max.y;

    // Penetración para el ensamble: 50% de la altura de la pieza más corta
    // → el tenón/espiga entra en la mortaja, la lengüeta en la ranura, etc.
    const hA = geoA.boundingBox.max.y - geoA.boundingBox.min.y;
    const hB = geoB.boundingBox.max.y - geoB.boundingBox.min.y;
    const penetracion = Math.min(hA, hB) * 0.50;

    // Posición Y de geoB cuando está ensamblada:
    // geoB se desplaza hacia abajo → cierra el gap Y entra en geoA
    const assembledPosB = -(gapY + penetracion);

    return { geoA, geoB, assembledPosB };
  }, [rawGeo]);

  // ── Interpolación: 0% separado → 100% ensamblado ─────────────────────
  // geoA: fija en [0,0,0]
  // geoB: va desde (assembledPosB + SEP) hasta (assembledPosB)
  const t     = progreso / 100;
  const posBy = assembledPosB + SEP * (1 - t);

  // ── Brillo al completar el ensamble ──────────────────────────────────
  useFrame(({ clock }) => {
    if (matBRef.current && progreso >= 100) {
      matBRef.current.emissiveIntensity =
        0.18 + Math.sin(clock.getElapsedTime() * 2.5) * 0.10;
    } else if (matBRef.current) {
      matBRef.current.emissiveIntensity = 0;
    }
  });

  const bboxA = geoA?.boundingBox;

  return (
    <group>
      {/* Pieza A — fija (inferior / receptora) */}
      <mesh castShadow receiveShadow geometry={geoA} position={[0, 0, 0]}>
        <meshStandardMaterial
          color={COL_A}
          roughness={0.70}
          metalness={0.05}
          emissive={COL_A}
          emissiveIntensity={progreso >= 100 ? 0.15 : 0}
        />
      </mesh>

      {/* Pieza B — animada (superior / insertada) */}
      {geoB && (
        <mesh castShadow receiveShadow geometry={geoB} position={[0, posBy, 0]}>
          <meshStandardMaterial
            ref={matBRef}
            color={COL_B}
            roughness={0.70}
            metalness={0.05}
            emissive={COL_B}
            emissiveIntensity={0}
          />
        </mesh>
      )}

      {/* Cotas técnicas — visibles solo al ensamblar */}
      {mostrarCotas && progreso >= 100 && bboxA && tolerancias?.map((tol, i) => {
        const angle = (i / tolerancias.length) * Math.PI - Math.PI / 4;
        const r     = (bboxA.max.x - bboxA.min.x) * 0.7 + 1.8;
        return (
          <Html
            key={i}
            position={[
              Math.cos(angle) * r,
              bboxA.max.y * 0.3 - i * 1.5,
              Math.sin(angle) * r,
            ]}
            distanceFactor={8}
            center
          >
            <div className="le-cota-card">
              <div className="le-cota-parte">{tol.parte}</div>
              <div className="le-cota-values">
                <span className="le-cota-nominal">{tol.nominal}</span>
                <span className="le-cota-real">{tol.real}</span>
              </div>
              <div className="le-cota-nota">{tol.nota}</div>
            </div>
          </Html>
        );
      })}
    </group>
  );
}

// ── Indicador de carga ─────────────────────────────────────────────────────
function LoadingFallback() {
  const ref = useRef();
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = clock.getElapsedTime() * 0.9;
  });
  return (
    <mesh ref={ref}>
      <octahedronGeometry args={[1.4, 0]} />
      <meshStandardMaterial color="#c8922a" wireframe opacity={0.6} transparent />
    </mesh>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Componente público: VisorCanvas
// ══════════════════════════════════════════════════════════════════════════

export default function VisorCanvas({ modelo, progreso, mostrarCotas }) {
  if (!modelo) return null;

  return (
    <Canvas
      camera={{ position: [4, 1, 14], fov: 50 }}
      shadows
      gl={{ antialias: true }}
    >
      <color attach="background" args={['#0f172a']} />

      <ambientLight intensity={0.45} />
      <directionalLight
        position={[6, 10, 6]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
      />
      <directionalLight position={[-5, 4, -5]} intensity={0.30} color="#a0c4ff" />
      <pointLight position={[0, 8, 0]} intensity={0.35} color="#fff5e0" />

      <Suspense fallback={<LoadingFallback />}>
        <STLPiezasUnion
          url={modelo.stl}
          progreso={progreso}
          mostrarCotas={mostrarCotas}
          tolerancias={modelo.tolerancias}
        />
      </Suspense>

      <ContactShadows
        position={[0, -6.8, 0]}
        opacity={0.45}
        scale={20}
        blur={2.5}
        far={9}
      />
      <Grid
        position={[0, -6.82, 0]}
        args={[22, 22]}
        cellSize={0.6}
        cellThickness={0.5}
        cellColor="#1e293b"
        sectionSize={2.4}
        sectionThickness={1}
        sectionColor="#334155"
        fadeDistance={28}
        fadeStrength={1}
        followCamera={false}
      />
      <OrbitControls
        makeDefault
        enablePan
        enableZoom
        minDistance={5}
        maxDistance={28}
        minPolarAngle={0.15}
        maxPolarAngle={Math.PI / 1.85}
      />
    </Canvas>
  );
}
