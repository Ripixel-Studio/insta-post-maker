import { defineConfig } from 'vitest/config';

// Standalone config so unit tests skip the app's Vite/PWA plugin stack. The
// current suite covers the pure Anthropic client (`src/ai/client.test.ts`) and
// runs in a plain Node environment with a mocked `fetch`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
