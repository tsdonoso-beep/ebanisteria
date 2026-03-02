/**
 * VisorCanvas.jsx
 * ─────────────────────────────────────────────────────────────────────────
 * Simulador 3D de fabricación — 5 fases con geometría coherente
 *
 *  Fase 1 (0–24%)   Bloque en bruto      — dos maderos sólidos apilados
 *  Fase 2 (25–49%)  Trazado              — zona a retirar: relleno rojo 3D
 *                                           + contorno punteado en AMBAS piezas
 *  Fase 3 (50–79%)  Pieza cortada        — CSG real: bloque – zonas = perfil limpio
 *  Fase 4 (80–99%)  Ensamblaje           — pieza B baja hasta encajar con A
 *  Fase 5 (100%)    Ensamblado           — STL completo + glow + cotas
 *
 * Principio de diseño:
 *  • Pieza A (abajo) tiene la zona funcional en su CARA SUPERIOR (mirando hacia B).
 *  • Pieza B (arriba) tiene la zona funcional en su CARA INFERIOR (mirando hacia A).
 *  • Al cerrar el gap ambas caras encajan lógicamente según el tipo de unión.
 *  • El STL en fase 5 confirma el resultado real.
 * ─────────────────────────────────────────────────────────────────────────
 */

import React, { useRef, useMemo, useEffect, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, ContactShadows, Grid, Html } from '@react-three/drei';
import { useLoader, useFrame } from '@react-three/fiber';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';

// ── Límites de fase ─────────────────────────────────────────────────────
const FASE_TRAZADO  = 25;
const FASE_CORTADO  = 50;
const FASE_ENSAMBLE = 80;

// ── Colores ──────────────────────────────────────────────────────────────
const COL_A = '#c8922a';   // madera clara (pieza inferior)
const COL_B = '#8b5e1a';   // madera oscura (pieza superior)

// ── Evaluador CSG (singleton) ────────────────────────────────────────────
const CSG = new Evaluator();

// ══════════════════════════════════════════════════════════════════════════
// CONFIGURACIONES POR FAMILIA
// Regla: eliminarA → cara SUPERIOR de A | eliminarB → cara INFERIOR de B
// Así, al cerrar el gap, los perfiles encajan lógicamente.
// ══════════════════════════════════════════════════════════════════════════

