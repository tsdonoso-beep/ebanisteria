/**
 * VisorCanvas.jsx
 * Visor 3D interactivo con línea de tiempo de fabricación en 5 fases.
 *
 * Fases del slider (progreso 0–100):
 *   0–24%   → Bloques en bruto (geometría placeholder de dos cajas)
 *   25–49%  → Trazado: overlay rojo translúcido sobre zonas a eliminar
 *   50–74%  → STL real cargado; plano de corte revela el perfil de la unión
 *   75–99%  → Piezas posicionadas (plano retirado, STL completo + separador)
 *   100%    → Ensamblaje completo (STL con glow ambarino)
 *
 * Modo Cotas: muestra tarjetas Html ancladas al modelo con datos de tolerancia.
 */

import React, { useRef, useMemo, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, ContactShadows, Grid, Html } from '@react-three/drei';
import { useLoader, useFrame, useThree } from '@react-three/fiber';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';

// ── Materiales ──────────────────────────────────────────────────────────────
const MAT_BRUTO    = new THREE.MeshStandardMaterial({ color: '#c8922a', roughness: 0.85, metalness: 0.02 });
const MAT_OSCURO   = new THREE.MeshStandardMaterial({ color: '#8b5e1a', roughness: 0.90, metalness: 0.02 });
const MAT_ELIMINAR = new THREE.MeshStandardMaterial({ color: '#ef4444', transparent: true, opacity: 0.55, emissive: '#7f1d1d', emissiveIntensity: 0.5 });
const MAT_GLOW     = new THREE.MeshStandardMaterial({ color: '#c8922a', roughness: 0.5,  metalness: 0.1, emissive: '#c8922a', emissiveIntensity: 0.4 });

// ── Habilitar clipping local ────────────────────────────────────────────────
function EnableClipping() {
  const { gl } = useThree();
  gl.localClippingEnabled = true;
  return null;
}

// ══════════════════════════════════════════════════════════════════════════
// FASE 0–49%: geometría procedural (dos bloques + zonas de corte)
// ══════════════════════════════════════════════════════════════════════════

/** Configs de geometría por familia de unión */
function getFamiliaConfig(familia) {
  // Bloque A (izq.) y Bloque B (der.) + zonas a eliminar
  switch (familia) {
    case 'caja-espiga':
      return {
        bloqueA: [3.2, 5.0, 2.5],
        bloqueB: [3.2, 5.0, 2.5],
        eliminarA: [{ args: [1.1, 2.8, 1.5], pos: [0, 0, 0], label: 'Caja (mortise)' }],
        eliminarB: [
          { args: [1.0, 2.7, 1.4], pos: [0,  0.0, 1.4], label: 'Espiga' },
          { args: [1.1, 1.1, 2.5], pos: [0,  1.5, 0],   label: 'Hombro sup.' },
          { args: [1.1, 1.1, 2.5], pos: [0, -1.5, 0],   label: 'Hombro inf.' },
        ],
      };
    case 'tarugo':
      return {
        bloqueA: [3.5, 4.5, 2.5],
        bloqueB: [3.5, 4.5, 2.5],
        eliminarA: [
          { args: [0.5, 0.5, 1.2], pos: [0,  0.9, 0], label: 'Perf. sup.' },
          { args: [0.5, 0.5, 1.2], pos: [0, -0.9, 0], label: 'Perf. inf.' },
        ],
        eliminarB: [
          { args: [0.5, 0.5, 1.2], pos: [0,  0.9, 0], label: 'Perf. sup.' },
          { args: [0.5, 0.5, 1.2], pos: [0, -0.9, 0], label: 'Perf. inf.' },
        ],
      };
    case 'horquilla':
      return {
        bloqueA: [3.5, 4.5, 2.5],
        bloqueB: [3.5, 4.5, 2.5],
        eliminarA: [{ args: [1.2, 1.8, 2.5], pos: [0, 0, 0], label: 'Ranura horquilla' }],
        eliminarB: [
          { args: [1.05, 2.5, 2.5], pos: [-1.0, 0, 0], label: 'Rebaje izq.' },
          { args: [1.05, 2.5, 2.5], pos: [ 1.0, 0, 0], label: 'Rebaje der.' },
        ],
      };
    case 'media-madera':
      return {
        bloqueA: [4.0, 4.0, 2.5],
        bloqueB: [4.0, 4.0, 2.5],
        eliminarA: [{ args: [4.0, 2.0, 1.3], pos: [0,  1.0, 0.6], label: 'Rebaje ½ sup.' }],
        eliminarB: [{ args: [4.0, 2.0, 1.3], pos: [0, -1.0, 0.6], label: 'Rebaje ½ inf.' }],
      };
    case 'cola-milano':
      return {
        bloqueA: [3.5, 5.0, 2.5],
        bloqueB: [3.5, 5.0, 2.5],
        eliminarA: [{ args: [1.4, 3.2, 1.5], pos: [0, 0, 0], label: 'Canal cola' }],
        eliminarB: [
          { args: [0.8, 1.2, 2.5], pos: [-0.9, 0, 0], label: 'Canto izq.' },
          { args: [0.8, 1.2, 2.5], pos: [ 0.9, 0, 0], label: 'Canto der.' },
        ],
      };
    case 'machihembrada':
    default:
      return {
        bloqueA: [4.0, 2.5, 3.0],
        bloqueB: [4.0, 2.5, 3.0],
        eliminarA: [{ args: [4.0, 0.6, 1.0], pos: [0, 0, 0.5], label: 'Ranura' }],
        eliminarB: [{ args: [4.0, 0.55, 1.0], pos: [0, 0, -0.5], label: 'Lengüeta' }],
      };
  }
}

