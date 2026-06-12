import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.itest.ts"],
    testTimeout: 30000,
    hookTimeout: 60000,
    /* DB tests share state - run sequentially. */
    fileParallelism: false,
  },
});
