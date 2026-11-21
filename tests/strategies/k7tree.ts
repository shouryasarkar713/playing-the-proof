// tests/strategies/k7tree.ts — the full response tree harness (Week-7 gate):
// every B0 arrangement cell, then every post-A1 B1 arrangement cell, each
// leaf verified by the independent oracle.
import { hull } from "../../src/geometry/hull.ts";
import { orient } from "../../src/geometry/predicates.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import type { GameState } from "../../src/game/types.ts";
import { initSession } from "../../src/engine/init.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import type { RuntimeCtx } from "../../src/engine/orchestrator.ts";
import { cellRepresentatives, suppliedHex, windowOf } from "./k7driver.ts";
import { oracleHasHole } from "./k7oracle.ts";

export interface TreeStats {
  b0Cells: number;
  b0Inside: number;
  b0Outside: number;
  leaves: number;
  skippedIllegal: number;
  failures: string[];
  b0Cases: Record<string, number>;
  b1Cases: Record<string, number>;
}

export function insideConvexStrict(poly: readonly Pt[], q: Pt): boolean {
  for (let i = 0; i < poly.length; i += 1) {
    if (orient(poly[i] as Pt, poly[(i + 1) % poly.length] as Pt, q) <= 0) {
      return false;
    }
  }
  return true;
}

export function initK7(
  hex: readonly Pt[],
  extras: readonly Pt[],
  ctx: RuntimeCtx,
): GameState {
  const r = initSession(
    {
      kind: "guided",
      config: { mode: "break", window: ctx.config.window },
      strategyId: "esmb-k7",
      mode: "break",
      strategyStart: suppliedHex(hex, extras),
    },
    ctx,
  );
  if (r.status !== "accepted" || r.state === undefined) {
    throw new Error(`initK7 rejected: ${JSON.stringify(r.error)}`);
  }
  return r.state;
}

export function breakerMove(
  state: GameState,
  at: Pt,
  ctx: RuntimeCtx,
): GameState | null {
  const r = reduceTransaction(state, { kind: "place", owner: "breaker", at }, ctx);
  return r.status === "accepted" && r.nextState !== undefined
    ? r.nextState
    : null;
}

// Terminal maker-won with a 7-vertex witness AND the independent oracle agrees.
export function verifyWin(state: GameState): string | null {
  const t = state.terminal;
  if (t === null || t.kind !== "maker-won") {
    return `terminal=${t?.kind ?? "none"} node=${state.strategy?.nodeId ?? "?"}`;
  }
  if (!t.witness.some((h) => h.k === 7 && h.verts.length === 7)) {
    return "witness lacks a 7-hole";
  }
  if (
    !oracleHasHole(
      state.points.map((p) => p.pt),
      7,
    )
  ) {
    return "oracle found no 7-hole";
  }
  return null;
}

// For one starting configuration: EVERY cell representative of the B0
// arrangement (inside the hexagon: all; outside: at most `outsideCap`), then
// for EVERY cell representative of the post-A1 arrangement a B1 move, each
// leaf required to end in a verified 7-hole. Strides thin the enumeration
// (fast tier); undefined strides = all cells.
export function fullTree(
  hex: readonly Pt[],
  extras: readonly Pt[],
  ctx: RuntimeCtx,
  opts: {
    outsideCap?: number;
    b0Stride?: number;
    b1Stride?: number;
    // "engine": full pipeline per leaf (A2 + win + oracle 7-hole).
    // "oracle6": only the independent claim that a 6-hole exists after B1
    // (the Edge-Extension lemma then gives A2); cheap enough for every cell.
    leaf?: "engine" | "oracle6";
  } = {},
): TreeStats {
  const stats: TreeStats = {
    b0Cells: 0,
    b0Inside: 0,
    b0Outside: 0,
    leaves: 0,
    skippedIllegal: 0,
    failures: [],
    b0Cases: {},
    b1Cases: {},
  };
  const s0 = initK7(hex, extras, ctx);
  const win = windowOf(ctx);
  const b0Reps = cellRepresentatives(
    s0.points.map((p) => p.pt),
    win,
  );
  stats.b0Cells = b0Reps.length;
  const hexH = hull([...hex]);
  let outside = 0;
  let idx = 0;
  for (const { rep } of b0Reps) {
    const inside = insideConvexStrict(hexH, rep);
    if (!inside) {
      if (outside >= (opts.outsideCap ?? 6)) {
        continue;
      }
      outside += 1;
      stats.b0Outside += 1;
    } else {
      stats.b0Inside += 1;
    }
    idx += 1;
    if (opts.b0Stride !== undefined && idx % opts.b0Stride !== 0) {
      continue;
    }
    const s1 = breakerMove(s0, rep, ctx);
    if (s1 === null) {
      stats.skippedIllegal += 1;
      continue;
    }
    const c0 = s1.strategy?.lastCase ?? "?";
    stats.b0Cases[c0] = (stats.b0Cases[c0] ?? 0) + 1;
    const tag = `B0 ${rep.x.toString()},${rep.y.toString()}`;
    if (s1.terminal !== null) {
      const bad = verifyWin(s1);
      if (bad !== null) {
        stats.failures.push(`${tag}: ${bad}`);
      }
      continue;
    }
    if (s1.strategy?.nodeId !== "k7:r1:classify") {
      stats.failures.push(`${tag}: parked at ${s1.strategy?.nodeId ?? "?"}`);
      continue;
    }
    const b1Reps = cellRepresentatives(
      s1.points.map((p) => p.pt),
      win,
    );
    let j = 0;
    for (const { rep: r1 } of b1Reps) {
      j += 1;
      if (opts.b1Stride !== undefined && j % opts.b1Stride !== 0) {
        continue;
      }
      if (opts.leaf === "oracle6") {
        stats.leaves += 1;
        const pts = [...s1.points.map((p) => p.pt), r1];
        if (!oracleHasHole(pts, 6)) {
          stats.failures.push(
            `${tag} B1 ${r1.x.toString()},${r1.y.toString()}: oracle found no 6-hole`,
          );
        }
        continue;
      }
      const s2 = breakerMove(s1, r1, ctx);
      if (s2 === null) {
        stats.skippedIllegal += 1;
        continue;
      }
      stats.leaves += 1;
      const c1 = s2.strategy?.lastCase ?? "?";
      stats.b1Cases[c1] = (stats.b1Cases[c1] ?? 0) + 1;
      const bad = verifyWin(s2);
      if (bad !== null && stats.failures.length < 5) {
        stats.failures.push(
          `${tag} B1 ${r1.x.toString()},${r1.y.toString()} (${c1}): ${bad}`,
        );
      }
    }
  }
  return stats;
}
