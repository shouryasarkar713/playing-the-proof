// tests/slow/k5driver.test.ts — SLOW TIER (excluded from `verify`).
// M5 sign-off: the full 1000-game safe run + the 200-game blunder run,
// 100% maker-won — empirical evidence, never proof (§26F; mirrors §2.6).
import { describe, expect, it } from "vitest";
import { playK5Game, runK5Suite } from "../strategies/k5driver.ts";
import { mulberry32 } from "../helpers.ts";

describe("k5 full safe driver (slow, M5 sign-off)", () => {
  it("1000 safe games, 100% maker-won (seed 20260925)", () => {
    const { wins, games, failures } = runK5Suite(1000, 20260925, "safe");
    expect(failures).toEqual([]);
    expect(wins).toBe(games);
  }, 600000);
});

describe("k5 blunder driver (slow, §23.7 item 6)", () => {
  it("200 convex-B2 games, 100% round-3 wins (seed 60606)", () => {
    const { wins, games, failures } = runK5Suite(200, 60606, "blunder");
    expect(failures).toEqual([]);
    expect(wins).toBe(games);
  }, 600000);
});

describe("k5 blunder point count (slow)", () => {
  it("blunder games end with 5 points at k5:win", () => {
    const rand = mulberry32(99);
    for (let i = 0; i < 10; i += 1) {
      const g = playK5Game(rand, "blunder");
      expect(g.won).toBe(true);
      expect(g.points).toBe(5);
      expect(g.nodeId).toBe("k5:win");
    }
  }, 300000);
});
