import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// GitHub Pages serves the site at /<repo-name>/, so assets need that base path.
export default defineConfig({
  base: '/ski-resort-tycoon/',
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
