/**
 * VisorCanvas.jsx — Simulador 3D de Ensambles de Ebanistería
 * ─────────────────────────────────────────────────────────────────────────
 * Lógica de ensamble por tipo de junta (configurada en catalogoData.js):
 *
 *  axis: 'y'  — Pieza B desciende en Y e ingresa en pieza A
 *               (caja-espiga, horquilla, cola-de-milano, machihembrada,
 *                empalmes a horquilla)
 *
 *  axis: 'x'  — Pieza B desliza en X hacia la posición final (sin penetrar
 *               desde arriba). Corrección Y automática para alinear la cara
 *               superior de ambas piezas antes de la animación.
 *               (media-madera ensambles N4, N8, N9)
 *
 *  allComps: true — Se muestran TODOS los componentes del STL (p.ej. tarugos).
 *               Los componentes auxiliares (tarugos/clavijas) se agrupan con
 *               la pieza superior y se animan juntos.
 *               (tarugo N1, junta-tarugo N6)
 *
 *  penetration — Fracción de min(hA,hB) que B penetra en A al 100%.
 *               0 = solo se tocan; 0.5 = mitad dentro; 0.8 = casi completo.
 * ─────────────────────────────────────────────────────────────────────────
 */

import React, { useRef, useMemo, Suspense } from 'react';
import { Canvas, useLoader, useFrame } from '@react-three/fiber';
import { OrbitControls, ContactShadows, Grid, Html } from '@react-three/drei';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';

// ── Paleta de colores madera ──────────────────────────────────────────────
const COL_A     = '#c8922a';   // tabla inferior / receptora (madera clara)
const COL_B     = '#7b4f1a';   // tabla superior / insertada  (madera oscura)
const COL_AUX   = '#b07840';   // tarugos / clavijas (tono intermedio)

// ── Separación extra al 0% (unidades de escena) ───────────────────────────
const SEP = 2.5;

// ══════════════════════════════════════════════════════════════════════════
// splitMeshByComponents
// Detecta componentes conectados (Union-Find) y devuelve TODAS las
// geometrías ordenadas por VOLUMEN de bounding-box (desc).
// → Las 2 piezas principales siempre quedan primero; los tarugos/clavijas
//   (volumen mucho menor) quedan al final.
// ══════════════════════════════════════════════════════════════════════════

function splitMeshByComponents(geometry) {
  const pos   = geometry.attributes.position;
  const nVert = pos.count;

  // Paso 1: mapa posición → índice canónico
  const posMap = new Map();
  const canon  = new Int32Array(nVert);
  for (let i = 0; i < nVert; i++) {
    const key = `${Math.round(pos.getX(i)*1000)},${Math.round(pos.getY(i)*1000)},${Math.round(pos.getZ(i)*1000)}`;
    if (posMap.has(key)) { canon[i] = posMap.get(key); }
    else { posMap.set(key, i); canon[i] = i; }
  }

  // Paso 2: Union-Find
  const parent = Int32Array.from({ length: nVert }, (_, i) => i);
  function find(a) {
    while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
  }
  const numTris = Math.floor(nVert / 3);
  for (let t = 0; t < numTris; t++) {
    const ra = find(canon[t*3]), rb = find(canon[t*3+1]), rc = find(canon[t*3+2]);
    if (ra !== rb) parent[ra] = rb;
    if (find(rb) !== rc) parent[find(rb)] = rc;
  }

  // Paso 3: agrupar triángulos por raíz
  const groups = new Map();
  for (let t = 0; t < numTris; t++) {
    const root = find(canon[t*3]);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(t);
  }

  // Paso 4: construir geometrías
  const hasN = !!geometry.attributes.normal;
  const allGeos = [];
  for (const tris of groups.values()) {
    const vCount = tris.length * 3;
    const pArr   = new Float32Array(vCount * 3);
    const nArr   = new Float32Array(vCount * 3);
    for (let vi = 0; vi < vCount; vi++) {
      const orig = tris[Math.floor(vi/3)]*3 + (vi%3);
      pArr[vi*3]   = pos.getX(orig); pArr[vi*3+1] = pos.getY(orig); pArr[vi*3+2] = pos.getZ(orig);
      if (hasN) {
        const n = geometry.attributes.normal;
        nArr[vi*3] = n.getX(orig); nArr[vi*3+1] = n.getY(orig); nArr[vi*3+2] = n.getZ(orig);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pArr, 3));
    if (hasN) geo.setAttribute('normal', new THREE.BufferAttribute(nArr, 3));
    else geo.computeVertexNormals();
    geo.computeBoundingBox();
    allGeos.push(geo);
  }

  // Paso 5: ordenar por VOLUMEN de bbox (desc) — las piezas principales quedan primero
  const sv = new THREE.Vector3();
  allGeos.sort((a, b) => {
    a.boundingBox.getSize(sv); const va = sv.x*sv.y*sv.z;
    b.boundingBox.getSize(sv); const vb = sv.x*sv.y*sv.z;
    return vb - va;
  });
  return allGeos;
}

// ══════════════════════════════════════════════════════════════════════════
// STLPiezasUnion
// ══════════════════════════════════════════════════════════════════════════

