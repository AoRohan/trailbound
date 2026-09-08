import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `base` matters for GitHub Pages, which serves the site from /<repo>/.
// The Pages workflow sets VITE_BASE; local dev and the Capacitor build leave it
// unset and get '/', which is what both of those need.
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE ?? '/',
  build: {
    // Capacitor copies this directory into the APK.
    outDir: 'dist',
    target: 'es2022',
  },
})
