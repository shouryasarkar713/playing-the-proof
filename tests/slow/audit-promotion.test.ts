// AUDIT (, slow tier): the REAL promotion path k=5 win (7 points)
// -> "Grow to 6" (continue bootstrap) -> k=6 vs Breaker B0 in each route and
// a random/targeted B1. The prior k6 drivers only bootstrap from bare 5-point
// pentagons ("scaled 7-point driving is NOT claimed").
import { describe, expect, it } from "vitest";
import { growToSixBlock } from "../../src/ui/modes/promote.ts";
import { checkPlacement } from "../../src/game/legality.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import { holeToPointList } from "../../src/engine/init.ts";
import type { StrategyStart } from "../../src/game/types.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";
import { convexPosition, hull } from "../../src/geometry/hull.ts";
import { findKHoles } from "../../src/geometry/holes.ts";
import { orient } from "../../src/geometry/predicates.ts";
import { mulberry32, testCtx } from "../helpers.ts";
import { ensureK5 } from "../strategies/k5driver.ts";
import { ensureK6, forcedRegion } from "../strategies/k6driver.ts";

ensureK5();
ensureK6();

function rr(rand: () => number, mag: number, den: number): Rat {
  return Rat.make(BigInt(Math.floor((rand() * 2 - 1) * mag * den)), BigInt(den));
}

function sharpBary(poly: readonly Pt[], rand: () => number, power: number): Pt {
  const ws = poly.map(() => BigInt(Math.max(1, Math.round((Math.pow(rand(), power) + 1e-4) * 100000))));
  const tot = ws.reduce((a, b) => a + b, 0n);
  let x = Rat.ZERO;
  let y = Rat.ZERO;
  poly.forEach((p, i) => {
    const w = Rat.make(ws[i] as bigint, tot);
    x = x.add(p.x.mul(w));
    y = y.add(p.y.mul(w));
  });
  return pt(x, y);
}

