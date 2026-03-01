/**
 * VisorCanvas.jsx
 * Visor 3D — 5 fases claras con geometría realista:
 *
 *  Fase 1 (0–24%)   Bloque en bruto — dos maderos sólidos apilados (arriba/abajo)
 *  Fase 2 (25–49%)  Trazado — contorno rojo punteado + sombreado 3D de la zona a retirar
 *  Fase 3 (50–79%)  Pieza cortada — ya no es un bloque: geometría CSG limpia
 *  Fase 4 (80–99%)  Ensamblaje — la pieza de arriba baja a encajar con la de abajo
 *  Fase 5 (100%)    Ensamblado — modelo STL completo con brillo ambarino + cotas
 *
 * Las fases 1–4 usan SOLO geometría procedural → nunca hay duplicidad de piezas.
 * El STL aparece únicamente en la fase 5 (sin clipping).
 */

import React, { useRef, useMemo, useEffect, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, ContactShadows, Grid, Html } from '@react-three/drei';
import { useLoader, useFrame } from '@react-three/fiber';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';

// ── Límites de fase ─────────────────────────────────────────────────────────
const FASE_TRAZADO  = 25;
const FASE_CORTADO  = 50;
const FASE_ENSAMBLE = 80;

// ── Materiales base ─────────────────────────────────────────────────────────
const COLOR_A = '#c8922a';
const COLOR_B = '#8b5e1a';
const MAT_A = new THREE.MeshStandardMaterial({ color: COLOR_A, roughness: 0.85, metalness: 0.02 });
const MAT_B = new THREE.MeshStandardMaterial({ color: COLOR_B, roughness: 0.90, metalness: 0.02 });

// ── Evaluador CSG (instancia única reutilizable) ─────────────────────────────
const CSG = new Evaluator();

// ══════════════════════════════════════════════════════════════════════════
// Configuración de geometría por familia de junta
// ══════════════════════════════════════════════════════════════════════════

function getFamiliaConfig(familia) {
  switch (familia) {
    case 'caja-espiga':
      return {
        bloqueA: [3.2, 5.0, 2.5],
        bloqueB: [3.2, 5.0, 2.5],
        eliminarA: [{ args: [1.1, 2.8, 1.5], pos: [0, 0, 0] }],
        eliminarB: [
          { args: [1.0, 2.7, 1.4], pos: [0,  0.0, 1.4] },
          { args: [1.1, 1.1, 2.5], pos: [0,  1.5, 0]   },
          { args: [1.1, 1.1, 2.5], pos: [0, -1.5, 0]   },
        ],
      };
    case 'tarugo':
      return {
        bloqueA: [3.5, 4.5, 2.5],
        bloqueB: [3.5, 4.5, 2.5],
        eliminarA: [
          { args: [0.5, 0.5, 1.2], pos: [0,  0.9, 0] },
          { args: [0.5, 0.5, 1.2], pos: [0, -0.9, 0] },
        ],
        eliminarB: [
          { args: [0.5, 0.5, 1.2], pos: [0,  0.9, 0] },
          { args: [0.5, 0.5, 1.2], pos: [0, -0.9, 0] },
        ],
      };
    case 'horquilla':
      return {
        bloqueA: [3.5, 4.5, 2.5],
        bloqueB: [3.5, 4.5, 2.5],
        eliminarA: [{ args: [1.2, 1.8, 2.5], pos: [0, 0, 0] }],
        eliminarB: [
          { args: [1.05, 2.5, 2.5], pos: [-1.0, 0, 0] },
          { args: [1.05, 2.5, 2.5], pos: [ 1.0, 0, 0] },
        ],
      };
    case 'media-madera':
      return {
        bloqueA: [4.0, 4.0, 2.5],
        bloqueB: [4.0, 4.0, 2.5],
        eliminarA: [{ args: [4.0, 2.0, 1.3], pos: [0,  1.0, 0.6] }],
        eliminarB: [{ args: [4.0, 2.0, 1.3], pos: [0, -1.0, 0.6] }],
      };
    case 'cola-milano':
      return {
        bloqueA: [3.5, 5.0, 2.5],
        bloqueB: [3.5, 5.0, 2.5],
        eliminarA: [{ args: [1.4, 3.2, 1.5], pos: [0, 0, 0] }],
        eliminarB: [
          { args: [0.8, 1.2, 2.5], pos: [-0.9, 0, 0] },
          { args: [0.8, 1.2, 2.5], pos: [ 0.9, 0, 0] },
        ],
      };
    case 'machihembrada':
    default:
      return {
        bloqueA: [4.0, 2.5, 3.0],
        bloqueB: [4.0, 2.5, 3.0],
        eliminarA: [{ args: [4.0, 0.6, 1.0], pos: [0, 0,  0.5] }],
        eliminarB: [{ args: [4.0, 0.55, 1.0], pos: [0, 0, -0.5] }],
      };
  }
}

// ══════════════════════════════════════════════════════════════════════════
// CSG: construye la geometría resultante después de los cortes
// ══════════════════════════════════════════════════════════════════════════

