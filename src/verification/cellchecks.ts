// verification/cellchecks.ts — the §23.8 k=5 B3-cell check and the §24.7
// item 7 k=6 checks (B1-space, split B0-space, 7c escape representatives).
// Pure: exact rational arithmetic only; no DOM, no I/O, no engine/session
// imports (§18.1). Every check-owned findKHoles call carries its explicit
// per-domain estimateHoleWork(n,k) budget (§24.7 item 7's ONE budget rule);
// a budget-exhausted result on a check path is IMPLEMENTATION_ERROR
// (fail-closed), never "no holes", never a pass.
//
// F is always the FULL fixed point set of the checked configuration
// (v1.2.2): the five B3-time points for k=5; the full bootstrap set for
// B0-space; bootstrap ∪ {B0, A1} for B1-space. The callers pass the actual
// pre-check points — this module never subsets to a 5-hole.
import { Rat } from "../geometry/rat.ts";
import { pt } from "../geometry/pt.ts";
import type { Pt } from "../geometry/pt.ts";
import { arrangementCells } from "../geometry/arrangement.ts";
import type { ArrLine } from "../geometry/arrangement.ts";
import {
  canonicalInteriorPoint,
  polygonArea2,
  regionContains,
} from "../geometry/poly.ts";
import type { ConvexPoly } from "../geometry/poly.ts";
import {
  estimateHoleWork,
  findKHoles,
} from "../geometry/holes.ts";
import type { IdPt } from "../geometry/holes.ts";
import { extendHole } from "../geometry/extend.ts";
import { classify } from "../strategy/runtime.ts";
import type { ValidationCheck } from "../strategy/registry.ts";
import type { StrategyDef } from "../strategy/types.ts";
import type {
  Configuration,
  GameState,
  NodeId,
  PointId,
} from "../game/types.ts";
import { directCase, hypoPlace } from "./partition.ts";

export interface CellCheckReport {
  checkId: string;
  scope: string;
  result: ValidationCheck["result"];
  cells: number;
  checked: number;
  detail?: string;
  witness?: { fixture: string };
}

export function cellCheckToValidation(r: CellCheckReport): ValidationCheck {
  return {
    id: r.checkId,
    scope: r.scope,
    result: r.result,
    ...(r.witness !== undefined ? { witness: r.witness } : {}),
  };
}

export function pairLinesOf(pts: readonly Pt[]): ArrLine[] {
  const out: ArrLine[] = [];
  for (let i = 0; i < pts.length; i += 1) {
    for (let j = i + 1; j < pts.length; j += 1) {
      out.push({ a: pts[i] as Pt, b: pts[j] as Pt });
    }
  }
  return out;
}

export function windowPoly(window: Configuration["window"]): ConvexPoly {
  return [
    pt(window.xMin, window.yMin),
    pt(window.xMax, window.yMin),
    pt(window.xMax, window.yMax),
    pt(window.xMin, window.yMax),
  ];
}

function idPtsOf(pts: readonly Pt[]): IdPt[] {
  return pts.map((p, i) => ({ id: `p${i + 1}`, pt: p }));
}

function fixtureRep(cell: ConvexPoly, rep: Pt, extra: string): string {
  return JSON.stringify({
    cell: cell.map((p) => ({ x: p.x.toString(), y: p.y.toString() })),
    rep: { x: rep.x.toString(), y: rep.y.toString() },
    info: extra,
  });
}

function extendWindow(window: Configuration["window"]): {
  minX: Rat;
  minY: Rat;
  maxX: Rat;
  maxY: Rat;
} {
  return {
    minX: window.xMin,
    minY: window.yMin,
    maxX: window.xMax,
    maxY: window.yMax,
  };
}

// ---- k=5 B3-space (§23.8) ----

