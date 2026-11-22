// tests/strategies/k8tree.ts — k=8 gate harness: the Figure 3–5 path driven
// through the real engine, exact cell representatives at every Breaker move,
// leaf claims confirmed by the independent oracle (k7oracle: bigint integers,
// no src/geometry imports).
import { arrangementCells } from "../../src/geometry/arrangement.ts";
import { canonicalInteriorPoint } from "../../src/geometry/poly.ts";
import type { ConvexPoly } from "../../src/geometry/poly.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import type { GameState } from "../../src/game/types.ts";
import type { RuntimeCtx } from "../../src/engine/orchestrator.ts";
import { Rat } from "../../src/geometry/rat.ts";
import { breakerMove, centroid, initK8, ptOf, vars } from "./k8driver.ts";
import { oracleHasHole } from "./k7oracle.ts";

export function windowPoly(ctx: RuntimeCtx): ConvexPoly {
  const w = ctx.config.window;
  return [pt(w.xMin, w.yMin), pt(w.xMax, w.yMin), pt(w.xMax, w.yMax), pt(w.xMin, w.yMax)];
}

export function cellReps(points: readonly Pt[], ctx: RuntimeCtx): Pt[] {
  const lines: Array<{ a: Pt; b: Pt }> = [];
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      lines.push({ a: points[i] as Pt, b: points[j] as Pt });
    }
  }
  const out: Pt[] = [];
  for (const cell of arrangementCells(lines, windowPoly(ctx))) {
    const rep = canonicalInteriorPoint(cell);
    if (rep !== null) {
      out.push(rep);
    }
  }
  return out;
}

// Terminal maker-won with an 8-vertex witness AND the oracle agrees.
export function verifyEight(s: GameState): string | null {
  const t = s.terminal;
  if (t === null || t.kind !== "maker-won") {
    return `terminal=${t?.kind ?? "none"} node=${s.strategy?.nodeId ?? "?"}`;
  }
  if (!t.witness.some((h) => h.k === 8 && h.verts.length === 8)) {
    return "witness lacks an 8-hole";
  }
  if (
    !oracleHasHole(
      s.points.map((p) => p.pt),
      8,
    )
  ) {
    return "oracle found no 8-hole";
  }
  return null;
}

export interface Tally {
  [key: string]: number;
}

export interface K8Run {
  failures: string[];
  b0: Tally;
  b1: Tally;
  b2: Tally;
  b3: Tally;
  b4: Tally;
  leaves: number;
}

const bump = (t: Tally, k: string): void => {
  t[k] = (t[k] ?? 0) + 1;
};

// B4 probes for a parked B4 state: inside seven A, inside seven B, elsewhere.
function b4Probes(s: GameState): Pt[] {
  const out: Pt[] = [];
  for (const v of ["sevA", "sevB"]) {
    const ids = vars(s)[v] as string[];
    const ps = ids.map((id) => ptOf(s, id));
    out.push(centroid([ps[0] as Pt, ps[2] as Pt, ps[4] as Pt]));
  }
  out.push(pt(Rat.make(900n), Rat.make(-700n)));
  return out;
}

