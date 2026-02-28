import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Configuración para el demo local. Al empaquetar como librería
  // cambiar build.lib con la entrada al componente principal.
  base: './',
  build: {
    outDir: 'dist',
  },
  // Permite importar STL como URLs de activos estáticos
  assetsInclude: ['**/*.stl'],
});
