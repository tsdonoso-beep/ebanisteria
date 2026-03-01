/**
 * VisorCanvas.jsx
 * Visor 3D — siempre exactamente DOS piezas visibles (0–99 %).
 *
 *   0–24%   → Bloque en bruto: dos maderos apilados (arriba / abajo)
 *   25–49%  → Trazado: zona de corte marcada en rojo, independiente por pieza
 *   50–79%  → Pieza cortada: zona eliminada oscurecida, perfil visible
 *   80–99%  → Ensamblaje: pieza de arriba baja a encajar con la de abajo
 *   100%    → Ensamblado: modelo STL completo con brillo ambarino
 *
 * El STL se usa SOLO en la fase final (100 %).
 * No hay clipping, no hay duplicidad.
 */

import React, { useRef, useMemo, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, ContactShadows, Grid, Html } from '@react-three/drei';
import { useLoader, useFrame } from '@react-three/fiber';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';

// ── Límites de fase ─────────────────────────────────────────────────────────
const FASE_TRAZADO  = 25;
const FASE_CORTADO  = 50;
const FASE_ENSAMBLE = 80;

// ── Materiales base ─────────────────────────────────────────────────────────
const MAT_BRUTO  = new THREE.MeshStandardMaterial({ color: '#c8922a', roughness: 0.85, metalness: 0.02 });
const MAT_OSCURO = new THREE.MeshStandardMaterial({ color: '#8b5e1a', roughness: 0.90, metalness: 0.02 });

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
// Pieza individual: bloque + zonas de corte visualizadas por fase
// ══════════════════════════════════════════════════════════════════════════

function PiezaConCorte({ dims, eliminar, material, opTrazado, opHueco }) {
  return (
    <group>
      {/* Bloque macizo */}
      <mesh castShadow receiveShadow material={material}>
        <boxGeometry args={dims} />
      </mesh>

      {/* Zonas de corte: rojo (trazado) o hueco oscuro (cortado) */}
      {eliminar.map((z, i) => {
        const mostrandoHueco = opHueco > 0.01;
        return (
          <mesh key={i} position={z.pos}>
            <boxGeometry args={z.args} />
            <meshStandardMaterial
              color={mostrandoHueco ? '#0f172a' : '#ef4444'}
              transparent
              opacity={mostrandoHueco ? opHueco : opTrazado}
              emissive={mostrandoHueco ? '#000000' : '#7f1d1d'}
              emissiveIntensity={mostrandoHueco ? 0 : 0.6}
              depthWrite={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Fases 0–99 %: dos bloques procedurales apilados en eje Y
// ══════════════════════════════════════════════════════════════════════════

function BloquesEnBruto({ familia, progreso }) {
  const cfg = getFamiliaConfig(familia);

  // Transiciones suaves entre fases
  const tTrazado = progreso >= FASE_TRAZADO
    ? Math.min(1, (progreso - FASE_TRAZADO) / 8) : 0;
  const tCortado = progreso >= FASE_CORTADO
    ? Math.min(1, (progreso - FASE_CORTADO) / 8) : 0;
  const tUnion   = progreso >= FASE_ENSAMBLE
    ? Math.min(1, (progreso - FASE_ENSAMBLE) / (100 - FASE_ENSAMBLE)) : 0;

  // Trazado → Cortado: el rojo desaparece y aparece el hueco oscuro
  const opTrazado = tCortado > 0 ? 0 : tTrazado * 0.65;
  const opHueco   = tCortado * 0.92;

  // Gap en eje Y: 1.0 unidades separadas → 0 al ensamblarse
  const gap = 1.0 * (1 - tUnion);
  const yA  = -(gap / 2 + cfg.bloqueA[1] / 2); // pieza A: abajo
  const yB  = +(gap / 2 + cfg.bloqueB[1] / 2); // pieza B: arriba

  return (
    <group>
      {/* Pieza A — abajo (fija, recibe a la pieza B) */}
      <group position={[0, yA, 0]}>
        <PiezaConCorte
          dims={cfg.bloqueA} eliminar={cfg.eliminarA}
          material={MAT_BRUTO} opTrazado={opTrazado} opHueco={opHueco}
        />
      </group>

      {/* Pieza B — arriba (desciende para ensamblarse) */}
      <group position={[0, yB, 0]}>
        <PiezaConCorte
          dims={cfg.bloqueB} eliminar={cfg.eliminarB}
          material={MAT_OSCURO} opTrazado={opTrazado} opHueco={opHueco}
        />
      </group>
    </group>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Fase 100 %: modelo STL completo con glow ambarino (sin clipping)
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
// Componente público: VisorCanvas
// ══════════════════════════════════════════════════════════════════════════

export default function VisorCanvas({ modelo, progreso, mostrarCotas }) {
  if (!modelo) return null;

  const ensamblado = progreso >= 100;

  return (
    <Canvas camera={{ position: [5, 3, 10], fov: 44 }} shadows gl={{ antialias: true }}>
      <color attach="background" args={['#0f172a']} />

      {/* Iluminación */}
      <ambientLight intensity={0.38} />
      <directionalLight
        position={[6, 10, 6]} intensity={1.5} castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-8} shadow-camera-right={8}
        shadow-camera-top={8}  shadow-camera-bottom={-8}
      />
      <directionalLight position={[-5, 4, -5]} intensity={0.3} color="#a0c4ff" />
      <pointLight position={[0, 8, 0]} intensity={0.4} color="#fff5e0" />

      {/* Fases 0–99 %: dos bloques procedurales, nunca duplicados */}
      {!ensamblado && (
        <BloquesEnBruto familia={modelo.familia} progreso={progreso} />
      )}

      {/* Fase 100 %: STL completo sin clipping — una sola pieza unida */}
      {ensamblado && (
        <Suspense fallback={<LoadingFallback />}>
          <STLEnsamblado
            url={modelo.stl}
            mostrarCotas={mostrarCotas}
            tolerancias={modelo.tolerancias}
          />
        </Suspense>
      )}

      {/* Sombras y grilla */}
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
