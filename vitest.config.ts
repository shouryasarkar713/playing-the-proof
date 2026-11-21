import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // cap parallel workers (transient pool spawn flakes skipped a
    // file silently on full-parallel runs).
    maxWorkers: 4,
    // Coverage is NOT part of `verify` (speed): run `npm run coverage`
    // before M-sign-offs and releases. Thresholds are enforced per
    // directory by scripts/check-coverage.mjs (§27.4: geometry/ ≥ 95%
    // lines, strategy/+game/+engine/ ≥ 90%).
    coverage: {
      provider: "v8",
      reporter: ["json-summary", "text", "json"],
      include: ["src/**/*.ts"],
    },
    projects: [
      {
        test: {
          name: "default",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/slow/**", "**/node_modules/**", "**/dist/**"],
          environment: "node",
        },
      },
      {
        test: {
          name: "slow",
          include: ["tests/slow/**/*.test.ts"],
          exclude: ["**/node_modules/**", "**/dist/**"],
          environment: "node",
        },
      },
    ],
  },
});
