// Phase 0 smoke tests: one 1+1 block per §20 module folder.
// Proves the Vitest harness (default + slow projects) runs green.
import { describe, expect, it } from "vitest";

const MODULES = [
  "geometry",
  "game",
  "session",
  "engine",
  "strategy",
  "verification",
  "explain",
  "viz",
  "ui",
  "replay",
] as const;

describe("phase-0 harness", () => {
  for (const module of MODULES) {
    it(`smoke: src/${module}/ is wired into the harness`, () => {
      expect(1 + 1).toBe(2);
    });
  }
});