function BloquesEnBruto({ familia, progreso }) {
  const cfg = getFamiliaConfig(familia);
  // Separación entre bloques: disminuye de 3→1.5 mientras progreso 0→50
  const sep = 3.0 - (progreso / 50) * 1.5;
  const highlightOpacity = progreso < 20 ? 0
    : progreso < 35 ? (progreso - 20) / 15
    : progreso < 45 ? 1
    : (1 - (progreso - 45) / 5);

  return (
    <group>
      {/* Bloque A */}
      <group position={[-sep - cfg.bloqueA[0] / 2, 0, 0]}>
        <mesh castShadow receiveShadow material={MAT_BRUTO}>
          <boxGeometry args={cfg.bloqueA} />
        </mesh>
        {/* Zonas a eliminar de A */}
        {progreso >= 20 && cfg.eliminarA.map((z, i) => (
          <mesh key={i} position={z.pos} castShadow>
            <boxGeometry args={z.args} />
            <meshStandardMaterial
              color="#ef4444" transparent
              opacity={highlightOpacity * 0.6}
              emissive="#7f1d1d" emissiveIntensity={0.5}
            />
          </mesh>
        ))}
      </group>

      {/* Bloque B */}
      <group position={[sep + cfg.bloqueB[0] / 2, 0, 0]}>
        <mesh castShadow receiveShadow material={MAT_OSCURO}>
          <boxGeometry args={cfg.bloqueB} />
        </mesh>
        {progreso >= 20 && cfg.eliminarB.map((z, i) => (
          <mesh key={i} position={z.pos} castShadow>
            <boxGeometry args={z.args} />
            <meshStandardMaterial
              color="#ef4444" transparent
              opacity={highlightOpacity * 0.6}
              emissive="#7f1d1d" emissiveIntensity={0.5}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// FASE 50–100%: STL real con plano de corte + glow final
// ══════════════════════════════════════════════════════════════════════════

function STLFabricacion({ url, progreso, mostrarCotas, tolerancias }) {
  const rawGeo = useLoader(STLLoader, url);

  const geometry = useMemo(() => {
    const geo = rawGeo.clone();
    geo.computeBoundingBox();
    geo.center();
    const size = new THREE.Vector3();
    geo.boundingBox.getSize(size);
    const scale = 5.2 / Math.max(size.x, size.y, size.z);
    geo.scale(scale, scale, scale);
    geo.computeBoundingBox();
    geo.computeVertexNormals();
    return geo;
  }, [rawGeo]);

  const bbox = geometry.boundingBox;
  const modelH = bbox.max.y - bbox.min.y;

  // Plano de corte Y descendente (50%→75%: corta; 75%→100%: se retira)
  const clipPlane = useRef(new THREE.Plane(new THREE.Vector3(0, -1, 0), bbox.max.y + 0.5));
  const currentClipY = useRef(bbox.max.y + 0.5);

  useFrame(() => {
    let targetClipY;
    if (progreso <= 50) {
      targetClipY = bbox.max.y + 0.5; // sin corte
    } else if (progreso <= 75) {
      // Sweep de top → 30% del modelo
      const t = (progreso - 50) / 25;
      targetClipY = bbox.max.y + 0.5 - t * (modelH * 0.70 + 0.5);
    } else {
      // Retira el plano gradualmente
      const t = (progreso - 75) / 25;
      const minClip = bbox.max.y + 0.5 - (modelH * 0.70 + 0.5);
      targetClipY = minClip + t * (modelH * 0.70 + 0.5);
    }
    currentClipY.current += (targetClipY - currentClipY.current) * 0.08;
    clipPlane.current.constant = currentClipY.current;
  });

  // Glow en fase de ensamblaje (progreso > 85)
  const glowIntensity = progreso > 85 ? (progreso - 85) / 15 * 0.5 : 0;

  return (
    <group>
      {/* Cara exterior — madera clara */}
      <mesh castShadow receiveShadow geometry={geometry}>
        <meshStandardMaterial
          color="#c8922a" roughness={0.75} metalness={0.04}
          side={THREE.FrontSide}
          clippingPlanes={[clipPlane.current]}
          clipShadows
          emissive="#c8922a"
          emissiveIntensity={glowIntensity}
        />
      </mesh>

      {/* Cara interior sección — madera oscura */}
      <mesh geometry={geometry}>
        <meshStandardMaterial
          color="#7a4a1a" roughness={0.9} metalness={0.0}
          side={THREE.BackSide}
          clippingPlanes={[clipPlane.current]}
        />
      </mesh>

      {/* Línea de separación visual (fase 75–85%) */}
      {progreso >= 75 && progreso < 90 && (
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[
            (bbox.max.x - bbox.min.x) * 1.1,
            0.04,
            (bbox.max.z - bbox.min.z) * 1.1,
          ]} />
          <meshStandardMaterial
            color="#3b82f6"
            transparent
            opacity={Math.max(0, (progreso < 80 ? 0.7 : (1 - (progreso - 80) / 10) * 0.7))}
            emissive="#1d4ed8"
            emissiveIntensity={0.6}
          />
        </mesh>
      )}

      {/* Cotas / Tolerancias */}
      {mostrarCotas && tolerancias?.map((t, i) => {
        // Distribuye las tarjetas alrededor del modelo
        const angle = (i / tolerancias.length) * Math.PI - Math.PI / 4;
        const r = (bbox.max.x - bbox.min.x) * 0.7 + 1.5;
        const posX = Math.cos(angle) * r;
        const posY = bbox.max.y * 0.4 - i * 1.4;
        const posZ = Math.sin(angle) * r;
        return (
          <Html key={i} position={[posX, posY, posZ]} distanceFactor={8} center>
            <div className="le-cota-card">
              <div className="le-cota-parte">{t.parte}</div>
              <div className="le-cota-values">
                <span className="le-cota-nominal">{t.nominal}</span>
                <span className="le-cota-real">{t.real}</span>
              </div>
              <div className="le-cota-nota">{t.nota}</div>
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

/**
 * @param {Object}  modelo        { id, label, stl, familia, tolerancias }
 * @param {number}  progreso      0–100 (línea de tiempo)
 * @param {boolean} mostrarCotas  Activa el overlay de cotas/tolerancias
 */
export default function VisorCanvas({ modelo, progreso, mostrarCotas }) {
  if (!modelo) return null;

  const usarSTL = progreso >= 45;
  // Opacidad: fade out bloques (45→55%), fade in STL (45→55%)
  const stlOpacity    = progreso < 45 ? 0 : progreso < 55 ? (progreso - 45) / 10 : 1;
  const bloquesOpacity = progreso < 45 ? 1 : progreso < 55 ? 1 - (progreso - 45) / 10 : 0;

  return (
    <Canvas
      camera={{ position: [4, 4, 8], fov: 44 }}
      shadows
      gl={{ antialias: true, alpha: false }}
    >
      <color attach="background" args={['#0f172a']} />

      <EnableClipping />

      {/* Iluminación */}
      <ambientLight intensity={0.38} />
      <directionalLight position={[6, 10, 6]} intensity={1.5} castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-8} shadow-camera-right={8}
        shadow-camera-top={8}  shadow-camera-bottom={-8}
      />
      <directionalLight position={[-5, 4, -5]} intensity={0.3} color="#a0c4ff" />
      <pointLight position={[0, 8, 0]} intensity={0.4} color="#fff5e0" />

      {/* ── Bloques procedurales (fases 0–54%) ── */}
      {bloquesOpacity > 0.01 && (
        <group>
          <BloquesEnBruto familia={modelo.familia} progreso={progreso} />
        </group>
      )}

      {/* ── STL real (fases 45–100%) ── */}
      {usarSTL && (
        <Suspense fallback={<LoadingFallback />}>
          <STLFabricacion
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
        makeDefault
        enablePan enableZoom
        minDistance={4} maxDistance={24}
        minPolarAngle={0.15} maxPolarAngle={Math.PI / 1.85}
      />
    </Canvas>
  );
}
