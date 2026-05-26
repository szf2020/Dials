import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base must match the GitHub Pages subpath: artofpilgrim.github.io/Dials/
export default defineConfig({
  base: '/Dials/',
  plugins: [react()],
});
