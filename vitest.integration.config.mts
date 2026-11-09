import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";

// This file is deliberately separate from vitest.config.mts. Never run this
// database-writing test through ordinary `npm test` or CI unit-test jobs.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/independent-authorization.integration.test.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 120_000,
  },
});
