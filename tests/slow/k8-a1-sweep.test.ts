// Slow tier: the A1 question of the k=8 walkthrough over EVERY B0 cell of several
// non-congruent heptagons (preset, random integer, rational, near-degenerate).
// For each B0 cell the engine runs B0 -> pair -> A1 -> twins. Any B0 for which the
// chain ends as a typed uncovered terminal is re-examined exhaustively over the
// whole plane (cell representatives of the pair-line arrangement); the test
// requires that every such case has NO admissible A1 at all (a genuine gap of the
// reconstruction), never an admissible point the search missed.
import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Pt } from "../../src/geometry/pt.ts";
import { placePoint } from "../../src/game/place.ts";
import { testCtx } from "../helpers.ts";
import { mulberry } from "../strategies/k7driver.ts";
import { HEPTAGON, breakerMove, initK8 } from "../strategies/k8driver.ts";
import { flatHeptagon, randomHeptagon, rationalHeptagon } from "../strategies/k8gen.ts";
import { a1Census } from "../strategies/k8a1.ts";
import { cellReps, verifyEight } from "../strategies/k8tree.ts";

const rand = mulberry(4242);
const FAMILIES: Array<[string, Pt[]]> = [
  ["preset", [...HEPTAGON]],
  ["integer-a", randomHeptagon(rand, 40, 1, 1)],
  ["integer-b", randomHeptagon(rand, 40, 2, 1)],
  ["rational", rationalHeptagon(rand, 30, 7)],
  ["flat", flatHeptagon(rand, 700)],
];

describe("k8 A1 sweep over every B0 cell", () => {
  for (const [name, hept] of FAMILIES) {
    it(name, { timeout: 3_600_000 }, () => {
      const ctx = testCtx();
      const s0 = initK8(ctx, { kind: "supplied", points: [...hept], selectedHole: [...hept] });
      const tally: Record<string, number> = {};
      const gaps: string[] = [];
      let missed = 0;
      for (const r of cellReps(s0.points.map((p) => p.pt), ctx)) {
        const st = breakerMove(s0, r, ctx);
        if (st === null) {
          continue;
        }
        const key = `${st.caseId ?? "?"}|${st.state.terminal?.kind ?? st.state.strategy?.nodeId}`;
        tally[key] = (tally[key] ?? 0) + 1;
        if (st.state.terminal?.kind === "maker-won") {
          expect(verifyEight(st.state)).toBeNull();
        }
        if (st.state.terminal?.kind === "uncovered") {
          const hypo = placePoint(s0, "breaker", r);
          const b0Id = hypo.points[hypo.points.length - 1]?.id as string;
          const c = a1Census(hypo, b0Id, ctx, 1);
          if (c.admissible > 0) {
            missed += 1;
          } else {
            gaps.push(`${r.x.toString()},${r.y.toString()} (cells=${c.cells})`);
          }
        }
      }
      const out = process.env["K8_GATE_EVIDENCE"];
      if (out !== undefined && out !== "") {
        appendFileSync(out, JSON.stringify({ name, hept: hept.map((p) => `${p.x.toString()},${p.y.toString()}`), tally, missed, gaps }) + "\n");
      }
      expect(missed).toBe(0);
    });
  }
});