function buildCortadaGeo(dims, eliminar) {
  try {
    let brush = new Brush(new THREE.BoxGeometry(...dims));
    brush.updateMatrixWorld();

    for (const zona of eliminar) {
      const cut = new Brush(new THREE.BoxGeometry(...zona.args));
      cut.position.set(...zona.pos);
      cut.updateMatrixWorld();
      brush = CSG.evaluate(brush, cut, SUBTRACTION);
      brush.updateMatrixWorld();
    }

    const geo = brush.geometry.clone();
    geo.computeVertexNormals();
    return geo;
  } catch {
    // fallback al bloque completo si CSG falla
    const geo = new THREE.BoxGeometry(...dims);
    geo.computeVertexNormals();
    return geo;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// Fase 2 — Contorno rojo punteado + sombreado 3D de la zona a retirar
// ══════════════════════════════════════════════════════════════════════════

function ZonaTrazado({ args, pos, opacity }) {
  const lsRef = useRef();

  const edgesGeo = useMemo(() => {
    const box = new THREE.BoxGeometry(...args);
    return new THREE.EdgesGeometry(box);
  }, [args[0], args[1], args[2]]);

  // LineDashedMaterial necesita que el objeto LineSegments compute distancias
  useEffect(() => {
    if (lsRef.current) lsRef.current.computeLineDistances();
  }, [edgesGeo]);

  if (opacity < 0.01) return null;

  return (
    <group position={pos}>
      {/* Relleno rojo semitransparente — sombreado 3D */}
      <mesh renderOrder={1}>
        <boxGeometry args={args} />
        <meshStandardMaterial
          color="#ef4444" transparent opacity={opacity * 0.50}
          emissive="#dc2626" emissiveIntensity={0.80}
          depthWrite={false} side={THREE.DoubleSide}
        />
      </mesh>

      {/* Contorno punteado rojo */}
      <lineSegments ref={lsRef} geometry={edgesGeo} renderOrder={2}>
        <lineDashedMaterial
          color="#ff1111" dashSize={0.14} gapSize={0.09}
          transparent opacity={Math.min(1, opacity * 1.4)}
          linewidth={2}
        />
      </lineSegments>
    </group>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Pieza con bloque sólido (fases 1 y 2)
// ══════════════════════════════════════════════════════════════════════════

function PiezaSolida({ dims, eliminar, material, opTrazado }) {
  return (
    <group>
      <mesh castShadow receiveShadow material={material}>
        <boxGeometry args={dims} />
      </mesh>
      {eliminar.map((z, i) => (
        <ZonaTrazado key={i} args={z.args} pos={z.pos} opacity={opTrazado} />
      ))}
    </group>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Pieza cortada con geometría CSG real (fases 3 y 4)
// ══════════════════════════════════════════════════════════════════════════

function PiezaCortada({ familia, pieza, color }) {
  const geo = useMemo(() => {
    const cfg = getFamiliaConfig(familia);
    const dims    = pieza === 'A' ? cfg.bloqueA    : cfg.bloqueB;
    const eliminar = pieza === 'A' ? cfg.eliminarA : cfg.eliminarB;
    return buildCortadaGeo(dims, eliminar);
  }, [familia, pieza]);

  return (
    <mesh castShadow receiveShadow geometry={geo}>
      <meshStandardMaterial color={color} roughness={0.82} metalness={0.03} />
    </mesh>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Componente principal de bloques — maneja todas las fases 0–99%
// ══════════════════════════════════════════════════════════════════════════

function BloquesAnimados({ familia, progreso }) {
  const cfg = getFamiliaConfig(familia);

  // Transiciones suaves
  const tTrazado = progreso >= FASE_TRAZADO
    ? Math.min(1, (progreso - FASE_TRAZADO) / 8) : 0;
  const tCortado = progreso >= FASE_CORTADO
    ? Math.min(1, (progreso - FASE_CORTADO) / 6) : 0;
  const tUnion   = progreso >= FASE_ENSAMBLE
    ? Math.min(1, (progreso - FASE_ENSAMBLE) / (100 - FASE_ENSAMBLE)) : 0;

  // En fase cortado el trazado desaparece
  const opTrazado = tCortado > 0 ? 0 : tTrazado * 0.9;
  const mostrarSolido  = tCortado < 1;     // 0-99% de la transición a cortado
  const mostrarCortado = tCortado > 0;     // una vez iniciado el corte

  // Gap en eje Y que se cierra durante la unión
  const gap = 1.0 * (1 - tUnion);
  const yA  = -(gap / 2 + cfg.bloqueA[1] / 2);
  const yB  = +(gap / 2 + cfg.bloqueB[1] / 2);

  return (
    <group>
      {/* ── Pieza A — abajo ── */}
      <group position={[0, yA, 0]}>
        {/* Bloque sólido: visible en fases 1 y 2 */}
        {mostrarSolido && (
          <group opacity={1 - tCortado}>
            <PiezaSolida
              dims={cfg.bloqueA} eliminar={cfg.eliminarA}
              material={MAT_A} opTrazado={opTrazado}
            />
          </group>
        )}
        {/* Pieza cortada CSG: aparece en fases 3 y 4 */}
        {mostrarCortado && (
          <PiezaCortada familia={familia} pieza="A" color={COLOR_A} />
        )}
      </group>

      {/* ── Pieza B — arriba (desciende en fase 4) ── */}
      <group position={[0, yB, 0]}>
        {mostrarSolido && (
          <group>
            <PiezaSolida
              dims={cfg.bloqueB} eliminar={cfg.eliminarB}
              material={MAT_B} opTrazado={opTrazado}
            />
          </group>
        )}
        {mostrarCortado && (
          <PiezaCortada familia={familia} pieza="B" color={COLOR_B} />
        )}
      </group>
    </group>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Fase 5 (100%): modelo STL completo + glow + cotas opcionales
// ══════════════════════════════════════════════════════════════════════════

function STLEnsamblado({ url, mostrarCotas, tolerancias }) {
  const rawGeo = useLoader(STLLoader, url);

  const geometry = useMemo(() => {
    const geo = rawGeo.clone();
    geo.computeBoundingBox();
    geo.center();
    const size = new THREE.Vector3();
    geo.boundingBox.getSize(size);
    const escala = 5.2 / Math.max(size.x, size.y, size.z);
    geo.scale(escala, escala, escala);
    geo.computeBoundingBox();
    geo.computeVertexNormals();
    return geo;
  }, [rawGeo]);

  const bbox = geometry.boundingBox;
  const matRef = useRef();

  useFrame(({ clock }) => {
    if (matRef.current) {
      matRef.current.emissiveIntensity = 0.22 + Math.sin(clock.getElapsedTime() * 2.5) * 0.13;
    }
  });

  return (
    <group>
      <mesh castShadow receiveShadow geometry={geometry}>
        <meshStandardMaterial
          ref={matRef}
          color="#c8922a" roughness={0.55} metalness={0.1}
          emissive="#c8922a" emissiveIntensity={0.3}
        />
      </mesh>

      {/* Cotas y tolerancias */}
      {mostrarCotas && tolerancias?.map((tol, i) => {
        const angle = (i / tolerancias.length) * Math.PI - Math.PI / 4;
        const r = (bbox.max.x - bbox.min.x) * 0.7 + 1.5;
        return (
          <Html
            key={i}
            position={[Math.cos(angle) * r, bbox.max.y * 0.4 - i * 1.4, Math.sin(angle) * r]}
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

function LoadingFallback() {
  const meshRef = useRef();
  useFrame(({ clock }) => {
    if (meshRef.current) meshRef.current.rotation.y = clock.getElapsedTime() * 0.9;
  });
  return (
    <mesh ref={meshRef}>
      <octahedronGeometry args={[1.4, 0]} />
      <meshStandardMaterial color="#c8922a" wireframe opacity={0.6} transparent />
    </mesh>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Componente público
// ══════════════════════════════════════════════════════════════════════════

export default function VisorCanvas({ modelo, progreso, mostrarCotas }) {
  if (!modelo) return null;

  const ensamblado = progreso >= 100;

  return (
    <Canvas camera={{ position: [5, 3, 10], fov: 44 }} shadows gl={{ antialias: true }}>
      <color attach="background" args={['#0f172a']} />

      <ambientLight intensity={0.38} />
      <directionalLight
        position={[6, 10, 6]} intensity={1.5} castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-8} shadow-camera-right={8}
        shadow-camera-top={8}  shadow-camera-bottom={-8}
      />
      <directionalLight position={[-5, 4, -5]} intensity={0.3} color="#a0c4ff" />
      <pointLight position={[0, 8, 0]} intensity={0.4} color="#fff5e0" />

      {/* Fases 1–4: dos piezas procedurales, jamás duplicadas */}
      {!ensamblado && (
        <BloquesAnimados familia={modelo.familia} progreso={progreso} />
      )}

      {/* Fase 5: STL completo unido, sin clipping */}
      {ensamblado && (
        <Suspense fallback={<LoadingFallback />}>
          <STLEnsamblado
            url={modelo.stl}
            mostrarCotas={mostrarCotas}
            tolerancias={modelo.tolerancias}
          />
        </Suspense>
      )}

      <ContactShadows position={[0, -6.5, 0]} opacity={0.45} scale={18} blur={2.5} far={8} />
      <Grid
        position={[0, -6.52, 0]} args={[20, 20]}
        cellSize={0.6} cellThickness={0.5} cellColor="#1e293b"
        sectionSize={2.4} sectionThickness={1} sectionColor="#334155"
        fadeDistance={26} fadeStrength={1} followCamera={false}
      />
      <OrbitControls
        makeDefault enablePan enableZoom
        minDistance={4} maxDistance={24}
        minPolarAngle={0.15} maxPolarAngle={Math.PI / 1.85}
      />
    </Canvas>
  );
}