function getFamiliaConfig(familia) {

  switch (familia) {

    // ── Caja y Espiga (Mortise & Tenon) ──────────────────────────────────
    // A: caja (mortaja) abierta hacia arriba
    // B: espiga (tenón) que sobresale hacia abajo
    case 'caja-espiga': {
      const [BW, BH, BD] = [3.5, 5.0, 2.5];
      const [TW, TH]     = [1.2, 2.0];            // ancho y profundidad del tenón
      const SW = (BW - TW) / 2;                    // ancho de cada hombro
      const MY = BH / 2 - TH / 2;                  // centro de la mortaja en local-A
      return {
        bloqueA: [BW, BH, BD],
        bloqueB: [BW, BH, BD],
        // Mortaja: slot en la cara superior de A (va hacia adentro del bloque)
        eliminarA: [
          { args: [TW, TH, BD], pos: [0, MY, 0] },
        ],
        // Espiga: quitar hombros en la cara inferior de B (deja el tenón)
        eliminarB: [
          { args: [SW, TH, BD], pos: [-(TW / 2 + SW / 2), -MY, 0] },
          { args: [SW, TH, BD], pos: [+(TW / 2 + SW / 2), -MY, 0] },
        ],
      };
    }

    // ── Tarugo (Dowel) ───────────────────────────────────────────────────
    // A y B: perforaciones cuadradas enfrentadas que reciben el tarugo
    case 'tarugo': {
      const [BW, BH, BD] = [3.5, 4.5, 2.5];
      const [HW, HH]     = [0.65, 1.1];            // sección y profundidad del taladro
      const HY = BH / 2 - HH / 2;
      return {
        bloqueA: [BW, BH, BD],
        bloqueB: [BW, BH, BD],
        eliminarA: [
          { args: [HW, HH, HW], pos: [-0.85,  HY, 0] },
          { args: [HW, HH, HW], pos: [+0.85,  HY, 0] },
        ],
        eliminarB: [
          { args: [HW, HH, HW], pos: [-0.85, -HY, 0] },
          { args: [HW, HH, HW], pos: [+0.85, -HY, 0] },
        ],
      };
    }

    // ── Horquilla / Bridle ───────────────────────────────────────────────
    // A: horquilla (dos dientes, slot central abierto arriba)
    // B: lengüeta que entra en la horquilla desde abajo
    case 'horquilla': {
      const [BW, BH, BD] = [3.5, 5.0, 2.5];
      const [FW, FH]     = [1.1, 2.0];             // ancho ranura y profundidad
      const WS = (BW - FW) / 2;
      const FY = BH / 2 - FH / 2;
      return {
        bloqueA: [BW, BH, BD],
        bloqueB: [BW, BH, BD],
        // Ranura central en cara superior de A (deja dos dientes)
        eliminarA: [
          { args: [FW, FH, BD], pos: [0, FY, 0] },
        ],
        // Quitar flancos en cara inferior de B (deja la lengüeta)
        eliminarB: [
          { args: [WS, FH, BD], pos: [-(FW / 2 + WS / 2), -FY, 0] },
          { args: [WS, FH, BD], pos: [+(FW / 2 + WS / 2), -FY, 0] },
        ],
      };
    }

    // ── Media Madera (Half-Lap) ──────────────────────────────────────────
    // A: rebaje en cuadrante superior-derecho  →  L invertida
    // B: rebaje en cuadrante inferior-izquierdo →  L normal
    // Encajan deslizando B sobre A: las L se complementan perfectamente
    case 'media-madera': {
      const [BW, BH, BD] = [4.0, 4.0, 2.5];
      const [RW, RH]     = [BW / 2, BH / 2];       // mitad de cada dimensión
      return {
        bloqueA: [BW, BH, BD],
        bloqueB: [BW, BH, BD],
        // Quitar cuadrante superior-derecho de A
        eliminarA: [
          { args: [RW, RH, BD], pos: [+BW / 4, +BH / 4, 0] },
        ],
        // Quitar cuadrante inferior-izquierdo de B
        eliminarB: [
          { args: [RW, RH, BD], pos: [-BW / 4, -BH / 4, 0] },
        ],
      };
    }

    // ── Cola de Milano (Dovetail) ────────────────────────────────────────
    // Similar a caja-espiga pero con cola más ancha en la base
    // (Aproximación rectangular — forma trapezoidal real en STL)
    case 'cola-milano': {
      const [BW, BH, BD] = [3.5, 5.0, 2.5];
      const [TW, TH]     = [1.5, 2.0];             // cola más ancha que espiga normal
      const SW = (BW - TW) / 2;
      const CY = BH / 2 - TH / 2;
      return {
        bloqueA: [BW, BH, BD],
        bloqueB: [BW, BH, BD],
        // Caja (socket) de cola ancha en A
        eliminarA: [
          { args: [TW, TH, BD], pos: [0, CY, 0] },
        ],
        // Cola (tail) en B: hombros más pequeños dejan cola más ancha
        eliminarB: [
          { args: [SW, TH, BD], pos: [-(TW / 2 + SW / 2), -CY, 0] },
          { args: [SW, TH, BD], pos: [+(TW / 2 + SW / 2), -CY, 0] },
        ],
      };
    }

    // ── Machihembrada (Tongue & Groove) ─────────────────────────────────
    // A: ranura (hembra) en cara superior
    // B: lengüeta (macho) que sobresale hacia abajo
    case 'machihembrada':
    default: {
      const [BW, BH, BD] = [4.0, 3.5, 2.5];
      const [GW, GH]     = [0.85, 0.85];           // ancho y profundidad de la ranura
      const SW = (BW - GW) / 2;
      const GY = BH / 2 - GH / 2;
      return {
        bloqueA: [BW, BH, BD],
        bloqueB: [BW, BH, BD],
        // Ranura estrecha en cara superior de A
        eliminarA: [
          { args: [GW, GH, BD], pos: [0, GY, 0] },
        ],
        // Quitar flancos en cara inferior de B (deja la lengüeta)
        eliminarB: [
          { args: [SW, GH, BD], pos: [-(GW / 2 + SW / 2), -GY, 0] },
          { args: [SW, GH, BD], pos: [+(GW / 2 + SW / 2), -GY, 0] },
        ],
      };
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// CSG — resta las zonas al bloque y devuelve la geometría resultante
// ══════════════════════════════════════════════════════════════════════════

function buildCortadaGeo(dims, eliminar) {
  try {
    let brush = new Brush(new THREE.BoxGeometry(...dims));
    brush.updateMatrixWorld();

    for (const z of eliminar) {
      const cut = new Brush(new THREE.BoxGeometry(...z.args));
      cut.position.set(...z.pos);
      cut.updateMatrixWorld();
      brush = CSG.evaluate(brush, cut, SUBTRACTION);
      brush.updateMatrixWorld();
    }

    const geo = brush.geometry.clone();
    geo.computeVertexNormals();
    return geo;
  } catch {
    // fallback: bloque completo
    const geo = new THREE.BoxGeometry(...dims);
    geo.computeVertexNormals();
    return geo;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// FASE 2 — Contorno punteado rojo + relleno 3D de la zona a retirar
// ══════════════════════════════════════════════════════════════════════════

function ZonaTrazado({ args, pos, opacity }) {
  const lsRef = useRef();

  const edgesGeo = useMemo(() => {
    const box = new THREE.BoxGeometry(...args);
    return new THREE.EdgesGeometry(box);
  }, [args[0], args[1], args[2]]); // eslint-disable-line react-hooks/exhaustive-deps

  // LineDashedMaterial requiere computar distancias en el objeto LineSegments
  useEffect(() => {
    if (lsRef.current) lsRef.current.computeLineDistances();
  }, [edgesGeo]);

  if (opacity < 0.005) return null;

  return (
    <group position={pos}>
      {/* Relleno rojo semitransparente — sombreado 3D volumétrico */}
      <mesh renderOrder={1}>
        <boxGeometry args={args} />
        <meshStandardMaterial
          color="#ef4444"
          transparent opacity={opacity * 0.52}
          emissive="#dc2626" emissiveIntensity={0.85}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Contorno punteado rojo */}
      <lineSegments ref={lsRef} geometry={edgesGeo} renderOrder={2}>
        <lineDashedMaterial
          color="#ff1111"
          dashSize={0.13} gapSize={0.08}
          transparent opacity={Math.min(1, opacity * 1.5)}
        />
      </lineSegments>
    </group>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// FASES 1 y 2 — Bloque sólido + zonas de trazado
// ══════════════════════════════════════════════════════════════════════════

function PiezaSolida({ dims, eliminar, color, opTrazado }) {
  return (
    <group>
      <mesh castShadow receiveShadow>
        <boxGeometry args={dims} />
        <meshStandardMaterial color={color} roughness={0.85} metalness={0.02} />
      </mesh>
      {eliminar.map((z, i) => (
        <ZonaTrazado key={i} args={z.args} pos={z.pos} opacity={opTrazado} />
      ))}
    </group>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// FASES 3 y 4 — Pieza cortada con geometría CSG real
// ══════════════════════════════════════════════════════════════════════════

function PiezaCortada({ familia, pieza, color }) {
  const geo = useMemo(() => {
    const cfg      = getFamiliaConfig(familia);
    const dims     = pieza === 'A' ? cfg.bloqueA    : cfg.bloqueB;
    const eliminar = pieza === 'A' ? cfg.eliminarA  : cfg.eliminarB;
    return buildCortadaGeo(dims, eliminar);
  }, [familia, pieza]);

  return (
    <mesh castShadow receiveShadow geometry={geo}>
      <meshStandardMaterial color={color} roughness={0.80} metalness={0.04} />
    </mesh>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Orquestador de fases 0–99 %
// ══════════════════════════════════════════════════════════════════════════

function BloquesAnimados({ familia, progreso }) {
  const cfg = getFamiliaConfig(familia);

  // Transición suave del trazado
  const tTrazado = progreso >= FASE_TRAZADO
    ? Math.min(1, (progreso - FASE_TRAZADO) / 8) : 0;
  // Transición suave del cortado
  const tCortado = progreso >= FASE_CORTADO
    ? Math.min(1, (progreso - FASE_CORTADO) / 5) : 0;
  // Transición de unión
  const tUnion = progreso >= FASE_ENSAMBLE
    ? Math.min(1, (progreso - FASE_ENSAMBLE) / (100 - FASE_ENSAMBLE)) : 0;

  // El trazado desaparece al entrar en fase cortada
  const opTrazado = tCortado > 0 ? 0 : tTrazado;

  // Gap en eje Y (1.0 → 0 durante el ensamblaje)
  const gap = 1.0 * (1 - tUnion);
  const yA  = -(gap / 2 + cfg.bloqueA[1] / 2);
  const yB  = +(gap / 2 + cfg.bloqueB[1] / 2);

  // Cambio limpio de fase: sólido → cortado
  const enFaseSolida   = progreso < FASE_CORTADO;
  const enFaseCortada  = progreso >= FASE_CORTADO;

  return (
    <group>
      {/* ── Pieza A — abajo (recibe a B) ─────────────────────────────── */}
      <group position={[0, yA, 0]}>
        {enFaseSolida && (
          <PiezaSolida
            dims={cfg.bloqueA} eliminar={cfg.eliminarA}
            color={COL_A} opTrazado={opTrazado}
          />
        )}
        {enFaseCortada && (
          <PiezaCortada familia={familia} pieza="A" color={COL_A} />
        )}
      </group>

      {/* ── Pieza B — arriba (desciende durante el ensamblaje) ────────── */}
      <group position={[0, yB, 0]}>
        {enFaseSolida && (
          <PiezaSolida
            dims={cfg.bloqueB} eliminar={cfg.eliminarB}
            color={COL_B} opTrazado={opTrazado}
          />
        )}
        {enFaseCortada && (
          <PiezaCortada familia={familia} pieza="B" color={COL_B} />
        )}
      </group>
    </group>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// FASE 5 (100%) — STL completo + glow + cotas opcionales
// ══════════════════════════════════════════════════════════════════════════

function STLEnsamblado({ url, mostrarCotas, tolerancias }) {
  const rawGeo = useLoader(STLLoader, url);

  const geometry = useMemo(() => {
    const geo = rawGeo.clone();
    geo.computeBoundingBox();
    geo.center();
    const size = new THREE.Vector3();
    geo.boundingBox.getSize(size);
    const esc = 5.2 / Math.max(size.x, size.y, size.z);
    geo.scale(esc, esc, esc);
    geo.computeBoundingBox();
    geo.computeVertexNormals();
    return geo;
  }, [rawGeo]);

  const bbox   = geometry.boundingBox;
  const matRef = useRef();

  useFrame(({ clock }) => {
    if (matRef.current)
      matRef.current.emissiveIntensity = 0.22 + Math.sin(clock.getElapsedTime() * 2.5) * 0.13;
  });

  return (
    <group>
      <mesh castShadow receiveShadow geometry={geometry}>
        <meshStandardMaterial
          ref={matRef}
          color="#c8922a" roughness={0.55} metalness={0.10}
          emissive="#c8922a" emissiveIntensity={0.30}
        />
      </mesh>

      {mostrarCotas && tolerancias?.map((tol, i) => {
        const angle = (i / tolerancias.length) * Math.PI - Math.PI / 4;
        const r     = (bbox.max.x - bbox.min.x) * 0.7 + 1.5;
        return (
          <Html
            key={i}
            position={[
              Math.cos(angle) * r,
              bbox.max.y * 0.4 - i * 1.4,
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

  const ensamblado = progreso >= 100;

  return (
    <Canvas
      camera={{ position: [4, 1, 14], fov: 50 }}
      shadows
      gl={{ antialias: true }}
    >
      <color attach="background" args={['#0f172a']} />

      <ambientLight intensity={0.40} />
      <directionalLight
        position={[6, 10, 6]} intensity={1.5} castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-8} shadow-camera-right={8}
        shadow-camera-top={8}  shadow-camera-bottom={-8}
      />
      <directionalLight position={[-5, 4, -5]} intensity={0.30} color="#a0c4ff" />
      <pointLight position={[0, 8, 0]} intensity={0.40} color="#fff5e0" />

      {/* Fases 1–4: geometría procedural, sin duplicidad posible */}
      {!ensamblado && (
        <BloquesAnimados familia={modelo.familia} progreso={progreso} />
      )}

      {/* Fase 5: STL completo sin clipping */}
      {ensamblado && (
        <Suspense fallback={<LoadingFallback />}>
          <STLEnsamblado
            url={modelo.stl}
            mostrarCotas={mostrarCotas}
            tolerancias={modelo.tolerancias}
          />
        </Suspense>
      )}

      <ContactShadows position={[0, -6.8, 0]} opacity={0.45} scale={20} blur={2.5} far={9} />
      <Grid
        position={[0, -6.82, 0]} args={[22, 22]}
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
