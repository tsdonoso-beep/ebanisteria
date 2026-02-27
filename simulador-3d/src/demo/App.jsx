/**
 * App.jsx — Demo / Harness de integración
 * ─────────────────────────────────────────────────────────────────────────────
 * Simula cómo la plataforma general de capacitación usaría el componente
 * <SimuladorDiagnostico3D /> pasándole distintas props por ficha técnica.
 *
 * Los 11 modelos STL del "Juego de Ensamble" están mapeados con sus
 * errores comunes extraídos de las fichas técnicas.
 */

import React, { useState, useCallback } from 'react';
import SimuladorDiagnostico3D from '../components/SimuladorDiagnostico3D';
import './demo.css';

// ── Catálogo completo de las 11 fichas ────────────────────────────────────

const FICHAS = [
  // ── N1 ─────────────────────────────────────────────────────────────────
  {
    id: 'N1',
    jointType: 'N1 - Ensamble a Tarugo',
    stlUrls: { url: '/models/01-tarugo.stl' },
    injectedError: { id: 'tarugo_descentrado', label: 'Tarugo descentrado' },
    errorOptions: [
      { id: 'tarugo_descentrado',  label: 'Tarugo descentrado',          description: 'El tarugo no coincide con el eje de la perforación, generando esfuerzo lateral.' },
      { id: 'tarugo_muy_corto',    label: 'Tarugo demasiado corto',       description: 'La longitud del tarugo es insuficiente para lograr el empalme resistente requerido.' },
      { id: 'tarugo_muy_largo',    label: 'Tarugo demasiado largo',       description: 'El tarugo sobresale e impide el enrase de las superficies.' },
      { id: 'ajuste_suelto',       label: 'Ajuste muy suelto',            description: 'El diámetro del tarugo es menor que el de la perforación; holgura excesiva.' },
    ],
  },

  // ── N2 ─────────────────────────────────────────────────────────────────
  {
    id: 'N2',
    jointType: 'N2 - Ensamble a Caja y Espiga',
    stlUrls: { url: '/models/02-caja-espiga.stl' },
    injectedError: { id: 'ajuste_suelto', label: 'Ajuste muy suelto' },
    errorOptions: [
      { id: 'ajuste_suelto',       label: 'Ajuste muy suelto',            description: 'La espiga entra con excesiva holgura en la caja; se mueve lateralmente.' },
      { id: 'caja_mal_centrada',   label: 'Caja mal centrada',            description: 'El mortise no está alineado con el eje central de la pieza huésped.' },
      { id: 'espiga_muy_larga',    label: 'Espiga demasiado larga',       description: 'La espiga sobresale del fondo de la caja, impidiendo el enrase.' },
      { id: 'ajuste_forzado',      label: 'Ajuste forzado / muy apretado', description: 'La espiga requiere fuerza excesiva; riesgo de fisura en la madera.' },
    ],
  },

  // ── N3 ─────────────────────────────────────────────────────────────────
  {
    id: 'N3',
    jointType: 'N3 - Ensamble a Orquilla',
    stlUrls: { url: '/models/03-orquilla.stl' },
    injectedError: { id: 'horquilla_asimetrica', label: 'Horquilla asimétrica' },
    errorOptions: [
      { id: 'horquilla_asimetrica', label: 'Horquilla asimétrica',        description: 'Los brazos de la horquilla tienen espesores distintos, debilitando un lado.' },
      { id: 'corte_desnivelado',    label: 'Corte desnivelado',           description: 'El aserrado de la ranura no está perpendicular al eje de la pieza.' },
      { id: 'ajuste_forzado',       label: 'Ajuste forzado',              description: 'El ancho de la ranura es inferior al de la pieza macho; riesgo de fractura.' },
      { id: 'profundidad_excesiva', label: 'Profundidad excesiva',        description: 'La ranura penetra más allá del tercio de la sección, comprometiendo la resistencia.' },
    ],
  },

  // ── N4 ─────────────────────────────────────────────────────────────────
  {
    id: 'N4',
    jointType: 'N4 - Ensamble a Media Madera',
    stlUrls: { url: '/models/04-media-madera.stl' },
    injectedError: { id: 'rebaje_excesivo', label: 'Rebaje excesivo (más de ½ espesor)' },
    errorOptions: [
      { id: 'rebaje_excesivo',      label: 'Rebaje excesivo (> ½)',       description: 'Se removió más de la mitad del espesor, debilitando la sección.' },
      { id: 'rebaje_insuficiente',  label: 'Rebaje insuficiente (< ½)',   description: 'El rebaje no alcanza la mitad; las superficies no enrasan.' },
      { id: 'angulo_incorrecto',    label: 'Ángulo de corte incorrecto',  description: 'El plano de rebaje no es perpendicular al eje de la pieza.' },
      { id: 'ajuste_suelto',        label: 'Ajuste muy suelto',           description: 'Holgura excesiva entre las caras de rebaje.' },
    ],
  },

  // ── N5 ─────────────────────────────────────────────────────────────────
  {
    id: 'N5',
    jointType: 'N5 - Ensamble a Cola de Milano',
    stlUrls: { url: '/models/05-cola-milano.stl' },
    injectedError: { id: 'angulo_cola_incorrecto', label: 'Ángulo de cola incorrecto' },
    errorOptions: [
      { id: 'angulo_cola_incorrecto', label: 'Ángulo de cola incorrecto',   description: 'El ángulo del trapecio difiere del nominal (1:6 madera blanda / 1:8 dura).' },
      { id: 'cola_muy_estrecha',      label: 'Cola demasiado estrecha',     description: 'Reducción excesiva de la base de la cola; resistencia a tracción disminuida.' },
      { id: 'ajuste_forzado',         label: 'Ajuste forzado',              description: 'La cola no entra sin fuerza; riesgo de astillado en las paredes del hueco.' },
      { id: 'asimetria_lateral',      label: 'Asimetría lateral',           description: 'Los flancos de la cola no son especulares; genera tensión desigual al ensamblar.' },
    ],
  },

  // ── N6 ─────────────────────────────────────────────────────────────────
  {
    id: 'N6',
    jointType: 'N6 - Junta a Tarugo',
    stlUrls: { url: '/models/06-junta-tarugo.stl' },
    injectedError: { id: 'separacion_excesiva', label: 'Separación excesiva entre tarugos' },
    errorOptions: [
      { id: 'separacion_excesiva',  label: 'Separación excesiva entre tarugos', description: 'La distancia entre tarugos supera 150 mm; la junta es propensa al pandeo.' },
      { id: 'tarugo_descentrado',   label: 'Tarugo descentrado',                description: 'Las perforaciones de ambas piezas no coinciden en el eje.' },
      { id: 'diametro_perforacion', label: 'Diámetro de perforación incorrecto', description: 'El diámetro de la perforación no coincide con el del tarugo.' },
      { id: 'profundidad_pareja',   label: 'Profundidades desiguales',           description: 'Una perforación es más profunda que la otra, impidiendo el enrase.' },
    ],
  },

  // ── N7 ─────────────────────────────────────────────────────────────────
  {
    id: 'N7',
    jointType: 'N7 - Junta Machihembrada',
    stlUrls: { url: '/models/07-junta-machihembrada.stl' },
    injectedError: { id: 'lengüeta_descentrada', label: 'Lengüeta descentrada' },
    errorOptions: [
      { id: 'lengüeta_descentrada', label: 'Lengüeta descentrada',      description: 'La ranura de la hembra no está centrada en el espesor de la pieza.' },
      { id: 'ajuste_muy_suelto',    label: 'Ajuste muy suelto',         description: 'La lengüeta entra con holgura; la junta se abre bajo esfuerzo.' },
      { id: 'profundidad_ranura',   label: 'Profundidad de ranura insuficiente', description: 'La ranura es más corta que la lengüeta; el enrase es imposible.' },
      { id: 'ajuste_forzado',       label: 'Ajuste forzado',            description: 'La lengüeta requiere golpe para entrar; riesgo de astillado.' },
    ],
  },

  // ── N8 ─────────────────────────────────────────────────────────────────
  {
    id: 'N8',
    jointType: 'N8 - Junta a Media Madera',
    stlUrls: { url: '/models/08-junta-media-madera.stl' },
    injectedError: { id: 'rebaje_asimetrico', label: 'Rebaje asimétrico' },
    errorOptions: [
      { id: 'rebaje_asimetrico',    label: 'Rebaje asimétrico',          description: 'El rebaje en una pieza es mayor que en la otra; la junta no queda al ras.' },
      { id: 'angulo_incorrecto',    label: 'Ángulo de corte incorrecto', description: 'El plano del rebaje no es perpendicular al eje longitudinal.' },
      { id: 'ajuste_suelto',        label: 'Ajuste muy suelto',          description: 'Holgura excesiva en la zona de contacto.' },
      { id: 'superficie_irregular', label: 'Superficie irregular',       description: 'El fondo del rebaje presenta ondulaciones por avance incorrecto de la fresa.' },
    ],
  },

  // ── N9 ─────────────────────────────────────────────────────────────────
  {
    id: 'N9',
    jointType: 'N9 - Empalme a Media Madera',
    stlUrls: { url: '/models/09-empalme-media-madera.stl' },
    injectedError: { id: 'longitud_empalme', label: 'Longitud de empalme insuficiente' },
    errorOptions: [
      { id: 'longitud_empalme',     label: 'Longitud de empalme insuficiente', description: 'El solapamiento no alcanza el mínimo de 1.5× la anchura de la pieza.' },
      { id: 'rebaje_excesivo',      label: 'Rebaje excesivo',                  description: 'Se removió más de la mitad del espesor en la zona de empalme.' },
      { id: 'desalineacion',        label: 'Desalineación longitudinal',        description: 'Los ejes de las dos piezas no son colineales al unirlas.' },
      { id: 'ajuste_suelto',        label: 'Ajuste muy suelto',                description: 'Holgura entre las caras de contacto del empalme.' },
    ],
  },

  // ── N10 ────────────────────────────────────────────────────────────────
  {
    id: 'N10',
    jointType: 'N10 - Empalme a Horquilla',
    stlUrls: { url: '/models/10-empalme-horquilla.stl' },
    injectedError: { id: 'horquilla_asimetrica', label: 'Horquilla asimétrica' },
    errorOptions: [
      { id: 'horquilla_asimetrica', label: 'Horquilla asimétrica',        description: 'Los brazos de la horquilla tienen espesores distintos.' },
      { id: 'ajuste_forzado',       label: 'Ajuste forzado',              description: 'La lengüeta no entra sin fuerza en la ranura de la horquilla.' },
      { id: 'profundidad_excesiva', label: 'Profundidad excesiva',        description: 'La ranura es más profunda que la longitud de la lengüeta.' },
      { id: 'corte_desnivelado',    label: 'Corte desnivelado',           description: 'El plano de corte de la horquilla no es perpendicular.' },
    ],
  },

  // ── N11 ────────────────────────────────────────────────────────────────
  {
    id: 'N11',
    jointType: 'N11 - Empalme a Media Madera con Horquilla',
    stlUrls: { url: '/models/11-empalme-horquilla-media.stl' },
    injectedError: { id: 'desalineacion', label: 'Desalineación del empalme' },
    errorOptions: [
      { id: 'desalineacion',        label: 'Desalineación del empalme',   description: 'Los ejes de las piezas forman un ángulo no deseado al ensamblar.' },
      { id: 'rebaje_excesivo',      label: 'Rebaje excesivo',             description: 'El rebaje de media madera supera el 50 % del espesor.' },
      { id: 'horquilla_asimetrica', label: 'Horquilla asimétrica',        description: 'Los brazos de la horquilla tienen espesores desiguales.' },
      { id: 'longitud_empalme',     label: 'Longitud de empalme corta',   description: 'El solapamiento es insuficiente para garantizar la resistencia.' },
    ],
  },
];

