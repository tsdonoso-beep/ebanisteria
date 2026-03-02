/**
 * VisorCanvas.jsx — Simulador 3D de Ensambles
 * ─────────────────────────────────────────────────────────────────────────
 * Muestra las 2 piezas de cada unión directamente desde el STL.
 * Línea de tiempo de 2 fases:
 *   0%   → Piezas separadas (se ve claramente cada pieza)
 *   100% → Piezas ensambladas (unión completa)
 *
 * Algoritmo:
 *   1. Cargar STL (contiene las 2 piezas como una sola malla)
 *   2. Detectar componentes conectados con Union-Find
 *   3. Separar en 2 geometrías independientes
 *   4. Animar desde posición separada → posición ensamblada
 * ─────────────────────────────────────────────────────────────────────────
 */

import React, { useRef, useMemo, Suspense } from 'react';
import { Canvas, useLoader, useFrame } from '@react-three/fiber';
import { OrbitControls, ContactShadows, Grid, Html } from '@react-three/drei';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';

// ── Colores madera ─────────────────────────────────────────────────────────
const COL_A = '#c8922a';   // madera clara (pieza inferior)
const COL_B = '#8b5e1a';   // madera oscura (pieza superior)

// Amplitud de separación en unidades de escena
const SEP = 2.6;

// ══════════════════════════════════════════════════════════════════════════
// SPLIT STL — Detectar componentes conectados con Union-Find
// Agrupa los triángulos de la malla por adyacencia de vértices compartidos.
// Devuelve las 2 geometrías más grandes como piezas independientes.
// ══════════════════════════════════════════════════════════════════════════

function splitMeshByComponents(geometry) {
  const pos   = geometry.attributes.position;
  const nVert = pos.count; // 3 vértices × número de triángulos

  // ── Paso 1: Unir vértices con la misma posición (tolerancia 0.001) ──
  // Mapa "x,y,z" → índice canónico
  const posMap = new Map();
  const canon  = new Int32Array(nVert);

  for (let i = 0; i < nVert; i++) {
    const kx = Math.round(pos.getX(i) * 1000);
    const ky = Math.round(pos.getY(i) * 1000);
    const kz = Math.round(pos.getZ(i) * 1000);
    const key = `${kx},${ky},${kz}`;
    if (posMap.has(key)) {
      canon[i] = posMap.get(key);
    } else {
      posMap.set(key, i);
      canon[i] = i;
    }
  }

  // ── Paso 2: Union-Find sobre índices canónicos ──
  const parent = Int32Array.from({ length: nVert }, (_, i) => i);

  function find(a) {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  }
  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  const numTris = Math.floor(nVert / 3);
  for (let t = 0; t < numTris; t++) {
    const v0 = canon[t * 3];
    const v1 = canon[t * 3 + 1];
    const v2 = canon[t * 3 + 2];
    union(v0, v1);
    union(v1, v2);
  }

  // ── Paso 3: Agrupar triángulos por componente raíz ──
  const groups = new Map();
  for (let t = 0; t < numTris; t++) {
    const root = find(canon[t * 3]);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(t);
  }

  // Ordenar de mayor a menor
  const sorted = [...groups.values()].sort((a, b) => b.length - a.length);

  // ── Paso 4: Construir geometrías para las 2 piezas más grandes ──
  const hasNormal = !!geometry.attributes.normal;
  const geos = [];

  for (let g = 0; g < Math.min(2, sorted.length); g++) {
    const tris   = sorted[g];
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
    geos.push(geo);
  }

  return geos;
}

// ══════════════════════════════════════════════════════════════════════════
// STLPiezasUnion — Carga, divide y anima las 2 piezas del STL
// ══════════════════════════════════════════════════════════════════════════

function STLPiezasUnion({ url, progreso, mostrarCotas, tolerancias }) {
  const rawGeo = useLoader(STLLoader, url);
  const matBRef = useRef();

  const { geoA, geoB, sepVec } = useMemo(() => {
    // ── Normalizar geometría completa ──────────────────────────────────
    const geo = rawGeo.clone();
    geo.computeBoundingBox();
    geo.center();
    const size = new THREE.Vector3();
    geo.boundingBox.getSize(size);
    const escala = 5.5 / Math.max(size.x, size.y, size.z);
    geo.scale(escala, escala, escala);
    geo.computeVertexNormals();

    // ── Dividir en 2 piezas ─────────────────────────────────────────────
    const partes = splitMeshByComponents(geo);

    if (partes.length < 2) {
      // Solo 1 componente — fallback: mostrar el STL completo
      partes[0].computeBoundingBox();
      return { geoA: partes[0], geoB: null, sepVec: new THREE.Vector3(0, 1, 0) };
    }

    const [p1, p2] = partes;

    // Centros de cada pieza
    const c1 = new THREE.Vector3();
    const c2 = new THREE.Vector3();
    p1.boundingBox.getCenter(c1);
    p2.boundingBox.getCenter(c2);

    // Pieza A = la que tiene centro Y más bajo (inferior)
    const [geoA, geoB] = c1.y <= c2.y ? [p1, p2] : [p2, p1];

    // Vector de separación apunta de A hacia B (normalizado)
    const aCenter = c1.y <= c2.y ? c1 : c2;
    const bCenter = c1.y <= c2.y ? c2 : c1;
    const sepVec  = new THREE.Vector3().subVectors(bCenter, aCenter).normalize();

    return { geoA, geoB, sepVec };
  }, [rawGeo]);

  // ── Interpolación lineal: 0% separado → 100% ensamblado ──────────────
  const t = progreso / 100;
  const posA = [
    -sepVec.x * SEP * (1 - t),
    -sepVec.y * SEP * (1 - t),
    -sepVec.z * SEP * (1 - t),
  ];
  const posB = [
    sepVec.x * SEP * (1 - t),
    sepVec.y * SEP * (1 - t),
    sepVec.z * SEP * (1 - t),
  ];

  // ── Brillo de completado al 100% ──────────────────────────────────────
  useFrame(({ clock }) => {
    if (matBRef.current && progreso >= 100) {
      matBRef.current.emissiveIntensity =
        0.20 + Math.sin(clock.getElapsedTime() * 2.5) * 0.12;
    }
  });

  // Bounding box de geoA para posicionar cotas
  const bboxA = geoA?.boundingBox;

  return (
    <group>
      {/* Pieza A — inferior */}
      <mesh castShadow receiveShadow geometry={geoA} position={posA}>
        <meshStandardMaterial
          color={COL_A}
          roughness={0.68}
          metalness={0.06}
          emissive={COL_A}
          emissiveIntensity={progreso >= 100 ? 0.18 : 0}
        />
      </mesh>

      {/* Pieza B — superior */}
      {geoB && (
        <mesh castShadow receiveShadow geometry={geoB} position={posB}>
          <meshStandardMaterial
            ref={matBRef}
            color={COL_B}
            roughness={0.68}
            metalness={0.06}
            emissive={COL_B}
            emissiveIntensity={progreso >= 100 ? 0.20 : 0}
          />
        </mesh>
      )}

      {/* Cotas técnicas — solo cuando está ensamblado */}
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

// ── Indicador de carga ────────────────────────────────────────────────────
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

      <ambientLight intensity={0.40} />
      <directionalLight
        position={[6, 10, 6]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
      />
      <directionalLight position={[-5, 4, -5]} intensity={0.30} color="#a0c4ff" />
      <pointLight position={[0, 8, 0]} intensity={0.40} color="#fff5e0" />

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
