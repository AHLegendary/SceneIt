import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import apiDevPlugin from './scripts/vite-api-plugin.js'

// https://vite.dev/config/
// apiDevPlugin serves api/ during `npm run dev` (see scripts/vite-api-plugin.js).
export default defineConfig({
  plugins: [react(), apiDevPlugin()],
})
