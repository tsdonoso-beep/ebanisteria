/**
 * App.jsx — Entry point del demo
 * ─────────────────────────────────────────────────────────────────────────────
 * Monta la LandingEbanisteria como pantalla principal del simulador 3D.
 * El SimuladorDiagnostico3D (evaluación con KPIs) sigue disponible como
 * componente separado para integrarse en la plataforma PRONIED/MINEDU.
 */

import React from 'react';
import LandingEbanisteria from '../components/LandingEbanisteria';

export default function App() {
  return <LandingEbanisteria />;
}
