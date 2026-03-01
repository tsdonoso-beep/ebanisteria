/**
 * VisorCanvas.jsx
 * Visor 3D con línea de tiempo de fabricación en 4 fases claras:
 *
 *   0–32%   → Bloque en bruto: dos maderos sólidos sin cortes
 *   33–65%  → Trazado: zonas de corte resaltadas en rojo
 *   66–99%  → Pieza cortada: STL dividido en dos mitades con gap animado
 *   100%    → Ensamblaje: las piezas se unen con glow ambarino
 *
 * El gap entre piezas se cierra al avanzar el slider de 66 → 100%.
 * El botón "Ensamblar piezas" anima automáticamente el slider hasta 100%.
 */

import React, { useRef, useMemo, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, ContactShadows, Grid, Html } from '@react-three/drei';
import { useLoader, useFrame, useThree } from '@react-three/fiber';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';

// ── Límites de fase ─────────────────────────────────────────────────────────
const FASE_TRAZADO  = 33;
const FASE_CORTADO  = 66;
const FASE_ENSAMBLE = 100;

// ── Materiales base ─────────────────────────────────────────────────────────
const MAT_BRUTO  = new THREE.MeshStandardMaterial({ color: '#c8922a', roughness: 0.85, metalness: 0.02 });
const MAT_OSCURO = new THREE.MeshStandardMaterial({ color: '#8b5e1a', roughness: 0.90, metalness: 0.02 });

// ── Planos de corte para dividir el STL en dos mitades al eje X ─────────────
// Three.js descarta donde dot(normal, point) + constant < 0
const CLIP_MITAD_IZQ = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0); // mantiene x ≤ 0
const CLIP_MITAD_DER = new THREE.Plane(new THREE.Vector3( 1, 0, 0), 0); // mantiene x ≥ 0

// ── Habilitar clipping local ────────────────────────────────────────────────
function EnableClipping() {
  const { gl } = useThree();
  gl.localClippingEnabled = true;
  return null;
}

// ══════════════════════════════════════════════════════════════════════════
// FASES 0–65%: Geometría procedural (bloques + overlay de trazado)
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

