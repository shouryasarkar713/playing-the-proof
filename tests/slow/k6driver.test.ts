// tests/slow/k6driver.test.ts — SLOW TIER (excluded from `verify`).
// M6 sign-off: full 1000-game runs (k6-src + k6-immediate) at 100% wins,
// plus the experimental wide-def driver (NOT an acceptance criterion —
// evidence for the extension only, §24.7 item 4).
import { describe, expect, it } from "vitest";
import { playK6Game, runK6Suite } from "../strategies/k6driver.ts";
import { mulberry32 } from "../helpers.ts";

describe("k6-src full driver (slow, M6 sign-off)", () => {
  it("1000 forced-B0 games (B1 mixed), 100% maker-won", () => {
    const { wins, games, failures } = runK6Suite(1000, 20260925, "forced", "mixed");
    expect(failures).toEqual([]);
    expect(wins).toBe(games);
  }, 1800000);
});

describe("k6-immediate full driver (slow, M6 sign-off)", () => {
  it("1000 outside/ear-B0 games, 100% maker-won", () => {
    const { wins, games, failures } = runK6Suite(1000, 30303, "immediate-mixed", "random");
    expect(failures).toEqual([]);
    expect(wins).toBe(games);
  }, 1800000);
});

describe("k6-wide experimental driver (slow, NOT acceptance)", () => {
  it("200 anywhere-inside games: wins or fail-closed escape-post integrity", () => {
    // Ear-B0 through the construction twins measurably less reliably than
    // forced-B0 (the beyond-source behavior this tier quarantines).
    // Measured 2026-09-25 (seed 40404): 190 wins + 10 escape-post integrity
    // failures of 200 — every non-win fail-closed, none silent. What is
    // asserted: every game ends HONESTLY — a Maker win, or the escape
    // twin-post integrity failure (captured-fixture shape), never a silent
    // misroute, a crash, or any other terminal. Evidence for the extension
    // only.
    const rand = mulberry32(40404);
    let wins = 0;
    let honest = 0;
    for (let i = 0; i < 200; i += 1) {
      const g = playK6Game(
        rand,
        i % 2 === 0 ? "forced" : "ear",
        i % 2 === 0 ? "random" : "targeted",
        "esmb-k6-wide",
      );
      if (g.won) {
        wins += 1;
      } else {
        expect(g.terminalKind).toBe("strategy-integrity-failure");
        expect(g.integrity).toEqual({ at: "k6:r5:escape", id: "k6-inv:twins" });
        honest += 1;
      }
    }
    expect(wins + honest).toBe(200);
    expect(wins).toBeGreaterThan(0);
  }, 1200000);
});
