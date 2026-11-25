import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import apiDevPlugin from './scripts/vite-api-plugin.js'

// https://vite.dev/config/
// apiDevPlugin serves api/ during `npm run dev` (see scripts/vite-api-plugin.js).
export default defineConfig({
  plugins: [react(), apiDevPlugin()],
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx}', 'api/**/*.js'],
      exclude: ['src/data/**'],
      reporter: ['text-summary', 'text', 'html'],
    },
    // Unit tests (tests/unit) run in Node. Integration tests (tests/integration)
    // render the whole app in jsdom against a fake backend; see
    // tests/integration/helpers/fakeBackend.js.
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['tests/unit/**/*.test.{js,jsx}'], environment: 'node' },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.{js,jsx}'],
          environment: 'jsdom',
          setupFiles: ['tests/integration/helpers/setup.js'],
          testTimeout: 20000,
        },
      },
    ],
  },
})
