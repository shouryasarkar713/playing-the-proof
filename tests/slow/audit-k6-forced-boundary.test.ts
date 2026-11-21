// AUDIT (, slow tier): stress the k6 forced-route with B0 sampled
// near the boundary of the forced region (the prior driver's barycentric
// weights 1..12 cluster near the centroid).
import { describe, expect, it } from "vitest";
import { checkPlacement } from "../../src/game/legality.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";
import { findKHoles } from "../../src/geometry/holes.ts";
import { hull } from "../../src/geometry/hull.ts";
import { mulberry32, testCtx } from "../helpers.ts";
import {
  ensureK6,
  forcedRegion,
  randomPentagon,
} from "../strategies/k6driver.ts";

ensureK6();

function sharpBary(poly: readonly Pt[], rand: () => number, power: number): Pt {
  const w = poly.map(() => Math.pow(rand(), power) + 1e-6);
  const S = w.reduce((a, b) => a + b, 0);
  let x = Rat.ZERO;
  let y = Rat.ZERO;
  for (let i = 0; i < poly.length; i += 1) {
    // quantise weights to 1/100000 so coordinates stay modest rationals
    const wi = Rat.make(BigInt(Math.max(1, Math.round((w[i]! / S) * 100000))), 100000n);
    x = x.add((poly[i] as Pt).x.mul(wi));
    y = y.add((poly[i] as Pt).y.mul(wi));
  }
  // renormalise by total weight
  let tot = Rat.ZERO;
  for (let i = 0; i < poly.length; i += 1) {
    tot = tot.add(Rat.make(BigInt(Math.max(1, Math.round((w[i]! / S) * 100000))), 100000n));
  }
  return pt(x.div(tot), y.div(tot));
}

describe("audit slow: k6 forced-route boundary stress", () => {
  it("every game is a maker-won (B0 sampled near forced-region edges/vertices; B1 inside a 5-hole)", { timeout: 3000000 }, () => {
    const rand = mulberry32(20261114);
    const ctx = testCtx();
    const out: Record<string, number> = {};
    const fails: string[] = [];
    const N = Number(process.env["N"] ?? 120);
    for (let g = 0; g < N; g += 1) {
      const pent = randomPentagon(rand);
      const store = new Store();
      const started = startSession(
        {
          kind: "guided",
          config: { mode: "break", window: ctx.config.window },
          strategyId: "esmb-k6",
          mode: "break",
          strategyStart: { kind: "supplied", points: pent, selectedHole: [...pent] },
        },
        ctx,
        store,
      );
      if (started.status !== "accepted") {
        out["bootstrap-rejected"] = (out["bootstrap-rejected"] ?? 0) + 1;
        continue;
      }
      const fr = forcedRegion(hull([...pent]));
      if (fr.length < 3) {
        out["empty-forced"] = (out["empty-forced"] ?? 0) + 1;
        continue;
      }
      const power = [1, 3, 6][g % 3] as number;
      let b0: Pt | null = null;
      for (let t = 0; t < 50; t += 1) {
        const c = sharpBary(fr, rand, power);
        if (checkPlacement(store.current(), c, ctx.config.window) === null) {
          b0 = c;
          break;
        }
      }
      if (b0 === null) {
        out["no-b0"] = (out["no-b0"] ?? 0) + 1;
        continue;
      }
      const act = { kind: "place" as const, owner: "breaker" as const, at: b0 };
      const r = reduceTransaction(store.current(), act, ctx);
      if (r.status !== "accepted" || r.nextState === undefined) {
        out["b0-rejected"] = (out["b0-rejected"] ?? 0) + 1;
        continue;
      }
      commit(r, act, store, ctx);
      let st = store.current();
      if (st.terminal !== null) {
        const key = `after-B0:${st.terminal.kind}`;
        out[key] = (out[key] ?? 0) + 1;
        if (st.terminal.kind !== "maker-won" && fails.length < 6) {
          fails.push(
            `g${g} pow${power} after B0: ${st.terminal.kind} ${
              st.terminal.kind === "strategy-integrity-failure"
                ? st.terminal.report.failedAt + "/" + st.terminal.report.failed.id + " " + st.terminal.report.failed.detail
                : JSON.stringify((st.terminal as { report?: unknown }).report)
            } pent=${pent.map((p) => p.x.toString() + "," + p.y.toString()).join(" ")} b0=${b0.x.toString()},${b0.y.toString()}`,
          );
        }
        continue;
      }
      // B1: random legal point near the structure, or inside a 5-hole.
      const fives = findKHoles(
        st.points.map((p) => ({ id: p.id, pt: p.pt })),
        5,
        { mode: "exhaustive", budget: ctx.config.analysis.budgetOps },
      );
      let b1: Pt | null = null;
      if (fives.kind === "exhaustive" && fives.holes.length > 0) {
        const hole = fives.holes[Math.floor(rand() * fives.holes.length)]!;
        const hp = hole.verts.map((id) => st.points.find((p) => p.id === id)!.pt);
        for (let t = 0; t < 100; t += 1) {
          const c = sharpBary(hp, rand, [1, 3][t % 2] as number);
          if (checkPlacement(st, c, ctx.config.window) === null) {
            b1 = c;
            break;
          }
        }
      }
      if (b1 === null) {
        out["no-b1"] = (out["no-b1"] ?? 0) + 1;
        continue;
      }
      const act2 = { kind: "place" as const, owner: "breaker" as const, at: b1 };
      const r2 = reduceTransaction(st, act2, ctx);
      if (r2.status !== "accepted") {
        out["b1-rejected"] = (out["b1-rejected"] ?? 0) + 1;
        continue;
      }
      commit(r2, act2, store, ctx);
      st = store.current();
      const key = `final:${st.terminal?.kind ?? "none"}`;
      out[key] = (out[key] ?? 0) + 1;
      if (st.terminal?.kind !== "maker-won" && fails.length < 6) {
        fails.push(
          `g${g} pow${power} final ${st.terminal?.kind} ${
            st.terminal?.kind === "strategy-integrity-failure"
              ? st.terminal.report.failedAt + "/" + st.terminal.report.failed.id + " " + st.terminal.report.failed.detail
              : ""
          } pent=${pent.map((p) => p.x.toString() + "," + p.y.toString()).join(" ")} b0=${b0.x.toString()},${b0.y.toString()}`,
        );
      }
    }
    expect(Object.keys(out)).toEqual(["final:maker-won"]);
    expect(out["final:maker-won"]).toBe(N);
    void fails;
  });
});
