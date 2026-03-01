/**
 * LandingEbanisteria — Componente principal
 * ─────────────────────────────────────────────────────────────────────────────
 * Pantalla de catálogo interactivo del Taller de Ebanistería.
 * Tres zonas:
 *   1. Menú Lateral  — Catálogo tipo acordeón (Ensambles / Juntas / Empalmes)
 *   2. Lienzo 3D     — Visor con 4 fases de fabricación
 *   3. Panel Inferior — Slider + botón Ensamblar + herramienta Cotas
 *
 * Plataforma: MSE-SFT Ebanistería — PRONIED / MINEDU
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import MenuLateral from './MenuLateral';
import VisorCanvas from './VisorCanvas';
import { CATEGORIAS, FASE_LABELS } from './catalogoData';
import './styles.css';

// Modelo inicial: N2 – Ensamble a Caja y Espiga
const MODELO_DEFAULT = { ...CATEGORIAS[0].items[1], categoria: CATEGORIAS[0].label };

// ── Iconos SVG ───────────────────────────────────────────────────────────────
const IconCotas = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M21 10H3M21 6l-4 4 4 4M3 6l4 4-4 4" />
  </svg>
);

const IconEnsamblar = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);

const IconSeparar = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </svg>
);

// ── Fase activa según progreso ───────────────────────────────────────────────
function getFaseInfo(progreso) {
  let idx = 0;
  for (let i = FASE_LABELS.length - 1; i >= 0; i--) {
    if (progreso >= FASE_LABELS[i].pct) { idx = i; break; }
  }
  return { idx, ...FASE_LABELS[idx] };
}

// ── Componente principal ─────────────────────────────────────────────────────
export default function LandingEbanisteria() {
  const [modelo,    setModelo]    = useState(MODELO_DEFAULT);
  const [progreso,  setProgreso]  = useState(0);
  const [modoCotas, setModoCotas] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const animRef = useRef(null);

  // Limpiar animación al desmontar
  useEffect(() => () => { if (animRef.current) cancelAnimationFrame(animRef.current); }, []);

  const handleSelectModelo = useCallback((m) => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    setModelo(m);
    setProgreso(0);
    setModoCotas(false);
    setCanvasKey(k => k + 1);
  }, []);

  const handleProgreso = useCallback((e) => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    setProgreso(Number(e.target.value));
  }, []);

  const handleCotas = useCallback(() => {
    setModoCotas(v => {
      // Ir a fase "Pieza cortada" para que las cotas tengan contexto
      if (!v && progreso < 50) setProgreso(50);
      return !v;
    });
  }, [progreso]);

  // Botón "Ensamblar": anima el slider hasta 100%.
  // Si ya está ensamblado, vuelve a la fase "Pieza cortada" (66%).
  const handleEnsamblar = useCallback(() => {
    if (animRef.current) cancelAnimationFrame(animRef.current);

    if (progreso >= 100) {
      setProgreso(50);
      return;
    }

    const step = () => {
      setProgreso(prev => {
        const next = Math.min(100, prev + 1.2);
        if (next < 100) animRef.current = requestAnimationFrame(step);
        return next;
      });
    };
    animRef.current = requestAnimationFrame(step);
  }, [progreso]);

  const faseInfo      = getFaseInfo(progreso);
  const enPiezaCortada = progreso >= 50;
  const ensamblado     = progreso >= 100;

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
            mostrarCotas={modoCotas}
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
          {modoCotas && enPiezaCortada && (
            <div className="le-cotas-banner">
              📐 Modo Cotas y Tolerancias activo
            </div>
          )}

          {/* Banner ensamblaje completo */}
          {ensamblado && (
            <div className="le-ensamble-banner">
              ✓ Ensamblaje completo
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
                onClick={() => {
                  if (animRef.current) cancelAnimationFrame(animRef.current);
                  setProgreso(f.pct);
                }}
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
            style={{ '--progress': `${progreso}%` }}
            aria-label="Línea de tiempo de fabricación"
          />

          {/* Fila inferior: descripción + herramientas */}
          <div className="le-controls-row">
            <p className="le-fase-desc">
              <strong>{faseInfo.label}:</strong> {faseInfo.desc}
            </p>

            <div className="le-tools">
              {/* Botón Ensamblar — aparece en fase "Pieza cortada" */}
              {enPiezaCortada && (
                <button
                  className={`le-tool-btn le-tool-btn--ensamblar ${ensamblado ? 'le-tool-btn--active' : ''}`}
                  onClick={handleEnsamblar}
                  title={ensamblado ? 'Volver a ver las piezas separadas' : 'Animar el ensamblaje de las dos piezas'}
                >
                  {ensamblado ? <IconSeparar /> : <IconEnsamblar />}
                  {ensamblado ? 'Separar piezas' : 'Ensamblar piezas'}
                </button>
              )}

              {/* Botón Cotas */}
              <button
                className={`le-tool-btn ${modoCotas ? 'le-tool-btn--active' : ''}`}
                onClick={handleCotas}
                title="Activa las cotas de dimensión y tolerancias técnicas"
              >
                <IconCotas />
                {modoCotas ? 'Ocultar Cotas' : 'Ver Cotas'}
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
