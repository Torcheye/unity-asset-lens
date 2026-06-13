import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "cli/index": "src/cli/index.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  dts: { entry: { index: "src/index.ts" } },
  clean: true,
  sourcemap: true,
  // better-sqlite3 is a native module; playwright-core is an optional, lazily
  // loaded dependency. Never bundle either.
  external: ["better-sqlite3", "playwright-core"],
});
