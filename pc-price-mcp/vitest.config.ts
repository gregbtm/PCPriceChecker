import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Every test file gets its own module registry, so db.ts opens its own in-memory database.
    env: { DB_PATH: ':memory:' },
  },
});
