import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Plugin para eliminar type="module" del HTML generado,
// permitiendo abrir index.html directamente desde el sistema de archivos.
function removeModuleType() {
  return {
    name: 'remove-module-type',
    transformIndexHtml(html) {
      return html
        // Reemplaza type="module" por defer para que el script espere al DOM
        .replace(/<script type="module"/g, '<script defer')
        .replace(/ crossorigin/g, '');
    },
  };
}

export default defineConfig({
  plugins: [react(), removeModuleType()],
  // Configuración para el demo local. Al empaquetar como librería
  // cambiar build.lib con la entrada al componente principal.
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        format: 'iife',
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
  // Permite importar STL como URLs de activos estáticos
  assetsInclude: ['**/*.stl'],
});