function STLPiezasUnion({ url, progreso, mostrarCotas, tolerancias, ensamble = {} }) {
  const { axis = 'y', penetration = 0.5, allComps = false } = ensamble;

  const rawGeo  = useLoader(STLLoader, url);
  const matBRef = useRef();

  // ── Preprocesar geometría y calcular offset de ensamble ──────────────
  const state = useMemo(() => {
    // Normalizar: centrar y escalar a ~5.5 unidades
    const geo = rawGeo.clone();
    geo.computeBoundingBox();
    geo.center();
    const sz = new THREE.Vector3();
    geo.boundingBox.getSize(sz);
    const escala = 5.5 / Math.max(sz.x, sz.y, sz.z);
    geo.scale(escala, escala, escala);
    geo.computeVertexNormals();

    const partes = splitMeshByComponents(geo);

    // ── Caso de 1 solo componente (N11: ya ensamblado) ────────────────
    if (partes.length < 2) {
      return { geoA: partes[0], upperGroup: [], assembled: { x: 0, y: 0 } };
    }

    // ── Las 2 piezas principales son siempre las de mayor volumen ─────
    // (el orden por volumen desc las pone primero)
    const p1 = partes[0], p2 = partes[1];
    const cy1 = (p1.boundingBox.min.y + p1.boundingBox.max.y) / 2;
    const cy2 = (p2.boundingBox.min.y + p2.boundingBox.max.y) / 2;

    // geoA = pieza con centro Y más bajo (receptora / inferior)
    const [geoA, geoB] = cy1 <= cy2 ? [p1, p2] : [p2, p1];

    // ── Componentes auxiliares (tarugos/clavijas) ─────────────────────
    // Se animan junto con geoB (grupo superior)
    const midY   = (geoA.boundingBox.max.y + geoB.boundingBox.min.y) / 2;
    const auxGeos = allComps
      ? partes.slice(2).filter(g => {
          const cy = (g.boundingBox.min.y + g.boundingBox.max.y) / 2;
          return cy > midY;
        })
      : [];

    // ── Calcular posición de ensamble ─────────────────────────────────
    const gapY   = geoB.boundingBox.min.y - geoA.boundingBox.max.y;
    const hA     = geoA.boundingBox.max.y - geoA.boundingBox.min.y;
    const hB     = geoB.boundingBox.max.y - geoB.boundingBox.min.y;
    const penDist = Math.min(hA, hB) * penetration;

    let assembled;
    if (axis === 'x') {
      // Alinear TOPS: la cara superior de B coincide con la cara superior de A.
      // No hay penetración en Y; B deslizará lateralmente.
      assembled = {
        x: 0,
        y: -(geoB.boundingBox.max.y - geoA.boundingBox.max.y),
      };
    } else {
      // B desciende en Y: cierra gap + penetra penDist
      assembled = {
        x: 0,
        y: -(gapY + penDist),
      };
    }

    return { geoA, upperGroup: [geoB, ...auxGeos], assembled };
  }, [rawGeo, axis, penetration, allComps]);

  const { geoA, upperGroup, assembled } = state;
  const t = progreso / 100;

  // ── Posición de geoA: siempre fija ────────────────────────────────────
  const posA = [0, 0, 0];

  // ── Posición del grupo superior ───────────────────────────────────────
  // axis='y': B viaja desde (assembled.y + SEP) hasta assembled.y
  // axis='x': B viaja en X desde +SEP hasta 0 (Y corregida desde inicio)
  const posB = axis === 'x'
    ? [SEP * (1 - t), assembled.y, 0]
    : [0, assembled.y + SEP * (1 - t), 0];

  // ── Brillo al completar el ensamble ──────────────────────────────────
  useFrame(({ clock }) => {
    if (matBRef.current) {
      matBRef.current.emissiveIntensity = progreso >= 100
        ? 0.18 + Math.sin(clock.getElapsedTime() * 2.5) * 0.10
        : 0;
    }
  });

  const bboxA = geoA?.boundingBox;

  return (
    <group>
      {/* Pieza A — fija (receptora / inferior) */}
      <mesh castShadow receiveShadow geometry={geoA} position={posA}>
        <meshStandardMaterial
          color={COL_A} roughness={0.70} metalness={0.05}
          emissive={COL_A} emissiveIntensity={progreso >= 100 ? 0.15 : 0}
        />
      </mesh>

      {/* Grupo superior — geoB + componentes auxiliares (tarugos, etc.) */}
      {upperGroup.map((geo, i) => (
        <mesh key={i} castShadow receiveShadow geometry={geo} position={posB}>
          <meshStandardMaterial
            ref={i === 0 ? matBRef : undefined}
            color={i === 0 ? COL_B : COL_AUX}
            roughness={0.70} metalness={0.05}
            emissive={i === 0 ? COL_B : COL_AUX}
            emissiveIntensity={0}
          />
        </mesh>
      ))}

      {/* Cotas técnicas — solo al ensamblar */}
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
            distanceFactor={8} center
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
        position={[6, 10, 6]} intensity={1.6} castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-8} shadow-camera-right={8}
        shadow-camera-top={8}  shadow-camera-bottom={-8}
      />
      <directionalLight position={[-5, 4, -5]} intensity={0.30} color="#a0c4ff" />
      <pointLight position={[0, 8, 0]} intensity={0.35} color="#fff5e0" />

      <Suspense fallback={<LoadingFallback />}>
        <STLPiezasUnion
          url={modelo.stl}
          progreso={progreso}
          mostrarCotas={mostrarCotas}
          tolerancias={modelo.tolerancias}
          ensamble={modelo.ensamble}
        />
      </Suspense>

      <ContactShadows position={[0,-6.8,0]} opacity={0.45} scale={20} blur={2.5} far={9} />
      <Grid
        position={[0,-6.82,0]} args={[22,22]}
        cellSize={0.6} cellThickness={0.5} cellColor="#1e293b"
        sectionSize={2.4} sectionThickness={1} sectionColor="#334155"
        fadeDistance={28} fadeStrength={1} followCamera={false}
      />
      <OrbitControls
        makeDefault enablePan enableZoom
        minDistance={5} maxDistance={28}
        minPolarAngle={0.15} maxPolarAngle={Math.PI / 1.85}
      />
    </Canvas>
  );
}
