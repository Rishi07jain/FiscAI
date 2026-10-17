import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { NODE_ENV: 'test', GEMINI_API_KEY: '', REDIS_URL: '', MONGODB_URI: '' },
    testTimeout: 60000,
    hookTimeout: 120000,
    fileParallelism: false,
  },
});
