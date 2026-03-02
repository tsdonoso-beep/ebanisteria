/**
 * SimuladorDiagnostico3D
 * ─────────────────────────────────────────────────────────────────────────────
 * Componente React aislado y reutilizable para el diagnóstico interactivo
 * de ensambles de ebanistería con representación 3D.
 *
 * Plataforma: MSE-SFT Ebanistería — PRONIED / MINEDU
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Props
 * ─────
 * @param {string}   jointType     Código y nombre de la unión a evaluar.
 *                                 Ej: "N2 - Ensamble a Caja y Espiga"
 *
 * @param {Object}   stlUrls       Ruta al archivo STL del ensamble completo.
 *                                 Ej: { url: '/models/02-caja-espiga.stl' }
 *                                 Si es null se usan geometrías placeholder.
 *
 * @param {Object}   injectedError Error de fabricación inyectado por la plataforma.
 *                                 Ej: { id: 'ajuste_suelto', label: 'Ajuste muy suelto' }
 *
 * @param {Array}    errorOptions  Lista de opciones de diagnóstico (errores comunes
 *                                 extraídos de las fichas técnicas).
 *                                 Ej: [{ id, label, description }]
 *
 * @param {Function} onComplete    Callback que recibe los KPIs cuando el docente envía
 *                                 su diagnóstico.
 *                                 Signature: onComplete({ kpiResults })
 *                                 kpiResults: {
 *                                   diagnosticoCorrecto  : boolean,
 *                                   tiempoInspeccion     : number (segundos),
 *                                   piezasInspeccionadas : boolean,
 *                                   errorSeleccionado    : string,
 *                                   errorEsperado        : string,
 *                                 }
 */

import React, { useState, useRef, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, ContactShadows, Grid } from '@react-three/drei';

import PlaceholderParts from './PlaceholderParts';
import DiagnosticPanel from './DiagnosticPanel';
import './styles.css';

// ─── Valores por defecto (demo / Ficha 2) ───────────────────────────────────

const DEFAULT_ERROR_OPTIONS = [
  {
    id: 'ajuste_suelto',
    label: 'Ajuste muy suelto',
    description: 'La espiga entra con excesiva holgura en la caja; se mueve lateralmente.',
  },
  {
    id: 'caja_mal_centrada',
    label: 'Caja mal centrada',
    description: 'El mortise no está alineado con el eje central de la pieza huésped.',
  },
  {
    id: 'espiga_muy_larga',
    label: 'Espiga demasiado larga',
    description: 'La espiga sobresale más allá del fondo de la caja, impidiendo el enrase.',
  },
  {
    id: 'ajuste_forzado',
    label: 'Ajuste forzado / muy apretado',
    description: 'La espiga requiere fuerza excesiva; riesgo de fisura en la madera.',
  },
];

// ─── Componente principal ────────────────────────────────────────────────────

