/**
 * LandingEbanisteria — Componente principal
 * ─────────────────────────────────────────────────────────────────────────────
 * Pantalla de catálogo interactivo del Taller de Ebanistería.
 * Tres zonas:
 *   1. Menú Lateral  — Catálogo tipo acordeón (Ensambles / Juntas / Empalmes)
 *   2. Lienzo 3D     — Visor con control de teclado (WASD + IK)
 *   3. Panel Inferior — Leyenda de teclado + botones Cotas y Reiniciar
 *
 * Plataforma: MSE-SFT Ebanistería — PRONIED / MINEDU
 */

import React, { useState, useCallback } from 'react';
import MenuLateral from './MenuLateral';
import VisorCanvas from './VisorCanvas';
import { CATEGORIAS } from './catalogoData';
import './styles.css';

// Modelo inicial: N2 – Ensamble a Caja y Espiga
const MODELO_DEFAULT = { ...CATEGORIAS[0].items[1], categoria: CATEGORIAS[0].label };

// ── Iconos SVG ───────────────────────────────────────────────────────────────
const IconCotas = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M21 10H3M21 6l-4 4 4 4M3 6l4 4-4 4" />
  </svg>
);

const IconReset = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);

// ── Componente principal ─────────────────────────────────────────────────────
export default function LandingEbanisteria() {
  const [modelo,    setModelo]    = useState(MODELO_DEFAULT);
  const [modoCotas, setModoCotas] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const [resetKey,  setResetKey]  = useState(0);

  const handleSelectModelo = useCallback((m) => {
    setModelo(m);
    setModoCotas(false);
    setCanvasKey(k => k + 1);
  }, []);

  const handleCotas = useCallback(() => {
    setModoCotas(v => !v);
  }, []);

  const handleReset = useCallback(() => {
    setResetKey(k => k + 1);
  }, []);

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
            mostrarCotas={modoCotas}
            triggerReset={resetKey}
          />

          {/* Badge: modelo activo */}
          <div className="le-model-badge">
            <span className="le-model-badge-cat">{modelo.categoria}</span>
            <span>{modelo.id} · {modelo.label}</span>
          </div>

          {/* Banner modo cotas */}
          {modoCotas && (
            <div className="le-cotas-banner">
              📐 Modo Cotas y Tolerancias activo
            </div>
          )}
        </div>

        {/* ══ 3. PANEL DE CONTROLES INFERIOR ═══════════════════════════════ */}
        <div className="le-controls">

          {/* Leyenda de teclado */}
          <div className="le-keyboard-legend">
            <div className="le-legend-group">
              <span className="le-legend-title">Mover pieza</span>
              <div className="le-legend-keys">
                <kbd>W</kbd><span>arriba</span>
                <kbd>S</kbd><span>abajo</span>
                <kbd>A</kbd><span>izquierda</span>
                <kbd>D</kbd><span>derecha</span>
              </div>
            </div>
            <div className="le-legend-sep" />
            <div className="le-legend-group">
              <span className="le-legend-title">Rotar pieza</span>
              <div className="le-legend-keys">
                <kbd>I</kbd><span>eje X</span>
                <kbd>K</kbd><span>eje Y</span>
              </div>
            </div>
            <div className="le-legend-sep" />
            <div className="le-legend-group">
              <span className="le-legend-title">Cámara</span>
              <div className="le-legend-keys">
                <kbd>🖱</kbd><span>orbitar / zoom</span>
              </div>
            </div>
          </div>

          {/* Fila de botones */}
          <div className="le-controls-row">
            <p className="le-fase-desc">
              Usa el teclado para mover y rotar la pieza B libremente.
            </p>

            <div className="le-tools">
              {/* Botón Reiniciar */}
              <button
                className="le-tool-btn"
                onClick={handleReset}
                title="Devuelve la pieza B a su posición inicial"
              >
                <IconReset />
                Reiniciar posición
              </button>

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
