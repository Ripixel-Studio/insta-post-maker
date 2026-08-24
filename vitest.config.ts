import { defineConfig } from 'vitest/config';

// Unit tests for the pure store/action layer. jsdom gives us `document` (fonts
// no-op gracefully without it); the Konva/canvas-dependent export paths are not
// exercised here.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
