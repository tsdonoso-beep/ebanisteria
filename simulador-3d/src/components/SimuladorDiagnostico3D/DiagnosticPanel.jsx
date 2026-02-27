/**
 * DiagnosticPanel.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Panel lateral superpuesto que guía al docente a través del flujo de
 * diagnóstico: inspección → selección de error → resultado con KPIs.
 *
 * Fases:
 *  'inspection' → Invita a examinar el modelo 3D y usar el desarmado virtual.
 *  'diagnosis'  → Muestra las opciones de error para que el docente elija.
 *  'complete'   → Muestra el resultado (correcto / incorrecto) con retroalimentación.
 */

import React from 'react';

// ── Iconos SVG inline (sin dependencias externas) ──────────────────────────

const IconCheck = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const IconX = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const IconEye = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const IconRotate = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

// ── Componente: Indicador de paso del flujo ────────────────────────────────

function StepIndicator({ currentPhase }) {
  const steps = [
    { id: 'inspection', label: 'Inspección' },
    { id: 'diagnosis',  label: 'Diagnóstico' },
    { id: 'complete',   label: 'Resultado' },
  ];
  const activeIdx = steps.findIndex((s) => s.id === currentPhase);

  return (
    <div className="ssd-steps">
      {steps.map((step, idx) => (
        <React.Fragment key={step.id}>
          <div
            className={`ssd-step ${
              idx < activeIdx  ? 'ssd-step--done'    :
              idx === activeIdx ? 'ssd-step--active' : 'ssd-step--pending'
            }`}
          >
            <div className="ssd-step-dot">
              {idx < activeIdx ? <IconCheck /> : <span>{idx + 1}</span>}
            </div>
            <span className="ssd-step-label">{step.label}</span>
          </div>
          {idx < steps.length - 1 && <div className="ssd-step-line" />}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── Componente: Fase de Inspección ─────────────────────────────────────────

function InspectionPhase({ hasUsedDisassembly, onProceed }) {
  return (
    <div className="ssd-phase-content">
      <h3 className="ssd-phase-title">Inspección del Ensamble</h3>
      <p className="ssd-phase-desc">
        Examina las piezas con detalle. Usa los controles para orbitar, hacer zoom
        y separar las piezas para ver las caras internas.
      </p>

      {/* Checklist de pasos de inspección */}
      <ul className="ssd-checklist">
        <li className="ssd-checklist-item ssd-checklist-item--done">
          <span className="ssd-check-icon"><IconEye /></span>
          <span>Observar la geometría exterior de ambas piezas</span>
        </li>
        <li className={`ssd-checklist-item ${hasUsedDisassembly ? 'ssd-checklist-item--done' : ''}`}>
          <span className="ssd-check-icon">
            {hasUsedDisassembly ? <IconCheck /> : <span className="ssd-check-empty" />}
          </span>
          <span>Usar el <strong>Desarmado Virtual</strong> para ver el interior</span>
          {!hasUsedDisassembly && (
            <span className="ssd-hint-badge">← Mueve el slider</span>
          )}
        </li>
        <li className="ssd-checklist-item">
          <span className="ssd-check-icon"><span className="ssd-check-empty" /></span>
          <span>Identificar inconsistencias en el ajuste</span>
        </li>
      </ul>

      {/* Alerta si no inspeccionó el interior */}
      {!hasUsedDisassembly && (
        <div className="ssd-alert ssd-alert--warning">
          <span>⚠️</span>
          <span>Se recomienda separar las piezas para una evaluación completa antes de diagnosticar.</span>
        </div>
      )}

      <button
        className="ssd-btn ssd-btn--primary"
        onClick={onProceed}
      >
        Proceder al Diagnóstico →
      </button>
    </div>
  );
}

// ── Componente: Fase de Diagnóstico ────────────────────────────────────────

function DiagnosisPhase({ errorOptions, selectedErrorId, onSelectError, onSubmit }) {
  return (
    <div className="ssd-phase-content">
      <h3 className="ssd-phase-title">Selecciona el Error Detectado</h3>
      <p className="ssd-phase-desc">
        Basándote en tu inspección 3D, ¿cuál de los siguientes errores de
        fabricación presenta este modelo?
      </p>

      <div className="ssd-options-list">
        {errorOptions.map((opt) => (
          <button
            key={opt.id}
            className={`ssd-option-card ${selectedErrorId === opt.id ? 'ssd-option-card--selected' : ''}`}
            onClick={() => onSelectError(opt.id)}
            aria-pressed={selectedErrorId === opt.id}
          >
            <div className="ssd-option-radio">
              {selectedErrorId === opt.id && <div className="ssd-option-radio-dot" />}
            </div>
            <div className="ssd-option-text">
              <span className="ssd-option-label">{opt.label}</span>
              {opt.description && (
                <span className="ssd-option-desc">{opt.description}</span>
              )}
            </div>
          </button>
        ))}
      </div>

      <button
        className={`ssd-btn ssd-btn--primary ${!selectedErrorId ? 'ssd-btn--disabled' : ''}`}
        onClick={onSubmit}
        disabled={!selectedErrorId}
        title={!selectedErrorId ? 'Selecciona un error para continuar' : ''}
      >
        Enviar Diagnóstico ✓
      </button>
    </div>
  );
}

// ── Componente: Fase de Resultado ──────────────────────────────────────────

function ResultPhase({ kpiData, onRetry }) {
  const { diagnosticoCorrecto, tiempoInspeccion, piezasInspeccionadas,
          errorSeleccionado, errorEsperado, errorOptions } = kpiData;

  const getLabel = (id) => errorOptions?.find((o) => o.id === id)?.label ?? id;

  const formatTime = (s) => {
    if (s < 60) return `${s} seg`;
    return `${Math.floor(s / 60)} min ${s % 60} seg`;
  };

  return (
    <div className="ssd-phase-content">
      {/* Banner de resultado */}
      <div className={`ssd-result-banner ${diagnosticoCorrecto ? 'ssd-result-banner--ok' : 'ssd-result-banner--fail'}`}>
        <span className="ssd-result-icon">
          {diagnosticoCorrecto ? <IconCheck /> : <IconX />}
        </span>
        <div>
          <div className="ssd-result-title">
            {diagnosticoCorrecto ? 'Diagnóstico correcto' : 'Diagnóstico incorrecto'}
          </div>
          {!diagnosticoCorrecto && (
            <div className="ssd-result-subtitle">
              Error real: <strong>{getLabel(errorEsperado)}</strong>
            </div>
          )}
        </div>
      </div>

      {/* KPIs ── */}
      <h4 className="ssd-kpi-title">Indicadores de Desempeño (KPIs)</h4>
      <div className="ssd-kpi-grid">

        <div className="ssd-kpi-card">
          <span className="ssd-kpi-icon">🎯</span>
          <div className="ssd-kpi-info">
            <span className="ssd-kpi-name">Precisión Diagnóstico</span>
            <span className={`ssd-kpi-value ${diagnosticoCorrecto ? 'ssd-kpi-value--ok' : 'ssd-kpi-value--fail'}`}>
              {diagnosticoCorrecto ? 'CORRECTO' : 'INCORRECTO'}
            </span>
          </div>
        </div>

        <div className="ssd-kpi-card">
          <span className="ssd-kpi-icon">⏱️</span>
          <div className="ssd-kpi-info">
            <span className="ssd-kpi-name">Tiempo de Inspección</span>
            <span className="ssd-kpi-value ssd-kpi-value--neutral">
              {formatTime(tiempoInspeccion)}
            </span>
          </div>
        </div>

        <div className="ssd-kpi-card">
          <span className="ssd-kpi-icon">🔧</span>
          <div className="ssd-kpi-info">
            <span className="ssd-kpi-name">Desarmado Virtual</span>
            <span className={`ssd-kpi-value ${piezasInspeccionadas ? 'ssd-kpi-value--ok' : 'ssd-kpi-value--fail'}`}>
              {piezasInspeccionadas ? 'UTILIZADO' : 'NO UTILIZADO'}
            </span>
          </div>
        </div>

        <div className="ssd-kpi-card ssd-kpi-card--wide">
          <span className="ssd-kpi-icon">📝</span>
          <div className="ssd-kpi-info">
            <span className="ssd-kpi-name">Error seleccionado</span>
            <span className="ssd-kpi-value ssd-kpi-value--neutral">{getLabel(errorSeleccionado)}</span>
          </div>
        </div>

      </div>

      {/* Retroalimentación pedagógica */}
      <div className="ssd-feedback">
        {diagnosticoCorrecto ? (
          <p>
            ✅ <strong>Excelente criterio técnico.</strong> Identificaste correctamente
            que el modelo presenta "<em>{getLabel(errorEsperado)}</em>". Este tipo de
            error suele originarse en una medición incorrecta del ancho de la caja.
          </p>
        ) : (
          <p>
            📚 <strong>Para revisar:</strong> El error inyectado era{' '}
            "<em>{getLabel(errorEsperado)}</em>". Te recomendamos examinar nuevamente
            el modelo separando las piezas y observando la tolerancia en las caras
            de contacto.
          </p>
        )}
        {!piezasInspeccionadas && (
          <p className="ssd-feedback--warning">
            ⚠️ <strong>Sugerencia:</strong> Para futuras evaluaciones, utiliza el
            control de <em>Desarmado Virtual</em> para ver las caras internas antes
            de diagnosticar. Este paso es fundamental en el procedimiento de validación.
          </p>
        )}
      </div>

      <button className="ssd-btn ssd-btn--secondary" onClick={onRetry}>
        <IconRotate /> Reintentar
      </button>
    </div>
  );
}

// ── Componente principal DiagnosticPanel ───────────────────────────────────

/**
 * @param {string}   phase              'inspection' | 'diagnosis' | 'complete'
 * @param {Array}    errorOptions       Opciones de error para mostrar
 * @param {string}   selectedErrorId    ID de la opción actualmente seleccionada
 * @param {Object}   injectedError      { id, label } del error real
 * @param {boolean}  hasUsedDisassembly Si el docente separó las piezas
 * @param {boolean}  submitted          Si ya se envió el diagnóstico
 * @param {Function} onSelectError      Setter del error seleccionado
 * @param {Function} onProceedToDiagnosis Avanza de inspección a diagnóstico
 * @param {Function} onSubmit           Envía el diagnóstico y emite KPIs
 * @param {Function} onRetry            Reinicia el componente
 */
function DiagnosticPanel({
  phase,
  errorOptions,
  selectedErrorId,
  injectedError,
  hasUsedDisassembly,
  submitted,
  onSelectError,
  onProceedToDiagnosis,
  onSubmit,
  onRetry,
}) {
  return (
    <aside className="ssd-panel">
      <div className="ssd-panel-header">
        <div className="ssd-panel-logo">🪵</div>
        <div>
          <h2 className="ssd-panel-title">Panel de Diagnóstico</h2>
          <p className="ssd-panel-subtitle">Evaluación de Errores de Fabricación</p>
        </div>
      </div>

      {/* Indicador de progreso */}
      <StepIndicator currentPhase={phase} />

      <div className="ssd-panel-divider" />

      {/* Contenido dinámico según la fase */}
      {phase === 'inspection' && (
        <InspectionPhase
          hasUsedDisassembly={hasUsedDisassembly}
          onProceed={onProceedToDiagnosis}
        />
      )}

      {phase === 'diagnosis' && (
        <DiagnosisPhase
          errorOptions={errorOptions}
          selectedErrorId={selectedErrorId}
          onSelectError={onSelectError}
          onSubmit={onSubmit}
        />
      )}

      {phase === 'complete' && (
        <ResultPhase
          kpiData={{
            diagnosticoCorrecto  : selectedErrorId === injectedError.id,
            tiempoInspeccion     : 0,   // Este valor llega desde el padre; aquí es placeholder
            piezasInspeccionadas : hasUsedDisassembly,
            errorSeleccionado    : selectedErrorId,
            errorEsperado        : injectedError.id,
            errorOptions,
          }}
          onRetry={onRetry}
        />
      )}

      <div className="ssd-panel-footer">
        MSE-SFT Ebanistería · PRONIED / MINEDU
      </div>
    </aside>
  );
}

export default DiagnosticPanel;
