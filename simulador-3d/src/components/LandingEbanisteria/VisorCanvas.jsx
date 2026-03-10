/**
 * VisorCanvas.jsx — Simulador 3D con control manual por teclado
 * ─────────────────────────────────────────────────────────────────────────
 * La pieza B se mueve libremente con WASD + HJ.
 * La pieza A permanece estática.
 *
 *  Movimiento pieza B:
 *    W → +Y (arriba)      S → -Y (abajo)
 *    A → -X (izquierda)   D → +X (derecha)
 *    H → +Z (adelante)    J → -Z (atrás)
 *
 *  Cámara: ratón / trackpad (OrbitControls)
 *
 *  El movimiento es fluido gracias a delta-time en useFrame.
 * ─────────────────────────────────────────────────────────────────────────
 */

import React, { useRef, useMemo, useEffect, Suspense } from 'react';
import { Canvas, useLoader, useFrame } from '@react-three/fiber';
import { OrbitControls, ContactShadows, Grid, Html } from '@react-three/drei';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';

// ── Colores ────────────────────────────────────────────────────────────────
const COL_A   = '#c8922a';   // pieza A — madera clara (fija)
const COL_B   = '#7b4f1a';   // pieza B — madera oscura (movible)
const COL_AUX = '#b07840';   // tarugos / clavijas

// ── Velocidades ─────────────────────────────────────────────────────────────
const MOVE_SPEED = 3.0;    // unidades / segundo

// ── Separación inicial de la pieza B respecto a A ──────────────────────────
const SEP = 2.8;

// ══════════════════════════════════════════════════════════════════════════
// Union-Find para detectar componentes conectados
// ══════════════════════════════════════════════════════════════════════════