// F = the five points at B3-time (the check asserts |F| = 5 — anything
// else is a caller defect, IMPLEMENTATION_ERROR). Per cell, the
// representative as B3 must complete a 4-hole in F ∪ {B3}
// (findKHoles(6 pts, k=4, estimateHoleWork(6,4)), non-empty exhaustive).
export function k5B3Check(
  f: readonly Pt[],
  window: Configuration["window"],
  scope: string,
): CellCheckReport {
  const checkId = "exact:b3-cell";
  if (f.length !== 5) {
    return {
      checkId,
      scope,
      result: "IMPLEMENTATION_ERROR",
      cells: 0,
      checked: 0,
      detail: `B3-time fixed set must hold exactly 5 points, got ${f.length}`,
    };
  }
  const cells = arrangementCells(pairLinesOf(f), windowPoly(window));
  if (cells.length > 56) {
    return {
      checkId,
      scope,
      result: "IMPLEMENTATION_ERROR",
      cells: cells.length,
      checked: 0,
      detail: `10 lines admit at most 56 cells, got ${cells.length} — arrangement defect`,
    };
  }
  let checked = 0;
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i] as ConvexPoly;
    const rep = canonicalInteriorPoint(cell);
    if (rep === null) {
      return {
        checkId,
        scope,
        result: "IMPLEMENTATION_ERROR",
        cells: cells.length,
        checked,
        detail: `cell[${i}] admits no interior representative — arrangement defect`,
      };
    }
    const found = findKHoles(idPtsOf([...f, rep]), 4, {
      mode: "exhaustive",
      budget: estimateHoleWork(6, 4),
    });
    if (found.kind === "budget-exhausted") {
      return {
        checkId,
        scope,
        result: "IMPLEMENTATION_ERROR",
        cells: cells.length,
        checked,
        detail: `cell[${i}]: 6-point k=4 sweep budget-exhausted under estimateHoleWork(6,4) — accounting defect`,
        witness: { fixture: fixtureRep(cell, rep, "budget-exhausted") },
      };
    }
    if (found.kind !== "exhaustive" || found.holes.length === 0) {
      return {
        checkId,
        scope,
        result: "COUNTEREXAMPLE",
        cells: cells.length,
        checked,
        detail: `cell[${i}]: no 4-hole in F ∪ {B3} — Lemma 6 residual fails here`,
        witness: { fixture: fixtureRep(cell, rep, "no-4-hole") },
      };
    }
    checked += 1;
  }
  return { checkId, scope, result: "PASS", cells: cells.length, checked };
}

// ---- k=6 B0-space, split (§24.7 item 7b) ----

