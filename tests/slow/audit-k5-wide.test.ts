// AUDIT (, slow tier): k=5 strategy against a much wider Breaker
// distribution than the prior drivers (integers in [-40,40]): rationals,
// window-edge coordinates, near-existing-point and near-line perturbations,
// B2 in swallow wedges, B3 inside/at the trapezoid boundary.
import { describe, expect, it } from "vitest";
import { checkPlacement } from "../../src/game/legality.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";
import { convexPosition } from "../../src/geometry/hull.ts";
import { mulberry32, testCtx } from "../helpers.ts";
import { ensureK5 } from "../strategies/k5driver.ts";

ensureK5();

function rr(rand: () => number, mag: number, den: number): Rat {
  const n = BigInt(Math.floor((rand() * 2 - 1) * mag * den));
  return Rat.make(n, BigInt(den));
}

function sample(rand: () => number, pts: readonly Pt[]): Pt {
  const kind = Math.floor(rand() * 7);
  switch (kind) {
    case 0:
      return pt(rr(rand, 40, 1), rr(rand, 40, 1));
    case 1:
      return pt(rr(rand, 60, 997), rr(rand, 60, 991));
    case 2: // window edge
      return pt(rr(rand, 999999, 1), rr(rand, 999999, 1));
    case 3: { // very near an existing point
      const p = pts[Math.floor(rand() * pts.length)] as Pt;
      return pt(p.x.add(rr(rand, 1, 1000003)), p.y.add(rr(rand, 1, 1000003)));
    }
    case 4: { // near a line through two existing points
      const i = Math.floor(rand() * pts.length);
      let j = Math.floor(rand() * pts.length);
      if (j === i) {
        j = (i + 1) % pts.length;
      }
      const a = pts[i] as Pt;
      const b = pts[j] as Pt;
      const t = rr(rand, 3, 1000);
      const x = a.x.add(b.x.sub(a.x).mul(t));
      const y = a.y.add(b.y.sub(a.y).mul(t));
      return pt(x.add(rr(rand, 1, 100003)), y.add(rr(rand, 1, 100003)));
    }
    case 5: { // convex-combination of existing points (inside hull), sharp
      const w = pts.map(() => BigInt(Math.floor(Math.pow(rand(), 4) * 1000) + 1));
      const tot = w.reduce((s, v) => s + v, 0n);
      let x = Rat.ZERO;
      let y = Rat.ZERO;
      pts.forEach((p, i) => {
        const c = Rat.make(w[i] as bigint, tot);
        x = x.add(p.x.mul(c));
        y = y.add(p.y.mul(c));
      });
      return pt(x, y);
    }
    default: // moderately large
      return pt(rr(rand, 5000, 7), rr(rand, 5000, 13));
  }
}

describe("audit slow: k5 wide adversary", () => {
  it("every game is a maker-won", { timeout: 3000000 }, () => {
    const N = Number(process.env["N"] ?? 600);
    const rand = mulberry32(Number(process.env["SEED"] ?? 99));
    const ctx = testCtx();
    const tally: Record<string, number> = {};
    const bump = (k: string): void => {
      tally[k] = (tally[k] ?? 0) + 1;
    };
    const notes: string[] = [];
    for (let g = 0; g < N; g += 1) {
      const store = new Store();
      const s0 = startSession(
        { kind: "guided", config: { mode: "break", window: ctx.config.window }, strategyId: "esmb-k5", mode: "break" },
        ctx,
        store,
      );
      if (s0.status !== "accepted") {
        bump("start-rejected");
        continue;
      }
      const legalSample = (accept?: (c: Pt) => boolean): Pt | null => {
        const pts = store.current().points.map((p) => p.pt);
        for (let t = 0; t < 400; t += 1) {
          const c = sample(rand, pts);
          if (accept !== undefined && !accept(c)) {
            continue;
          }
          if (checkPlacement(store.current(), c, ctx.config.window) === null) {
            return c;
          }
        }
        return null;
      };
      const play = (c: Pt): boolean => {
        const act = { kind: "place" as const, owner: "breaker" as const, at: c };
        const r = reduceTransaction(store.current(), act, ctx);
        if (r.status !== "accepted") {
          bump("rejected-" + r.status);
          return false;
        }
        commit(r, act, store, ctx);
        return true;
      };
      const b1 = legalSample();
      if (b1 === null || !play(b1)) {
        bump("no-b1");
        continue;
      }
      const four = store.current().points.map((p) => p.pt);
      const blunder = g % 25 === 0;
      const b2 = legalSample((c) => (blunder ? convexPosition([...four, c]) : !convexPosition([...four, c])));
      if (b2 === null || !play(b2)) {
        bump("no-b2");
        continue;
      }
      if (store.current().terminal === null) {
        const b3 = legalSample();
        if (b3 === null || !play(b3)) {
          bump("no-b3");
          continue;
        }
      }
      const t = store.current().terminal;
      const key = (blunder ? "blunder:" : "safe:") + (t?.kind ?? "none");
      bump(key);
      if (t === null || t.kind !== "maker-won") {
        if (notes.length < 8) {
          const pts = store.current().points.map((p) => `(${p.pt.x.toString()},${p.pt.y.toString()})`).join(" ");
          const detail =
            t?.kind === "uncovered"
              ? JSON.stringify(t.report, (_k, v) => (typeof v === "bigint" ? String(v) : v)).slice(0, 300)
              : t?.kind === "strategy-integrity-failure"
                ? `${t.report.failedAt}/${t.report.failed.id}: ${t.report.failed.detail}`
                : "";
          notes.push(`g${g} ${key} ${detail} pts=${pts}`);
        }
      }
    }
    expect(Object.keys(tally).sort()).toEqual(["blunder:maker-won", "safe:maker-won"]);
    expect((tally["blunder:maker-won"] ?? 0) + (tally["safe:maker-won"] ?? 0)).toBe(N);
    void notes;
  });
});