const SimuladorDiagnostico3D = ({
  jointType      = 'N2 - Ensamble a Caja y Espiga',
  stlUrls        = null,   // { url: '/models/02-caja-espiga.stl' } | null
  injectedError  = { id: 'ajuste_suelto', label: 'Ajuste muy suelto' },
  errorOptions   = DEFAULT_ERROR_OPTIONS,
  onComplete     = null,
}) => {

  // ── Estado interno ──────────────────────────────────────────────────────────
  /** Valor 0 = piezas ensambladas / 1 = completamente separadas */
  const [separationOffset, setSeparationOffset]       = useState(0);
  /** ID del error seleccionado por el docente en el panel */
  const [selectedErrorId, setSelectedErrorId]         = useState(null);
  /** Fases del flujo: 'inspection' → 'diagnosis' → 'complete' */
  const [phase, setPhase]                             = useState('inspection');
  /** KPI: si el docente usó el control de desarmado antes de responder */
  const [hasUsedDisassembly, setHasUsedDisassembly]   = useState(false);
  /** Flag que evita doble envío */
  const [submitted, setSubmitted]                     = useState(false);

  /** Marca de tiempo al montar el componente — base para KPI de tiempo */
  const inspectionStartRef = useRef(Date.now());

  // ── Handlers ────────────────────────────────────────────────────────────────

  /** Actualiza el offset de separación y registra si el docente inspeccionó el interior */
  const handleSeparationChange = useCallback((value) => {
    const numVal = parseFloat(value);
    setSeparationOffset(numVal);
    // Si mueve el slider más del 15 % se considera que inspeccionó
    if (numVal > 0.15 && !hasUsedDisassembly) {
      setHasUsedDisassembly(true);
    }
  }, [hasUsedDisassembly]);

  /** Transición de la fase de inspección a la de diagnóstico */
  const handleProceedToDiagnosis = useCallback(() => {
    setPhase('diagnosis');
  }, []);

  /** Reinicia el componente al estado inicial (útil para re-intentos en demo) */
  const handleRetry = useCallback(() => {
    setSeparationOffset(0);
    setSelectedErrorId(null);
    setPhase('inspection');
    setHasUsedDisassembly(false);
    setSubmitted(false);
    inspectionStartRef.current = Date.now();
  }, []);

  /**
   * Envía el diagnóstico y emite los KPIs a la plataforma principal
   * a través del callback onComplete.
   */
  const handleSubmit = useCallback(() => {
    if (!selectedErrorId || submitted) return;

    const tiempoInspeccion   = Math.round((Date.now() - inspectionStartRef.current) / 1000);
    const diagnosticoCorrecto = selectedErrorId === injectedError.id;

    setSubmitted(true);
    setPhase('complete');

    if (typeof onComplete === 'function') {
      onComplete({
        kpiResults: {
          diagnosticoCorrecto,
          tiempoInspeccion,
          piezasInspeccionadas : hasUsedDisassembly,
          errorSeleccionado    : selectedErrorId,
          errorEsperado        : injectedError.id,
        },
      });
    }
  }, [selectedErrorId, submitted, injectedError.id, hasUsedDisassembly, onComplete]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="ssd-root">

      {/* ══════════════════════════════════════════════════════════════════════
          ZONA IZQUIERDA — Visor 3D + controles superpuestos
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="ssd-viewport">

        {/* ── Canvas Three.js ── */}
        <Canvas
          camera={{ position: [5, 3.5, 7], fov: 42 }}
          shadows
          gl={{ antialias: true, alpha: false }}
        >
          {/* Fondo oscuro tipo laboratorio */}
          <color attach="background" args={['#111827']} />

          {/* Iluminación */}
          <ambientLight intensity={0.35} />
          <directionalLight
            position={[6, 10, 6]}
            intensity={1.4}
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-camera-near={0.5}
            shadow-camera-far={50}
            shadow-camera-left={-8}
            shadow-camera-right={8}
            shadow-camera-top={8}
            shadow-camera-bottom={-8}
          />
          <directionalLight position={[-4, 4, -4]} intensity={0.25} color="#a0c4ff" />
          <pointLight position={[0, 8, 0]} intensity={0.5} color="#fff5e0" />

          {/* Piezas 3D (placeholder geométrico o STL cuando se provean) */}
          <PlaceholderParts
            separationOffset={separationOffset}
            injectedError={injectedError}
            stlUrls={stlUrls}
          />

          {/* Sombras de contacto bajo las piezas */}
          <ContactShadows
            position={[0, -2.8, 0]}
            opacity={0.5}
            scale={12}
            blur={2.5}
            far={5}
          />

          {/* Cuadrícula de referencia */}
          <Grid
            position={[0, -2.82, 0]}
            args={[14, 14]}
            cellSize={0.5}
            cellThickness={0.5}
            cellColor="#2d3748"
            sectionSize={2}
            sectionThickness={1}
            sectionColor="#4a5568"
            fadeDistance={20}
            fadeStrength={1}
            followCamera={false}
          />

          {/* Controles de cámara */}
          <OrbitControls
            makeDefault
            enablePan
            enableZoom
            minDistance={3}
            maxDistance={22}
            minPolarAngle={0.1}
            maxPolarAngle={Math.PI / 1.8}
          />
        </Canvas>

        {/* ── Badge: Tipo de Unión ── */}
        <div className="ssd-joint-badge">
          <span className="ssd-badge-icon">🪵</span>
          <span>{jointType}</span>
        </div>

        {/* ── Indicador de modo ── */}
        <div className={`ssd-mode-indicator ssd-mode-${phase}`}>
          {phase === 'inspection' && '🔍 Modo inspección — Examina las piezas'}
          {phase === 'diagnosis'  && '📋 Modo diagnóstico — Selecciona el error'}
          {phase === 'complete'   && '✅ Evaluación completada'}
        </div>

        {/* ── Panel de Desarmado Virtual ── */}
        <div className="ssd-disassembly-panel">
          <div className="ssd-disassembly-header">
            <span className="ssd-disassembly-icon">🔧</span>
            <span className="ssd-disassembly-title">Desarmado Virtual</span>
            {hasUsedDisassembly && (
              <span className="ssd-inspected-badge">✓ Interior inspeccionado</span>
            )}
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={separationOffset}
            onChange={(e) => handleSeparationChange(e.target.value)}
            className="ssd-slider"
            aria-label="Separar piezas del ensamble"
          />
          <div className="ssd-slider-labels">
            <span>⬛ Ensamblado</span>
            <span>↔ Separado</span>
          </div>
        </div>

      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          ZONA DERECHA — Panel de Diagnóstico
      ══════════════════════════════════════════════════════════════════════ */}
      <DiagnosticPanel
        phase={phase}
        errorOptions={errorOptions}
        selectedErrorId={selectedErrorId}
        injectedError={injectedError}
        hasUsedDisassembly={hasUsedDisassembly}
        submitted={submitted}
        onSelectError={setSelectedErrorId}
        onProceedToDiagnosis={handleProceedToDiagnosis}
        onSubmit={handleSubmit}
        onRetry={handleRetry}
      />

    </div>
  );
};

export default SimuladorDiagnostico3D;
