import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/cli/**",
        "src/**/*.d.ts",
        "src/index.ts",
        // Drives a live browser via Playwright; verified manually, not in unit tests.
        "src/auth/playwrightLauncher.ts",
      ],
    },
  },
});
