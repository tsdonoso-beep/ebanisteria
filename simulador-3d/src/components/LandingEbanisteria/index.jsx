/**
 * LandingEbanisteria — Componente principal
 * ─────────────────────────────────────────────────────────────────────────────
 * Pantalla de catálogo interactivo del Taller de Ebanistería.
 * Tres zonas:
 *   1. Menú Lateral  — Catálogo tipo acordeón (Ensambles / Juntas / Empalmes)
 *   2. Lienzo 3D     — Visor de fabricación con línea de tiempo
 *   3. Panel Inferior — Slider de fases + herramientas (Cotas, Rayos X)
 *
 * Plataforma: MSE-SFT Ebanistería — PRONIED / MINEDU
 */

import React, { useState, useCallback, useEffect } from 'react';
import MenuLateral from './MenuLateral';
import VisorCanvas from './VisorCanvas';
import { CATEGORIAS, FASE_LABELS } from './catalogoData';
import './styles.css';

// Modelo inicial por defecto: N2 – Ensamble a Caja y Espiga
const MODELO_DEFAULT = { ...CATEGORIAS[0].items[1], categoria: CATEGORIAS[0].label };

// ── Icono SVG: regla de cotas ────────────────────────────────────────────────
const IconCotas = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M21 10H3M21 6l-4 4 4 4M3 6l4 4-4 4" />
  </svg>
);

// ── Icono SVG: rayos X (transparencia) ──────────────────────────────────────
const IconXRay = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3v18M3 12h18M6.3 6.3l11.4 11.4M17.7 6.3L6.3 17.7" />
  </svg>
);

// ── Obtener la fase activa (0–4) y su info según el progreso ────────────────
function getFaseInfo(progreso) {
  let idx = 0;
  for (let i = FASE_LABELS.length - 1; i >= 0; i--) {
    if (progreso >= FASE_LABELS[i].pct) { idx = i; break; }
  }
  return { idx, ...FASE_LABELS[idx] };
}

// ── Componente principal ─────────────────────────────────────────────────────
export default function LandingEbanisteria() {
  const [modelo,      setModelo]      = useState(MODELO_DEFAULT);
  const [progreso,    setProgreso]    = useState(0);
  const [modoCotas,   setModoCotas]   = useState(false);
  const [modoXRay,    setModoXRay]    = useState(false);
  // key para forzar remount del Canvas cuando cambia el modelo
  const [canvasKey,   setCanvasKey]   = useState(0);

  const handleSelectModelo = useCallback((m) => {
    setModelo(m);
    setProgreso(0);
    setModoCotas(false);
    setCanvasKey(k => k + 1);
  }, []);

  const handleProgreso = useCallback((e) => {
    setProgreso(Number(e.target.value));
  }, []);

  // Si activan Cotas automáticamente llevar slider a fase 75 (Posicionamiento)
  const handleCotas = useCallback(() => {
    setModoCotas(v => {
      if (!v && progreso < 50) setProgreso(75);
      return !v;
    });
  }, [progreso]);

  const faseInfo = getFaseInfo(progreso);
  const progressPct = `${progreso}%`;

  return (
    <div className="le-root">
      {/* ══ 1. MENÚ LATERAL ══════════════════════════════════════════════════ */}
      <MenuLateral
        modeloActivo={modelo}
        onSelectModelo={handleSelectModelo}
      />

      {/* ══ 2. LIENZO CENTRAL + CONTROLES ════════════════════════════════════ */}
      <div className="le-canvas-zone">

        {/* ── Visor 3D ── */}
        <div className="le-viewer">
          <VisorCanvas
            key={canvasKey}
            modelo={modelo}
            progreso={progreso}
            mostrarCotas={modoCotas && progreso >= 50}
          />

          {/* Badge: modelo activo */}
          <div className="le-model-badge">
            <span className="le-model-badge-cat">{modelo.categoria}</span>
            <span>{modelo.id} · {modelo.label}</span>
          </div>

          {/* Badge: fase activa */}
          <div className="le-fase-badge">
            <span className="le-fase-dot" />
            {faseInfo.label}
          </div>

          {/* Banner modo cotas */}
          {modoCotas && progreso >= 50 && (
            <div className="le-cotas-banner">
              📐 Modo Cotas y Tolerancias activo
            </div>
          )}
        </div>

        {/* ══ 3. PANEL DE CONTROLES INFERIOR ═══════════════════════════════ */}
        <div className="le-controls">

          {/* Etiquetas de fase sobre el slider */}
          <div className="le-slider-phases">
            {FASE_LABELS.map((f, i) => (
              <div
                key={i}
                className={`le-phase-tick ${faseInfo.idx === i ? 'le-phase-tick--active' : ''}`}
                title={f.desc}
                onClick={() => setProgreso(f.pct)}
                style={{ cursor: 'pointer' }}
              >
                <div className="le-phase-tick-dot" />
                {f.label}
              </div>
            ))}
          </div>

          {/* Slider de línea de tiempo */}
          <input
            type="range"
            min="0" max="100" step="1"
            value={progreso}
            onChange={handleProgreso}
            className="le-timeline-slider"
            style={{ '--progress': progressPct }}
            aria-label="Línea de tiempo de fabricación"
          />

          {/* Fila inferior: descripción + herramientas */}
          <div className="le-controls-row">
            <p className="le-fase-desc">
              <strong>{faseInfo.label}:</strong> {faseInfo.desc}
            </p>

            <div className="le-tools">
              <button
                className={`le-tool-btn ${modoCotas ? 'le-tool-btn--active' : ''}`}
                onClick={handleCotas}
                title="Activa las cotas de dimensión y tolerancias técnicas"
              >
                <IconCotas />
                {modoCotas ? 'Ocultar Cotas' : 'Ver Cotas y Tolerancias'}
              </button>

              <button
                className={`le-tool-btn ${modoXRay ? 'le-tool-btn--active' : ''}`}
                onClick={() => setModoXRay(v => !v)}
                title="Vista de Rayos X (próximamente)"
                disabled
              >
                <IconXRay />
                Rayos X
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