// ── Componente App ─────────────────────────────────────────────────────────

export default function App() {
  const [fichaActiva, setFichaActiva]   = useState(FICHAS[1]); // N2 por defecto
  const [kpiLog, setKpiLog]             = useState([]);
  const [componentKey, setComponentKey] = useState(0);

  const handleComplete = useCallback(({ kpiResults }) => {
    console.log('[Plataforma] KPIs recibidos:', kpiResults);
    setKpiLog((prev) => [{
      ficha     : fichaActiva.id,
      jointType : fichaActiva.jointType,
      timestamp : new Date().toLocaleTimeString('es-PE'),
      ...kpiResults,
    }, ...prev]);
  }, [fichaActiva]);

  const handleFichaChange = (ficha) => {
    setFichaActiva(ficha);
    setComponentKey((k) => k + 1);
  };

  return (
    <div className="demo-root">

      {/* ── Header ── */}
      <header className="demo-header">
        <div className="demo-header-content">
          <div className="demo-logo">🪵 MSE-SFT Ebanistería</div>
          <span className="demo-badge">Demo · SimuladorDiagnostico3D · {FICHAS.length} fichas STL</span>
        </div>
      </header>

      {/* ── Selector de fichas ── */}
      <div className="demo-controls">
        <span className="demo-controls-label">Ficha activa:</span>
        <div className="demo-tabs">
          {FICHAS.map((f) => (
            <button
              key={f.id}
              className={`demo-tab ${fichaActiva.id === f.id ? 'demo-tab--active' : ''}`}
              onClick={() => handleFichaChange(f)}
            >
              {f.id}
            </button>
          ))}
        </div>
      </div>

      {/* ── Props en tiempo real ── */}
      <div className="demo-props-info">
        <div className="demo-prop">
          <span className="demo-prop-key">jointType</span>
          <span className="demo-prop-val">"{fichaActiva.jointType}"</span>
        </div>
        <div className="demo-prop">
          <span className="demo-prop-key">stlUrls.url</span>
          <span className="demo-prop-val">"{fichaActiva.stlUrls?.url}"</span>
        </div>
        <div className="demo-prop">
          <span className="demo-prop-key">injectedError</span>
          <span className="demo-prop-val">"{fichaActiva.injectedError.label}"</span>
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
                <span className="demo-kpi-log-time">
                  [{entry.timestamp}] {entry.jointType}
                </span>
                <div className="demo-kpi-log-values">
                  <span className={entry.diagnosticoCorrecto ? 'demo-kpi-ok' : 'demo-kpi-fail'}>
                    diagnosticoCorrecto: {String(entry.diagnosticoCorrecto)}
                  </span>
                  <span>tiempoInspeccion: {entry.tiempoInspeccion}s</span>
                  <span className={entry.piezasInspeccionadas ? 'demo-kpi-ok' : 'demo-kpi-fail'}>
                    piezasInspeccionadas: {String(entry.piezasInspeccionadas)}
                  </span>
                  <span>error: "{entry.errorSeleccionado}"</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

    </div>
  );
}