// (b1) routing totality + existence, exhaustive over cells of the FULL
// bootstrap arrangement — with ROUTE-DEPENDENT existence assertions (the
// plan's "constructive content of the immediate routes' first half",
// read exactly): a B0 strictly inside the forced region destroys the
// bootstrap 5-hole and sits inside every chord quad, so NO 5-hole exists
// in F ∪ {B0} there — asserting one uniformly would be mathematically
// false. Immediate-route cells (inside-h5 / outside-h5) assert 5-hole
// existence in F ∪ {B0}; inside-forced cells assert the construction
// route's first half instead — an anchored shared-edge 4-hole pair out
// of B0 (the k6:pairing precondition; its absence is the
// ConstructionIntegrityError). (b2) extension admissibility,
// representative-confirmed on the immediate-route cells: the exact
// extendHole construction (the k6:immediate move's prefer) at each
// representative must produce a 6-hole-yielding placement. A
// window-exhausted construction at a representative is a COUNTEREXAMPLE
// fixture (in the test window every small-config extension must land); a
// post-violation is IMPLEMENTATION_ERROR (the construction contradicts
// its own guarantee).
export function k6B0Check(
  def: StrategyDef,
  bootNode: NodeId,
  bootState: GameState,
  window: Configuration["window"],
  config: Configuration,
  scope: string,
): CellCheckReport {
  const checkId = "exact:b0-cell";
  const f = bootState.points.map((p) => p.pt);
  const cells = arrangementCells(pairLinesOf(f), windowPoly(window));
  let checked = 0;
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i] as ConvexPoly;
    const rep = canonicalInteriorPoint(cell);
    if (rep === null) {
      return {
        checkId,
        scope,
        result: "IMPLEMENTATION_ERROR",
        cells: cells.length,
        checked,
        detail: `cell[${i}] admits no interior representative — arrangement defect`,
      };
    }
    // (b1) route agreement on the hypo B0 (direct vs classify()).
    const { hypo, pointId } = hypoPlace(bootState, rep);
    const direct = directCase(def, bootNode, hypo, pointId, config);
    if (!direct.ok) {
      return {
        checkId,
        scope,
        result: "BUDGET_EXCEEDED",
        cells: cells.length,
        checked,
        detail: `cell[${i}]: undecidable routing at the representative — ${direct.detail}`,
        witness: { fixture: fixtureRep(cell, rep, direct.detail) },
      };
    }
    const live = classify(def, hypo, bootNode, pointId, config);
    if (!live.ok || live.case !== direct.caseId) {
      return {
        checkId,
        scope,
        result: "COUNTEREXAMPLE",
        cells: cells.length,
        checked,
        detail: `cell[${i}]: routing disagreement (direct=${direct.caseId})`,
        witness: { fixture: fixtureRep(cell, rep, "routing-disagreement") },
      };
    }
    // (b1) existence, routed: the construction route asserts the
    // anchored 4-hole pair; the immediate routes assert a 5-hole.
    const all = idPtsOf([...f, rep]);
    const b0Id = `p${f.length + 1}`;
    if (direct.caseId === "k6:b0:inside-forced") {
      const found = findKHoles(all, 4, {
        mode: "exhaustive",
        budget: estimateHoleWork(f.length + 1, 4),
      });
      if (found.kind === "budget-exhausted") {
        return {
          checkId,
          scope,
          result: "IMPLEMENTATION_ERROR",
          cells: cells.length,
          checked,
          detail: `cell[${i}]: 4-sweep budget-exhausted under estimateHoleWork(${f.length + 1},4) — accounting defect`,
          witness: { fixture: fixtureRep(cell, rep, "budget-exhausted") },
        };
      }
      if (found.kind !== "exhaustive") {
        return {
          checkId,
          scope,
          result: "IMPLEMENTATION_ERROR",
          cells: cells.length,
          checked,
          detail: `cell[${i}]: 4-sweep not exhaustive — implementation error`,
          witness: { fixture: fixtureRep(cell, rep, "not-exhaustive") },
        };
      }
      const anchored = found.holes.filter((h) => h.verts.includes(b0Id));
      let pairs = 0;
      for (let a = 0; a < anchored.length; a += 1) {
        for (let b = a + 1; b < anchored.length; b += 1) {
          const va = new Set((anchored[a] as { verts: readonly string[] }).verts);
          const vb = new Set((anchored[b] as { verts: readonly string[] }).verts);
          let shared = 0;
          for (const v of va) {
            if (vb.has(v)) {
              shared += 1;
            }
          }
          if (shared === 2) {
            pairs += 1;
          }
        }
      }
      if (pairs === 0) {
        return {
          checkId,
          scope,
          result: "COUNTEREXAMPLE",
          cells: cells.length,
          checked,
          detail: `cell[${i}]: inside-forced cell with no anchored shared-edge 4-hole pair out of B0`,
          witness: { fixture: fixtureRep(cell, rep, "no-anchored-pair") },
        };
      }
      checked += 1;
      continue;
    }
    const found = findKHoles(all, 5, {
      mode: "exhaustive",
      budget: estimateHoleWork(f.length + 1, 5),
    });
    if (found.kind === "budget-exhausted") {
      return {
        checkId,
        scope,
        result: "IMPLEMENTATION_ERROR",
        cells: cells.length,
        checked,
        detail: `cell[${i}]: 5-sweep budget-exhausted under estimateHoleWork(${f.length + 1},5) — accounting defect`,
        witness: { fixture: fixtureRep(cell, rep, "budget-exhausted") },
      };
    }
    if (found.kind !== "exhaustive" || found.holes.length === 0) {
      return {
        checkId,
        scope,
        result: "COUNTEREXAMPLE",
        cells: cells.length,
        checked,
        detail: `cell[${i}]: no 5-hole in F ∪ {B0}`,
        witness: { fixture: fixtureRep(cell, rep, "no-5-hole") },
      };
    }
    // (b2) the exact extension construction at the representative.
    const ext = extendHole(
      found.holes,
      all,
      extendWindow(window),
      "largest-interval",
    );
    if (!ext.ok) {
      if (ext.reason === "post-violation") {
        return {
          checkId,
          scope,
          result: "IMPLEMENTATION_ERROR",
          cells: cells.length,
          checked,
          detail: `cell[${i}]: extendHole post-violation — ${ext.detail ?? "isKHole failed"}`,
          witness: { fixture: fixtureRep(cell, rep, "post-violation") },
        };
      }
      return {
        checkId,
        scope,
        result: "COUNTEREXAMPLE",
        cells: cells.length,
        checked,
        detail: `cell[${i}]: extension construction window-exhausted at the representative`,
        witness: { fixture: fixtureRep(cell, rep, "window-exhausted") },
      };
    }
    checked += 1;
  }
  return { checkId, scope, result: "PASS", cells: cells.length, checked };
}

// ---- k=6 B1-space (§24.7 item 7a) ----

