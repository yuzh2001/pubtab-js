import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/browser/**/*.browser.test.ts'],
        },
      },
      {
        test: {
          name: 'browser',
          include: ['tests/browser/**/*.browser.test.ts'],
          environment: 'jsdom',
          setupFiles: ['./tests/browser/setup.ts'],
        },
      },
    ],
  },
});
