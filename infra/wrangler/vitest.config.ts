import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['migrations/test/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    server: {
      deps: {
        external: [/^node:/],
      },
    },
  },
});
