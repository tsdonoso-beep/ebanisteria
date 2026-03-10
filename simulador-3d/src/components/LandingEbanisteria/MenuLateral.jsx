/**
 * MenuLateral.jsx
 * Menú tipo acordeón con las 3 categorías y 11 modelos del catálogo.
 */

import React, { useState } from 'react';
import { CATEGORIAS } from './catalogoData';

export default function MenuLateral({ modeloActivo, onSelectModelo }) {
  const [abiertos, setAbiertos] = useState({ ensambles: true, juntas: true, empalmes: true });

  const toggle = (id) => setAbiertos(p => ({ ...p, [id]: !p[id] }));

  return (
    <nav className="le-menu">
      <div className="le-menu-header">
        <span className="le-menu-logo">🪵</span>
        <div>
          <div className="le-menu-title">Catálogo de Uniones</div>
          <div className="le-menu-subtitle">MSE-SFT Ebanistería · PRONIED</div>
        </div>
      </div>

      {CATEGORIAS.map(cat => (
        <div key={cat.id} className="le-categoria">
          <button className="le-cat-header" onClick={() => toggle(cat.id)}>
            <span>{cat.icon} {cat.label}</span>
            <span className={`le-cat-arrow ${abiertos[cat.id] ? 'le-cat-arrow--open' : ''}`}>▸</span>
          </button>

          {abiertos[cat.id] && (
            <ul className="le-cat-items">
              {cat.items.map(item => (
                <li key={item.id}>
                  <button
                    className={`le-item ${modeloActivo?.id === item.id ? 'le-item--active' : ''}`}
                    onClick={() => onSelectModelo({ ...item, categoria: cat.label })}
                  >
                    <span className="le-item-code">{item.id}</span>
                    <span className="le-item-label">{item.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </nav>
  );
}