describe("audit slow: promotion k5 -> k6", () => {
  it("every offered promotion wins; every refusal is exactly the even-count (Breaker-completed) case", { timeout: 3000000 }, () => {
    const N = Number(process.env["N"] ?? 80);
    const rand = mulberry32(Number(process.env["SEED"] ?? 4242));
    const ctx = testCtx();
    const tally: Record<string, number> = {};
    const bump = (k: string): void => {
      tally[k] = (tally[k] ?? 0) + 1;
    };
    const notes: string[] = [];
    for (let g = 0; g < N; g += 1) {
      // --- k=5 game to a win -------------------------------------------------
      const s5 = new Store();
      const st = startSession(
        { kind: "guided", config: { mode: "break", window: ctx.config.window }, strategyId: "esmb-k5", mode: "break" },
        ctx,
        s5,
      );
      if (st.status !== "accepted") {
        bump("k5-start-rejected");
        continue;
      }
      const place5 = (c: Pt): boolean => {
        const act = { kind: "place" as const, owner: "breaker" as const, at: c };
        const r = reduceTransaction(s5.current(), act, ctx);
        if (r.status !== "accepted") {
          return false;
        }
        commit(r, act, s5, ctx);
        return true;
      };
      const legal5 = (accept?: (c: Pt) => boolean): Pt | null => {
        for (let t = 0; t < 400; t += 1) {
          const c = pt(rr(rand, 40, 1), rr(rand, 40, 1));
          if (accept !== undefined && !accept(c)) {
            continue;
          }
          if (checkPlacement(s5.current(), c, ctx.config.window) === null) {
            return c;
          }
        }
        return null;
      };
      const b1 = legal5();
      if (b1 === null || !place5(b1)) {
        continue;
      }
      const four = s5.current().points.map((p) => p.pt);
      const b2 = legal5((c) => !convexPosition([...four, c]));
      if (b2 === null || !place5(b2)) {
        continue;
      }
      const b3 = legal5();
      if (b3 === null || !place5(b3)) {
        continue;
      }
      const fin5 = s5.current();
      if (fin5.terminal?.kind !== "maker-won" || fin5.k !== 5) {
        bump("k5-not-won");
        continue;
      }
      // --- promotion record (mirrors ui/modes/promote.ts assembleContinue) ----
      const witness = fin5.terminal.witness[0];
      const conv = witness === undefined ? null : holeToPointList(witness, fin5.points);
      const record: StrategyStart = {
        kind: "continue",
        points: fin5.points.map((p) => p.pt),
        owners: fin5.points.map((p) => p.owner),
        selectedHole: conv !== null && conv.ok ? [...conv.pts] : null,
      };
      // --- k=6 session --------------------------------------------------------
      const s6 = new Store();
      const blockedReason = growToSixBlock(fin5);
      const st6 = startSession(
        {
          kind: "guided",
          config: { mode: "break", window: ctx.config.window },
          strategyId: "esmb-k6",
          mode: "break",
          strategyStart: record,
        },
        ctx,
        s6,
      );
      expect(blockedReason === null).toBe(st6.status === "accepted");
      if (st6.status !== "accepted") {
        bump("k6-bootstrap-rejected:" + (st6.error?.code ?? "?"));
        continue;
      }
      if (s6.current().terminal !== null) {
        bump("k6-already-terminal:" + s6.current().terminal?.kind);
        continue;
      }
      const p5ids = s6.current().strategy?.vars["P5"] as string[];
      const byId = new Map(s6.current().points.map((p) => [p.id, p.pt]));
      const p5 = p5ids.map((id) => byId.get(id) as Pt);
      const fr = forcedRegion(hull([...p5]));
      const modes = ["forced", "forced", "ear", "outside"] as const;
      const mode = modes[g % 4] as (typeof modes)[number];
      let b0: Pt | null = null;
      for (let t = 0; t < 300 && b0 === null; t += 1) {
        let c: Pt;
        if (mode === "forced") {
          c = sharpBary(fr, rand, [1, 3, 6][t % 3] as number);
        } else if (mode === "ear") {
          const vi = Math.floor(rand() * 5);
          c = sharpBary([p5[(vi + 4) % 5] as Pt, p5[vi] as Pt, p5[(vi + 1) % 5] as Pt], rand, 2);
        } else {
          c = pt(rr(rand, 80, 3), rr(rand, 80, 3));
        }
        if (checkPlacement(s6.current(), c, ctx.config.window) === null) {
          b0 = c;
        }
      }
      if (b0 === null) {
        bump("no-b0:" + mode);
        continue;
      }
      const act0 = { kind: "place" as const, owner: "breaker" as const, at: b0 };
      const r0 = reduceTransaction(s6.current(), act0, ctx);
      if (r0.status !== "accepted") {
        bump("b0-rejected");
        continue;
      }
      commit(r0, act0, s6, ctx);
      let cur = s6.current();
      if (cur.terminal === null) {
        // B1: random or inside a current 5-hole
        const fives = findKHoles(cur.points.map((p) => ({ id: p.id, pt: p.pt })), 5, {
          mode: "exhaustive",
          budget: ctx.config.analysis.budgetOps,
        });
        let b1c: Pt | null = null;
        for (let t = 0; t < 300 && b1c === null; t += 1) {
          let c: Pt;
          if (fives.kind === "exhaustive" && fives.holes.length > 0 && t % 2 === 0) {
            const h = fives.holes[Math.floor(rand() * fives.holes.length)]!;
            c = sharpBary(h.verts.map((id) => cur.points.find((p) => p.id === id)!.pt), rand, 2);
          } else {
            c = pt(rr(rand, 80, 3), rr(rand, 80, 3));
          }
          if (checkPlacement(cur, c, ctx.config.window) === null) {
            b1c = c;
          }
        }
        if (b1c === null) {
          bump("no-b1");
          continue;
        }
        const act1 = { kind: "place" as const, owner: "breaker" as const, at: b1c };
        const r1 = reduceTransaction(cur, act1, ctx);
        if (r1.status !== "accepted") {
          bump("b1-rejected");
          continue;
        }
        commit(r1, act1, s6, ctx);
        cur = s6.current();
      }
      const t = cur.terminal;
      const key = `${mode}:${t?.kind ?? "none"}`;
      bump(key);
      if (t === null || t.kind !== "maker-won") {
        if (notes.length < 10) {
          const detail =
            t?.kind === "strategy-integrity-failure"
              ? `${t.report.failedAt}/${t.report.failed.id}/${t.report.phase}: ${t.report.failed.detail}`
              : t?.kind === "uncovered"
                ? JSON.stringify(t.report).slice(0, 200)
                : "";
          notes.push(
            `g${g} ${key} ${detail} pts=${cur.points.map((p) => p.owner[0] + `(${p.pt.x.toString()},${p.pt.y.toString()})`).join(" ")}`,
          );
        }
      }
      void orient;
    }
    for (const key of Object.keys(tally)) {
      expect(key.endsWith(":maker-won") || key === "k6-bootstrap-rejected:parity").toBe(true);
    }
    void notes;
  });
});
