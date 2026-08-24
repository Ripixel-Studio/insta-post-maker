import { defineConfig } from 'vitest/config';

// Standalone config so unit tests skip the app's Vite/PWA plugin stack. Two
// suites run under this one glob: the pure Anthropic client
// (`src/ai/client.test.ts`), which only needs a mocked `fetch`, and the
// store/action layer (`src/actions.test.ts`), which wants `document`. jsdom is
// the superset that satisfies both — it provides `document` (fonts no-op
// gracefully without it) while leaving `fetch`/`Response` stubbable. The
// Konva/canvas-dependent export paths are not exercised here.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