function splitMeshByComponents(geometry) {
  const pos   = geometry.attributes.position;
  const nVert = pos.count;

  const posMap = new Map();
  const canon  = new Int32Array(nVert);
  for (let i = 0; i < nVert; i++) {
    const key = `${Math.round(pos.getX(i)*1000)},${Math.round(pos.getY(i)*1000)},${Math.round(pos.getZ(i)*1000)}`;
    if (posMap.has(key)) { canon[i] = posMap.get(key); }
    else { posMap.set(key, i); canon[i] = i; }
  }

  const parent = Int32Array.from({ length: nVert }, (_, i) => i);
  function find(a) {
    while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
  }
  const numTris = Math.floor(nVert / 3);
  for (let t = 0; t < numTris; t++) {
    const ra = find(canon[t*3]), rb = find(canon[t*3+1]), rc = find(canon[t*3+2]);
    if (ra !== rb) parent[ra] = rb;
    const rbc = find(canon[t*3+1]);
    if (rbc !== rc) parent[rbc] = rc;
  }

  const groups = new Map();
  for (let t = 0; t < numTris; t++) {
    const root = find(canon[t*3]);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(t);
  }

  const hasN   = !!geometry.attributes.normal;
  const allGeos = [];
  for (const tris of groups.values()) {
    const vCount = tris.length * 3;
    const pArr   = new Float32Array(vCount * 3);
    const nArr   = new Float32Array(vCount * 3);
    for (let vi = 0; vi < vCount; vi++) {
      const orig = tris[Math.floor(vi/3)]*3 + (vi%3);
      pArr[vi*3] = pos.getX(orig); pArr[vi*3+1] = pos.getY(orig); pArr[vi*3+2] = pos.getZ(orig);
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

  // Ordenar por volumen de bounding-box (piezas grandes primero, tarugos al final)
  const sv = new THREE.Vector3();
  allGeos.sort((a, b) => {
    a.boundingBox.getSize(sv); const va = sv.x*sv.y*sv.z;
    b.boundingBox.getSize(sv); const vb = sv.x*sv.y*sv.z;
    return vb - va;
  });
  return allGeos;
}

// ══════════════════════════════════════════════════════════════════════════
// Corte geométrico: divide una malla por el punto medio de un eje dado.
// Se usa como fallback cuando Union-Find no puede separar los componentes
// (pieza con geometría internamente conectada, como N11).
// ══════════════════════════════════════════════════════════════════════════

function splitMeshGeometrically(geometry, axis) {
  const ai = { x: 0, y: 1, z: 2 }[axis];
  const pos = geometry.attributes.position;
  const nTris = Math.floor(pos.count / 3);
  const hasN  = !!geometry.attributes.normal;

  // Encontrar el punto medio del eje
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const v = ai === 0 ? pos.getX(i) : ai === 1 ? pos.getY(i) : pos.getZ(i);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const mid = (lo + hi) / 2;

  const trisA = [], trisB = [];
  for (let t = 0; t < nTris; t++) {
    const get = (i) => ai === 0 ? pos.getX(i) : ai === 1 ? pos.getY(i) : pos.getZ(i);
    const c = (get(t*3) + get(t*3+1) + get(t*3+2)) / 3;
    if (c <= mid) trisA.push(t); else trisB.push(t);
  }

  function buildGeo(tris) {
    const pArr = new Float32Array(tris.length * 9);
    const nArr = hasN ? new Float32Array(tris.length * 9) : null;
    for (let vi = 0; vi < tris.length * 3; vi++) {
      const orig = tris[Math.floor(vi/3)] * 3 + (vi % 3);
      pArr[vi*3]   = pos.getX(orig);
      pArr[vi*3+1] = pos.getY(orig);
      pArr[vi*3+2] = pos.getZ(orig);
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
    return geo;
  }

  return [buildGeo(trisA), buildGeo(trisB)];
}

// ══════════════════════════════════════════════════════════════════════════
// PiezasManual — pieza A fija + pieza B controlada con teclado
// ══════════════════════════════════════════════════════════════════════════

function PiezasManual({ url, mostrarCotas, tolerancias, ensamble = {}, triggerReset }) {
  const {
    axis          = 'y',
    allComps      = false,
    auxInBase     = false,   // tarugos quedan en la base estática
    geoSplit      = false,   // usar corte geométrico si Union-Find no separa
    holePositions = null,    // [{x,z}] posiciones de orificios en coordenadas STL originales
  } = ensamble;

  const rawGeo    = useLoader(STLLoader, url);
  const groupBRef = useRef();

  // Posición actual de la pieza B (ref para no causar re-renders)
  const posB = useRef(new THREE.Vector3());

  // Estado de teclas presionadas
  const keys = useRef({});

  // ── Geometrías y posición inicial ─────────────────────────────────────
  const { geoA, auxBase, upperGroup, startPos } = useMemo(() => {
    const geo = rawGeo.clone();
    geo.computeBoundingBox();

    // Guardar centro y escala ANTES de transformar, para convertir coords STL → escena
    const origCenter = new THREE.Vector3();
    geo.boundingBox.getCenter(origCenter);
    const origSize = new THREE.Vector3();
    geo.boundingBox.getSize(origSize);
    const escala = 5.5 / Math.max(origSize.x, origSize.y, origSize.z);

    // Convierte coordenada (x, z) en espacio STL original a espacio escena
    const toSceneXZ = (ox, oz) => ({
      x: (ox - origCenter.x) * escala,
      z: (oz - origCenter.z) * escala,
    });

    geo.center();
    geo.scale(escala, escala, escala);
    geo.computeVertexNormals();

    // 1. Intentar separar por componentes conectados
    let partes = splitMeshByComponents(geo);

    // 2. Fallback: corte geométrico si hay 1 sola pieza y geoSplit está activo
    if (partes.length < 2 && geoSplit) {
      partes = splitMeshGeometrically(geo, axis);
    }

    // 3. Sin separación posible → mostrar pieza única estática
    if (partes.length < 2) {
      return {
        geoA: partes[0],
        auxBase: [],
        upperGroup: [],
        startPos: new THREE.Vector3(0, SEP, 0),
      };
    }

    // 4. Asignar geoA (base) y geoB (pieza móvil) por posición en el eje de ensamble
    const p1 = partes[0], p2 = partes[1];
    let geoA, geoB;

    if (axis === 'z') {
      const cz1 = (p1.boundingBox.min.z + p1.boundingBox.max.z) / 2;
      const cz2 = (p2.boundingBox.min.z + p2.boundingBox.max.z) / 2;
      [geoA, geoB] = cz1 <= cz2 ? [p1, p2] : [p2, p1];
    } else {
      const cy1 = (p1.boundingBox.min.y + p1.boundingBox.max.y) / 2;
      const cy2 = (p2.boundingBox.min.y + p2.boundingBox.max.y) / 2;
      [geoA, geoB] = cy1 <= cy2 ? [p1, p2] : [p2, p1];
    }

    // 5. Tarugos / auxiliares (componentes extra)
    const midY    = (geoA.boundingBox.max.y + geoB.boundingBox.min.y) / 2;
    const auxGeos = allComps
      ? partes.slice(2).filter(g => (g.boundingBox.min.y + g.boundingBox.max.y) / 2 > midY)
      : [];

    // 6. Posición inicial separada según eje de ensamble
    let startPos;
    if (axis === 'x') {
      const alignedY = -(geoB.boundingBox.max.y - geoA.boundingBox.max.y);
      startPos = new THREE.Vector3(SEP, alignedY, 0);
    } else if (axis === 'z') {
      startPos = new THREE.Vector3(0, 0, geoA.boundingBox.max.z + SEP);
    } else {
      startPos = new THREE.Vector3(0, geoA.boundingBox.max.y + SEP, 0);
    }

    // 7. Tarugos en base: colocarlos en los orificios de geoA
    //    - Si hay holePositions: mover cada tarugo al orificio correspondiente
    //      (ordenados por X para emparejarlos en orden izquierda→derecha)
    //    - Siempre centrar en Y para quedar mitad insertados (mitad fuera sobresale)
    if (auxInBase) {
      const targetCy = geoA.boundingBox.max.y;

      if (holePositions && holePositions.length >= auxGeos.length) {
        // Convertir posiciones de orificios a espacio escena
        const sceneHoles = holePositions
          .map(h => toSceneXZ(h.x, h.z))
          .sort((a, b) => a.x - b.x);

        // Ordenar tarugos por X también
        const sorted = [...auxGeos].sort((a, b) => {
          const acx = (a.boundingBox.min.x + a.boundingBox.max.x) / 2;
          const bcx = (b.boundingBox.min.x + b.boundingBox.max.x) / 2;
          return acx - bcx;
        });

        sorted.forEach((g, i) => {
          const hole = sceneHoles[i];
          const cx = (g.boundingBox.min.x + g.boundingBox.max.x) / 2;
          const cy = (g.boundingBox.min.y + g.boundingBox.max.y) / 2;
          const cz = (g.boundingBox.min.z + g.boundingBox.max.z) / 2;
          g.translate(hole.x - cx, targetCy - cy, hole.z - cz);
          g.computeBoundingBox();
        });
      } else {
        // Fallback: solo corregir Y (sin holePositions)
        auxGeos.forEach(g => {
          const cy = (g.boundingBox.min.y + g.boundingBox.max.y) / 2;
          g.translate(0, targetCy - cy, 0);
          g.computeBoundingBox();
        });
      }

      return { geoA, auxBase: auxGeos, upperGroup: [geoB], startPos };
    }

    return { geoA, auxBase: [], upperGroup: [geoB, ...auxGeos], startPos };
  }, [rawGeo, axis, allComps, auxInBase, geoSplit, holePositions]);

  // ── Llevar pieza B a la posición inicial ──────────────────────────────
  const applyStart = () => {
    posB.current.copy(startPos);
    if (groupBRef.current) {
      groupBRef.current.position.copy(startPos);
      groupBRef.current.rotation.set(0, 0, 0);
    }
  };

  // Inicializar al montar o cambiar modelo
  useEffect(() => { applyStart(); }, [startPos]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset externo (botón Reset de la UI)
  useEffect(() => { applyStart(); }, [triggerReset]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Listeners de teclado ──────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e) => {
      const k = e.key.toLowerCase();
      if (['w','s','a','d','h','j'].includes(k)) {
        if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
          e.preventDefault();
        }
      }
      keys.current[k] = true;
    };
    const onKeyUp = (e) => { keys.current[e.key.toLowerCase()] = false; };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup',   onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup',   onKeyUp);
    };
  }, []);

  // ── Movimiento fluido frame a frame ──────────────────────────────────
  useFrame((_, delta) => {
    const k    = keys.current;
    let moved  = false;
    const d    = Math.min(delta, 0.05);

    if (k['w']) { posB.current.y += MOVE_SPEED * d; moved = true; }
    if (k['s']) { posB.current.y -= MOVE_SPEED * d; moved = true; }
    if (k['a']) { posB.current.x -= MOVE_SPEED * d; moved = true; }
    if (k['d']) { posB.current.x += MOVE_SPEED * d; moved = true; }
    if (k['h']) { posB.current.z += MOVE_SPEED * d; moved = true; }
    if (k['j']) { posB.current.z -= MOVE_SPEED * d; moved = true; }

    if (moved && groupBRef.current) {
      groupBRef.current.position.copy(posB.current);
    }
  });

  const bboxA = geoA?.boundingBox;

  return (
    <group>
      {/* ── Pieza A — estática ─────────────────────────────────────────── */}
      <mesh castShadow receiveShadow geometry={geoA} position={[0, 0, 0]}>
        <meshStandardMaterial color={COL_A} roughness={0.70} metalness={0.05} />
      </mesh>

      {/* ── Tarugos en base — estáticos, mitad insertados en geoA ──────── */}
      {auxBase.map((geo, i) => (
        <mesh key={`base-${i}`} castShadow receiveShadow geometry={geo}>
          <meshStandardMaterial color={COL_AUX} roughness={0.65} metalness={0.05} />
        </mesh>
      ))}

      {/* ── Pieza B (+ tarugos si no están en base) — movibles ───────── */}
      <group ref={groupBRef}>
        {upperGroup.map((geo, i) => (
          <mesh key={i} castShadow receiveShadow geometry={geo}>
            <meshStandardMaterial
              color={i === 0 ? COL_B : COL_AUX}
              roughness={0.70}
              metalness={0.05}
            />
          </mesh>
        ))}
      </group>

      {/* ── Cotas técnicas ────────────────────────────────────────────── */}
      {mostrarCotas && bboxA && tolerancias?.map((tol, i) => {
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

export default function VisorCanvas({ modelo, mostrarCotas, triggerReset }) {
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
        <PiezasManual
          url={modelo.stl}
          mostrarCotas={mostrarCotas}
          tolerancias={modelo.tolerancias}
          ensamble={modelo.ensamble}
          triggerReset={triggerReset}
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
        minDistance={4} maxDistance={32}
        minPolarAngle={0.1} maxPolarAngle={Math.PI / 1.8}
      />
    </Canvas>
  );
}