function BloquesEnBruto({ familia, progreso }) {
  const cfg = getFamiliaConfig(familia);
  const SEP = 2.2; // separación fija entre bloques

  const mostrarTrazado = progreso >= FASE_TRAZADO;
  // Aparición rápida del overlay rojo al entrar en fase Trazado
  const opTrazado = mostrarTrazado
    ? Math.min(1, (progreso - FASE_TRAZADO) / 8) * 0.65
    : 0;

  return (
    <group>
      {/* Bloque A */}
      <group position={[-SEP - cfg.bloqueA[0] / 2, 0, 0]}>
        <mesh castShadow receiveShadow material={MAT_BRUTO}>
          <boxGeometry args={cfg.bloqueA} />
        </mesh>
        {cfg.eliminarA.map((z, i) => (
          <mesh key={i} position={z.pos}>
            <boxGeometry args={z.args} />
            <meshStandardMaterial
              color="#ef4444" transparent opacity={opTrazado}
              emissive="#7f1d1d" emissiveIntensity={0.6}
              depthWrite={false}
            />
          </mesh>
        ))}
      </group>

      {/* Bloque B */}
      <group position={[SEP + cfg.bloqueB[0] / 2, 0, 0]}>
        <mesh castShadow receiveShadow material={MAT_OSCURO}>
          <boxGeometry args={cfg.bloqueB} />
        </mesh>
        {cfg.eliminarB.map((z, i) => (
          <mesh key={i} position={z.pos}>
            <boxGeometry args={z.args} />
            <meshStandardMaterial
              color="#ef4444" transparent opacity={opTrazado}
              emissive="#7f1d1d" emissiveIntensity={0.6}
              depthWrite={false}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// FASES 66–100%: STL real dividido en dos mitades con gap que se cierra
// ══════════════════════════════════════════════════════════════════════════

function STLPiezas({ url, progreso, mostrarCotas, tolerancias }) {
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
  const ensamblado = progreso >= FASE_ENSAMBLE;

  // t: 0 cuando progreso=66%, 1 cuando progreso=100%
  const t = Math.max(0, Math.min(1, (progreso - FASE_CORTADO) / (FASE_ENSAMBLE - FASE_CORTADO)));
  // Gap animado: comienza en 2.5 unidades, llega a 0 al ensamblarse
  const gap = ensamblado ? 0 : (1 - t) * 2.5;

  // Glow pulsante al ensamblarse completamente
  const matRef = useRef();
  useFrame(({ clock }) => {
    if (matRef.current && ensamblado) {
      matRef.current.emissiveIntensity = 0.22 + Math.sin(clock.getElapsedTime() * 2.5) * 0.13;
    }
  });

  return (
    <group>
      {ensamblado ? (
        /* ── Ensamblaje completo: modelo unido con glow ── */
        <mesh castShadow receiveShadow geometry={geometry}>
          <meshStandardMaterial
            ref={matRef}
            color="#c8922a" roughness={0.55} metalness={0.1}
            emissive="#c8922a" emissiveIntensity={0.3}
          />
        </mesh>
      ) : (
        /* ── Dos mitades separadas por gap ── */
        <>
          {/* Mitad izquierda (x ≤ 0) */}
          <group position={[-gap, 0, 0]}>
            <mesh castShadow receiveShadow geometry={geometry}>
              <meshStandardMaterial
                color="#c8922a" roughness={0.75} metalness={0.04}
                side={THREE.FrontSide}
                clippingPlanes={[CLIP_MITAD_IZQ]}
              />
            </mesh>
            {/* Cara de sección interior (BackSide muestra el corte) */}
            <mesh geometry={geometry}>
              <meshStandardMaterial
                color="#7a4a1a" roughness={0.9}
                side={THREE.BackSide}
                clippingPlanes={[CLIP_MITAD_IZQ]}
              />
            </mesh>
          </group>

          {/* Mitad derecha (x ≥ 0) */}
          <group position={[gap, 0, 0]}>
            <mesh castShadow receiveShadow geometry={geometry}>
              <meshStandardMaterial
                color="#8b5e1a" roughness={0.85} metalness={0.02}
                side={THREE.FrontSide}
                clippingPlanes={[CLIP_MITAD_DER]}
              />
            </mesh>
            <mesh geometry={geometry}>
              <meshStandardMaterial
                color="#5a3a0a" roughness={0.9}
                side={THREE.BackSide}
                clippingPlanes={[CLIP_MITAD_DER]}
              />
            </mesh>
          </group>

          {/* Línea azul de unión — aparece cuando las piezas se acercan */}
          {gap < 1.8 && (
            <mesh>
              <boxGeometry args={[
                0.06,
                (bbox.max.y - bbox.min.y) * 1.1,
                (bbox.max.z - bbox.min.z) * 1.1,
              ]} />
              <meshStandardMaterial
                color="#3b82f6" transparent
                opacity={(1 - gap / 1.8) * 0.75}
                emissive="#1d4ed8" emissiveIntensity={0.6}
                depthWrite={false}
              />
            </mesh>
          )}
        </>
      )}

      {/* Cotas / Tolerancias */}
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

  // Cambio limpio entre fases — sin crossfade
  const mostrarSTL = progreso >= FASE_CORTADO;

  return (
    <Canvas camera={{ position: [4, 4, 8], fov: 44 }} shadows gl={{ antialias: true }}>
      <color attach="background" args={['#0f172a']} />
      <EnableClipping />

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

      {/* Fases 0–65%: bloques procedurales */}
      {!mostrarSTL && (
        <BloquesEnBruto familia={modelo.familia} progreso={progreso} />
      )}

      {/* Fases 66–100%: STL dividido → unido */}
      {mostrarSTL && (
        <Suspense fallback={<LoadingFallback />}>
          <STLPiezas
            url={modelo.stl}
            progreso={progreso}
            mostrarCotas={mostrarCotas}
            tolerancias={modelo.tolerancias}
          />
        </Suspense>
      )}

      {/* Sombras y grilla */}
      <ContactShadows position={[0, -3.2, 0]} opacity={0.45} scale={14} blur={2.5} far={5} />
      <Grid
        position={[0, -3.22, 0]} args={[16, 16]}
        cellSize={0.6} cellThickness={0.5} cellColor="#1e293b"
        sectionSize={2.4} sectionThickness={1} sectionColor="#334155"
        fadeDistance={22} fadeStrength={1} followCamera={false}
      />
      <OrbitControls
        makeDefault enablePan enableZoom
        minDistance={4} maxDistance={24}
        minPolarAngle={0.15} maxPolarAngle={Math.PI / 1.85}
      />
    </Canvas>
  );
}