// F = the full point set after A1 (bootstrap ∪ {B0, A1}). Per cell, the
// representative as B1 must keep a 5-hole alive in F ∪ {B1}
// (findKHoles(|F|+1 pts, k=5, estimateHoleWork(|F|+1,5)), non-empty
// exhaustive — justified exhaustive by the Cell-Constancy Lemma).
export function k6B1Check(
  afterA1: readonly Pt[],
  window: Configuration["window"],
  scope: string,
): CellCheckReport {
  const checkId = "exact:b1-cell";
  const cells = arrangementCells(pairLinesOf(afterA1), windowPoly(window));
  let checked = 0;
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i] as ConvexPoly;
    const rep = canonicalInteriorPoint(cell);
    if (rep === null) {
      return {
        checkId,
        scope,
        result: "IMPLEMENTATION_ERROR",
        cells: cells.length,
        checked,
        detail: `cell[${i}] admits no interior representative — arrangement defect`,
      };
    }
    const found = findKHoles(idPtsOf([...afterA1, rep]), 5, {
      mode: "exhaustive",
      budget: estimateHoleWork(afterA1.length + 1, 5),
    });
    if (found.kind === "budget-exhausted") {
      return {
        checkId,
        scope,
        result: "IMPLEMENTATION_ERROR",
        cells: cells.length,
        checked,
        detail: `cell[${i}]: 5-sweep budget-exhausted under estimateHoleWork(${afterA1.length + 1},5) — accounting defect`,
        witness: { fixture: fixtureRep(cell, rep, "budget-exhausted") },
      };
    }
    if (found.kind !== "exhaustive" || found.holes.length === 0) {
      return {
        checkId,
        scope,
        result: "COUNTEREXAMPLE",
        cells: cells.length,
        checked,
        detail: `cell[${i}]: no 5-hole in F ∪ {B1}`,
        witness: { fixture: fixtureRep(cell, rep, "no-5-hole") },
      };
    }
    checked += 1;
  }
  return { checkId, scope, result: "PASS", cells: cells.length, checked };
}

// ---- 7c escape representatives (§24.7 item 7c) ----

export interface ForcedReps {
  cells: number;
  inside: number;
  reps: Pt[];
}

// Arrangement-cell representatives strictly inside the forced polygon
// (orientation-normalized internally). Cells are never cut: forced edges
// lie on bootstrap pair-lines, so every cell sits strictly on one side.
export function forcedCellReps(
  boot: readonly Pt[],
  forced: ConvexPoly,
  window: Configuration["window"],
): ForcedReps {
  const area = polygonArea2([...forced]);
  const ccw = area.sign() >= 0 ? [...forced] : [...forced].reverse();
  const region = { kind: "poly" as const, verts: ccw };
  const cells = arrangementCells(pairLinesOf(boot), windowPoly(window));
  const reps: Pt[] = [];
  for (const cell of cells) {
    const rep = canonicalInteriorPoint(cell);
    if (rep === null) {
      continue;
    }
    if (regionContains(region, rep, true)) {
      reps.push(rep);
    }
  }
  return { cells: cells.length, inside: reps.length, reps };
}

export type TwinResult =
  | { ok: true; pairs: number }
  | {
      ok: false;
      reason: "budget-exhausted" | "no-twins";
      detail: string;
    };

// The twin post-condition over an after-A1 point set: the 5-hole
// enumeration (estimateHoleWork(|all|,5)) must hold at least two
// witnesses sharing exactly 3 vertices including A1.
export function checkTwinWitnesses(
  all: readonly IdPt[],
  a1: PointId,
): TwinResult {
  const found = findKHoles([...all], 5, {
    mode: "exhaustive",
    budget: estimateHoleWork(all.length, 5),
  });
  if (found.kind === "budget-exhausted") {
    return {
      ok: false,
      reason: "budget-exhausted",
      detail: `twin enumeration budget-exhausted under estimateHoleWork(${all.length},5)`,
    };
  }
  if (found.kind !== "exhaustive") {
    return {
      ok: false,
      reason: "budget-exhausted",
      detail: "twin enumeration not exhaustive — implementation error",
    };
  }
  let pairs = 0;
  for (let i = 0; i < found.holes.length; i += 1) {
    const a = new Set((found.holes[i] as { verts: readonly string[] }).verts);
    if (!a.has(a1)) {
      continue;
    }
    for (let j = i + 1; j < found.holes.length; j += 1) {
      const b = new Set((found.holes[j] as { verts: readonly string[] }).verts);
      if (!b.has(a1)) {
        continue;
      }
      let shared = 0;
      for (const v of a) {
        if (b.has(v)) {
          shared += 1;
        }
      }
      if (shared === 3) {
        pairs += 1;
      }
    }
  }
  if (pairs === 0) {
    return {
      ok: false,
      reason: "no-twins",
      detail: "no two 5-holes share exactly 3 vertices including A1 — the escape claim failed",
    };
  }
  return { ok: true, pairs };
}
