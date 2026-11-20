import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";

// Deliberately separate from npm test. These tests write disposable synthetic
// Studies to the DEVELOPMENT Supabase project and must be run only by opt-in.
// The existing PowerShell launcher supplies private credentials ephemerally.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: [
      "tests/integration/independent-authorization.integration.test.ts",
      "tests/integration/multi-variable-workflow.integration.test.ts",
    ],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 120_000,
  },
});