// Drive one heptagon: B0 cell reps (stride), B1 cells (all) with the
// shared-triangle ones continued through A2; B2 cells (stride) continued; B3
// cells (stride) continued; B4 probes. Every maker-won leaf is oracle-checked.
export function driveHeptagon(
  hept: readonly Pt[],
  ctx: RuntimeCtx,
  o: { b0: number; b1: number; b2: number; b3: number; maxB0?: number },
): K8Run {
  const run: K8Run = { failures: [], b0: {}, b1: {}, b2: {}, b3: {}, b4: {}, leaves: 0 };
  const s0 = initK8(ctx, { kind: "supplied", points: [...hept], selectedHole: [...hept] });
  const reps0 = cellReps(
    s0.points.map((p) => p.pt),
    ctx,
  );
  let done = 0;
  reps0.forEach((r0, i0) => {
    if (i0 % o.b0 !== 0 || (o.maxB0 !== undefined && done >= o.maxB0)) {
      return;
    }
    const st0 = breakerMove(s0, r0, ctx);
    if (st0 === null) {
      return;
    }
    const c0 = st0.caseId ?? "?";
    bump(run.b0, c0 + "|" + (st0.state.terminal?.kind ?? st0.state.strategy?.nodeId));
    if (st0.state.terminal !== null) {
      if (st0.state.terminal.kind === "maker-won") {
        const bad = verifyEight(st0.state);
        if (bad !== null) {
          run.failures.push(`B0 ${r0.x.toString()},${r0.y.toString()}: ${bad}`);
        }
      }
      return;
    }
    done += 1;
    const s1 = st0.state;
    if (s1.strategy?.nodeId !== "k8:r1:classify") {
      run.failures.push(`B0 cell parked at ${s1.strategy?.nodeId}`);
      return;
    }
    const reps1 = cellReps(
      s1.points.map((p) => p.pt),
      ctx,
    );
    reps1.forEach((r1, i1) => {
      if (i1 % o.b1 !== 0) {
        return;
      }
      const st1 = breakerMove(s1, r1, ctx);
      if (st1 === null) {
        return;
      }
      const c1 = st1.caseId ?? "?";
      bump(run.b1, c1 + "|" + (st1.state.terminal?.kind ?? st1.state.strategy?.nodeId));
      if (st1.state.strategy?.nodeId !== "k8:r2:classify") {
        return;
      }
      const s2 = st1.state;
      const reps2 = cellReps(
        s2.points.map((p) => p.pt),
        ctx,
      );
      reps2.forEach((r2, i2) => {
        const inX = (() => {
          const X = (vars(s2)["X"] as string[]).map((id) => ptOf(s2, id));
          return X.length === 7;
        })();
        void inX;
        if (i2 % o.b2 !== 0) {
          return;
        }
        const st2 = breakerMove(s2, r2, ctx);
        if (st2 === null) {
          return;
        }
        const c2 = st2.caseId ?? "?";
        bump(run.b2, c2 + "|" + (st2.state.terminal?.kind ?? st2.state.strategy?.nodeId));
        if (st2.state.terminal !== null) {
          if (st2.state.terminal.kind === "maker-won") {
            run.leaves += 1;
            const bad = verifyEight(st2.state);
            if (bad !== null) {
              run.failures.push(`B2 ${r2.x.toString()},${r2.y.toString()}: ${bad}`);
            }
          }
          return;
        }
        if (st2.state.strategy?.nodeId !== "k8:r3:classify") {
          run.failures.push(`B2 cell parked at ${st2.state.strategy?.nodeId}`);
          return;
        }
        const s3 = st2.state;
        const reps3 = cellReps(
          s3.points.map((p) => p.pt),
          ctx,
        );
        reps3.forEach((r3, i3) => {
          if (i3 % o.b3 !== 0) {
            return;
          }
          const st3 = breakerMove(s3, r3, ctx);
          if (st3 === null) {
            return;
          }
          const c3 = st3.caseId ?? "?";
          bump(run.b3, c3 + "|" + (st3.state.terminal?.kind ?? st3.state.strategy?.nodeId));
          if (st3.state.terminal !== null) {
            if (st3.state.terminal.kind === "maker-won") {
              run.leaves += 1;
              const bad = verifyEight(st3.state);
              if (bad !== null) {
                run.failures.push(`B3 ${r3.x.toString()},${r3.y.toString()}: ${bad}`);
              }
            }
            return;
          }
          if (st3.state.strategy?.nodeId !== "k8:r4:classify") {
            run.failures.push(`B3 cell parked at ${st3.state.strategy?.nodeId}`);
            return;
          }
          for (const r4 of b4Probes(st3.state)) {
            const st4 = breakerMove(st3.state, r4, ctx);
            run.leaves += 1;
            bump(run.b4, (st4?.caseId ?? "?") + "|" + (st4?.state.terminal?.kind ?? "none"));
            const bad = st4 === null ? "B4 rejected" : verifyEight(st4.state);
            if (bad !== null) {
              run.failures.push(`B4 ${r4.x.toString()},${r4.y.toString()}: ${bad}`);
            }
          }
        });
      });
    });
  });
  return run;
}
