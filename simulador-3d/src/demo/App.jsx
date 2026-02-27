/**
 * App.jsx — Demo / Harness de integración
 * ─────────────────────────────────────────────────────────────────────────────
 * Esta aplicación de demostración permite probar el componente
 * <SimuladorDiagnostico3D /> con distintas configuraciones, simulando
 * cómo lo usaría la plataforma general de capacitación.
 *
 * Para el uso real en la plataforma, la plataforma importaría directamente:
 *   import SimuladorDiagnostico3D from './components/SimuladorDiagnostico3D';
 * y pasaría las props con los datos reales de la ficha técnica activa.
 */

import React, { useState, useCallback } from 'react';
import SimuladorDiagnostico3D from '../components/SimuladorDiagnostico3D';
import './demo.css';

// ── Configuraciones de ejemplo por ficha técnica ──────────────────────────

const FICHAS = [
  {
    id: 'ficha2',
    jointType: 'N2 - Ensamble a Caja y Espiga (Mortise & Tenon)',
    stlUrls: null, // Sin STL aún — usa geometrías placeholder
    injectedError: { id: 'ajuste_suelto', label: 'Ajuste muy suelto' },
    errorOptions: [
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
        description: 'La espiga sobresale del fondo de la caja, impidiendo el enrase.',
      },
      {
        id: 'ajuste_forzado',
        label: 'Ajuste forzado / muy apretado',
        description: 'La espiga requiere fuerza excesiva; riesgo de fisura en la madera.',
      },
    ],
  },
  {
    id: 'ficha2b',
    jointType: 'N2 - Ensamble a Caja y Espiga — Error: Caja mal centrada',
    stlUrls: null,
    injectedError: { id: 'caja_mal_centrada', label: 'Caja mal centrada' },
    errorOptions: [
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
        description: 'La espiga sobresale del fondo de la caja, impidiendo el enrase.',
      },
      {
        id: 'ajuste_forzado',
        label: 'Ajuste forzado / muy apretado',
        description: 'La espiga requiere fuerza excesiva; riesgo de fisura en la madera.',
      },
    ],
  },
  {
    id: 'ficha2c',
    jointType: 'N2 - Ensamble a Caja y Espiga — Error: Espiga muy larga',
    stlUrls: null,
    injectedError: { id: 'espiga_muy_larga', label: 'Espiga demasiado larga' },
    errorOptions: [
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
        description: 'La espiga sobresale del fondo de la caja, impidiendo el enrase.',
      },
      {
        id: 'ajuste_forzado',
        label: 'Ajuste forzado / muy apretado',
        description: 'La espiga requiere fuerza excesiva; riesgo de fisura en la madera.',
      },
    ],
  },
];

// ── Componente App ─────────────────────────────────────────────────────────

export default function App() {
  const [fichaActiva, setFichaActiva]   = useState(FICHAS[0]);
  const [kpiLog, setKpiLog]             = useState([]);
  const [componentKey, setComponentKey] = useState(0); // forzar remount al cambiar ficha

  /** Recibe los KPIs del componente y los registra en la consola del demo */
  const handleComplete = useCallback(({ kpiResults }) => {
    console.log('[Plataforma] KPIs recibidos:', kpiResults);
    setKpiLog((prev) => [
      {
        ficha: fichaActiva.id,
        timestamp: new Date().toLocaleTimeString('es-PE'),
        ...kpiResults,
      },
      ...prev,
    ]);
  }, [fichaActiva.id]);

  const handleFichaChange = (ficha) => {
    setFichaActiva(ficha);
    setComponentKey((k) => k + 1); // remount limpio
  };

  return (
    <div className="demo-root">
      {/* ── Header ── */}
      <header className="demo-header">
        <div className="demo-header-content">
          <div className="demo-logo">🪵 MSE-SFT Ebanistería</div>
          <span className="demo-badge">Demo · SimuladorDiagnostico3D</span>
        </div>
      </header>

      {/* ── Selector de ficha (simula la plataforma general pasando props) ── */}
      <div className="demo-controls">
        <span className="demo-controls-label">Simular Ficha Técnica:</span>
        <div className="demo-tabs">
          {FICHAS.map((f) => (
            <button
              key={f.id}
              className={`demo-tab ${fichaActiva.id === f.id ? 'demo-tab--active' : ''}`}
              onClick={() => handleFichaChange(f)}
            >
              {f.id === 'ficha2'  ? 'Ficha 2 — Ajuste suelto'      :
               f.id === 'ficha2b' ? 'Ficha 2 — Caja mal centrada'  :
                                    'Ficha 2 — Espiga muy larga'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Info de props actuales ── */}
      <div className="demo-props-info">
        <div className="demo-prop">
          <span className="demo-prop-key">jointType</span>
          <span className="demo-prop-val">"{fichaActiva.jointType}"</span>
        </div>
        <div className="demo-prop">
          <span className="demo-prop-key">injectedError</span>
          <span className="demo-prop-val">
            {`{ id: "${fichaActiva.injectedError.id}", label: "${fichaActiva.injectedError.label}" }`}
          </span>
        </div>
        <div className="demo-prop">
          <span className="demo-prop-key">stlUrls</span>
          <span className="demo-prop-val">null (usando geometría placeholder)</span>
        </div>
      </div>

      {/* ── Componente principal ── */}
      <main className="demo-main">
        <div className="demo-simulator-wrapper">
          <SimuladorDiagnostico3D
            key={componentKey}
            jointType={fichaActiva.jointType}
            stlUrls={fichaActiva.stlUrls}
            injectedError={fichaActiva.injectedError}
            errorOptions={fichaActiva.errorOptions}
            onComplete={handleComplete}
          />
        </div>
      </main>

      {/* ── Log de KPIs emitidos ── */}
      {kpiLog.length > 0 && (
        <section className="demo-kpi-log">
          <h3 className="demo-kpi-log-title">📊 KPIs emitidos por onComplete()</h3>
          <div className="demo-kpi-log-list">
            {kpiLog.map((entry, i) => (
              <div key={i} className="demo-kpi-log-entry">
                <span className="demo-kpi-log-time">[{entry.timestamp}] Ficha: {entry.ficha}</span>
                <div className="demo-kpi-log-values">
                  <span className={entry.diagnosticoCorrecto ? 'demo-kpi-ok' : 'demo-kpi-fail'}>
                    diagnosticoCorrecto: {String(entry.diagnosticoCorrecto)}
                  </span>
                  <span>tiempoInspeccion: {entry.tiempoInspeccion}s</span>
                  <span className={entry.piezasInspeccionadas ? 'demo-kpi-ok' : 'demo-kpi-fail'}>
                    piezasInspeccionadas: {String(entry.piezasInspeccionadas)}
                  </span>
                  <span>errorSeleccionado: "{entry.errorSeleccionado}"</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
