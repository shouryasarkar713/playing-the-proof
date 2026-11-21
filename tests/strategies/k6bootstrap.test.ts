// tests/strategies/k6bootstrap.test.ts — §24.0b bootstrap ladder + P0–P4,
// holeToPointList, fixture records, replay determinism (§24.7 item 2).
import { describe, expect, it } from "vitest";
import type { Pt } from "../../src/geometry/pt.ts";
import { findKHoles } from "../../src/geometry/holes.ts";
import {
  BOOTSTRAP_EXACT_HOLE_BUDGET_5,
  BOOTSTRAP_EXACT_HOLE_BUDGET_6,
} from "../../src/geometry/holes.ts";
import { stateHash } from "../../src/game/hash.ts";
import type { GameState, Player, StrategyStart } from "../../src/game/types.ts";
import { holeToPointList, registerFixtureStart } from "../../src/engine/init.ts";
import { hasFixtureStart } from "../../src/engine/init.ts";
import type { BootstrapError } from "../../src/engine/init.ts";
import { startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import type { RuntimeCtx } from "../../src/engine/orchestrator.ts";
import { P } from "./k6driver.ts";
import { ensureK6 } from "./k6driver.ts";
import { testCtx } from "../helpers.ts";

ensureK6();

const PENT = [P(0, 0), P(10, 0), P(13, 8), P(5, 13), P(-3, 8)];
// Machine-verified fixtures (see Phase-13 scratch runs):
const QUAD7 = [P(0, 0), P(10, 0), P(10, 10), P(0, 10), P(4, 3), P(6, 3), P(5, 6)]; // 0 fives
const PAR6 = [...PENT, P(100, 101)]; // pent hole, no 6-hole, even count
const TWELVE = [...PENT, P(100, 101), P(101, 100), P(100, 99), P(99, 100), P(-50, -50), P(-51, -49), P(60, 62)]; // 12 pts
const MULTI7 = [...PENT, P(100, 101), P(101, 100)]; // 2 fives, 0 sixes
const FALLBACK7 = [...PENT, P(5, 5), P(7, 6)]; // 1 five, 0 sixes
const HEX7 = [P(0, 0), P(4, 0), P(6, 3), P(4, 6), P(0, 6), P(-2, 3), P(30, 30)]; // 6 fives, 1 six

const ALT7: Player[] = ["maker", "breaker", "maker", "breaker", "maker", "breaker", "maker"];

function start(
  record: StrategyStart,
  strategyId = "esmb-k6",
): { store: Store; ctx: RuntimeCtx; status: string; state?: GameState; error?: BootstrapError } {
  const store = new Store();
  const ctx = testCtx();
  const r = startSession(
    {
      kind: "guided",
      config: { mode: "break", window: ctx.config.window },
      strategyId,
      mode: "break",
      strategyStart: record,
    },
    ctx,
    store,
  );
  if (r.status === "accepted") {
    if (r.state === undefined) {
      throw new Error("accepted without state");
    }
    return { store, ctx, status: r.status, state: r.state };
  }
  if (r.error === undefined) {
    throw new Error("rejection without error");
  }
  return { store, ctx, status: r.status, error: r.error };
}

function reb(r: { status: string; error?: BootstrapError }): BootstrapError {
  if (r.status !== "rejected" || r.error === undefined) {
    throw new Error("expected rejection with error");
  }
  return r.error;
}

function firstHoleIds(pts: Pt[], k: number): string[] {
  const found = findKHoles(
    pts.map((p, i) => ({ id: `s${i + 1}`, pt: p })),
    k,
    { mode: "exhaustive", budget: 20000000 },
  );
  if (found.kind !== "exhaustive" || found.holes.length === 0) {
    throw new Error("test bug: no hole");
  }
  return [...(found.holes[0] as (typeof found.holes)[number]).verts];
}

describe("k6 bootstrap shape errors (P0)", () => {
  it("13-point record rejected with the N_BOOTSTRAP_EXACT operand", () => {
    const pts = Array.from({ length: 13 }, (_, i) => P(i, i * i));
    const r = start({ kind: "supplied", points: pts, selectedHole: pts.slice(0, 5) });
    expect(r.status).toBe("rejected");
    const err = reb(r);
    expect(err.code).toBe("malformed-input");
    if (err.code === "malformed-input") {
      expect(err.detail).toContain("N_BOOTSTRAP_EXACT = 12");
    }
  });

  it("<5 points and owners-mismatch rejected", () => {
    const short = start({ kind: "supplied", points: PENT.slice(0, 4), selectedHole: PENT.slice(0, 4) });
    expect(short.status).toBe("rejected");
    const mismatch = start({ kind: "supplied", points: PENT, selectedHole: PENT, owners: ["maker"] });
    expect(mismatch.status).toBe("rejected");
  });
});

describe("k6 bootstrap P1 (GP + window)", () => {
  it("collinear triple rejected with the triple", () => {
    const pts = [P(0, 0), P(1, 1), P(2, 2), P(5, 0), P(0, 5)];
    const r = start({ kind: "supplied", points: pts, selectedHole: pts });
    expect(r.status).toBe("rejected");
    const err = reb(r);
    expect(err.code).toBe("not-gp-or-window");
    if (err.code === "not-gp-or-window") {
      expect(err.triple?.length).toBe(3);
    }
  });

  it("out-of-window point rejected", () => {
    const pts = [...PENT, P(2000000, 0), P(2000001, 1)];
    const r = start({ kind: "supplied", points: pts, selectedHole: PENT });
    expect(r.status).toBe("rejected");
    expect(reb(r).code).toBe("not-gp-or-window");
  });
});

describe("k6 bootstrap P2 (selected hole)", () => {
  it("blocked pentagon rejected invalid-hole with operands; short list likewise", () => {
    // FALLBACK7's pentagon is blocked by the two interior points.
    const blocked = start({ kind: "supplied", points: FALLBACK7, selectedHole: FALLBACK7.slice(0, 5) });
    expect(blocked.status).toBe("rejected");
    const berr = reb(blocked);
    expect(berr.code).toBe("invalid-hole");
    if (berr.code === "invalid-hole") {
      expect(berr.operands).toContain("blocker");
    }
    const short = start({ kind: "supplied", points: [...PENT, P(100, 101)], selectedHole: PENT.slice(0, 4) });
    expect(short.status).toBe("rejected");
  });

  it("continue with corrupt selectedHole falls back deterministically and starts", () => {
    const rec: StrategyStart = {
      kind: "continue",
      points: FALLBACK7,
      owners: ALT7,
      selectedHole: FALLBACK7.slice(0, 5), // blocked pentagon — corrupt
    };
    const r = start(rec);
    expect(r.status).toBe("accepted");
    const want = firstHoleIds(FALLBACK7, 5);
    // Canonical-first fallback: P5 names the one true hole (ids are
    // verbatim p1..p7 here, but the record order is the source order —
    // FALLBACK7 is already in placement order).
    expect(r.state?.strategy?.vars["P5"]).toEqual(want.map((s) => s.replace("s", "p")));
    expect(r.state?.turn).toBe("breaker");
  });

  it("continue preserves placement order verbatim (no canonical re-sort)", () => {
    const rev = [...FALLBACK7].reverse();
    const owners: Player[] = [...ALT7].reverse();
    const hole = firstHoleIds(rev, 5).map((s) => {
      const i = Number(s.slice(1)) - 1;
      return rev[i] as Pt;
    });
    const r = start({ kind: "continue", points: rev, owners, selectedHole: hole });
    expect(r.status).toBe("accepted");
    const st = r.state as GameState;
    for (let i = 0; i < rev.length; i += 1) {
      expect(st.points[i]?.id).toBe(`p${i + 1}`);
      expect(st.points[i]?.owner).toBe(owners[i]);
      expect(st.points[i]?.move).toBe(i + 1);
      expect(st.points[i]?.pt.x.toString()).toBe((rev[i] as Pt).x.toString());
    }
  });

  it("supplied canonicalizes (cmpPt sort, owners travel with points)", () => {
    const rev = [...PENT].reverse();
    const inOwners = ["maker", "breaker", "maker", "breaker", "maker"];
    const r = start({ kind: "supplied", points: rev, selectedHole: [...PENT] });
    expect(r.status).toBe("accepted");
    const st = r.state as GameState;
    const sorted = [...PENT].sort((a, b) =>
      a.x.cmp(b.x) !== 0 ? a.x.cmp(b.x) : a.y.cmp(b.y),
    );
    for (let i = 0; i < sorted.length; i += 1) {
      expect(st.points[i]?.pt.x.toString()).toBe((sorted[i] as Pt).x.toString());
      expect(st.points[i]?.pt.y.toString()).toBe((sorted[i] as Pt).y.toString());
      // Owners travel with their points through the canonical sort.
      const src = rev.findIndex(
        (q) =>
          q.x.toString() === (sorted[i] as Pt).x.toString() &&
          q.y.toString() === (sorted[i] as Pt).y.toString(),
      );
      expect(st.points[i]?.owner).toBe(inOwners[src]);
    }
  });

  it("multiple 5-holes: canonical-first selection", () => {
    const r = start({ kind: "continue", points: MULTI7, owners: ALT7, selectedHole: null });
    expect(r.status).toBe("accepted");
    const want = firstHoleIds(MULTI7, 5).map((s) => s.replace("s", "p"));
    expect(r.state?.strategy?.vars["P5"]).toEqual(want);
  });
});

describe("k6 bootstrap P3/P4", () => {
  it("even count rejected with parity operands", () => {
    const owners: Player[] = ["maker", "breaker", "maker", "breaker", "maker", "breaker"];
    const r = start({ kind: "supplied", points: PAR6, selectedHole: PENT, owners });
    expect(r.status).toBe("rejected");
    const err = reb(r);
    expect(err.code).toBe("parity");
    if (err.code === "parity") {
      expect(err.count).toBe(6);
      expect(err.turn).toBe("breaker");
    }
  });

  it("pre-existing 6-hole terminates immediately with turn over (P3 before P4)", () => {
    const hole = firstHoleIds(HEX7, 5).map((s) => {
      const i = Number(s.slice(1)) - 1;
      return HEX7[i] as Pt;
    });
    const r = start({ kind: "continue", points: HEX7, owners: ALT7, selectedHole: hole });
    expect(r.status).toBe("accepted");
    expect(r.state?.terminal?.kind).toBe("maker-won");
    expect(r.state?.turn).toBe("over");
    if (r.state?.terminal?.kind === "maker-won") {
      expect(r.state.terminal.witness.length).toBeGreaterThan(0);
    }
  });

  it("12-point record passes P0; P3 sweep genuinely exhaustive (named budgets)", () => {
    const r = start({ kind: "supplied", points: TWELVE, selectedHole: [...PENT] });
    // TWELVE contains 6-holes → accepted-terminal (P3 fired on an
    // exhaustive sweep, never a capped guess).
    expect(r.status).toBe("accepted");
    expect(r.state?.terminal?.kind).toBe("maker-won");
    const idpts = TWELVE.map((p, i) => ({ id: `p${i + 1}`, pt: p }));
    expect(
      findKHoles(idpts, 6, { mode: "exhaustive", budget: BOOTSTRAP_EXACT_HOLE_BUDGET_6 }).kind,
    ).toBe("exhaustive");
    expect(
      findKHoles(idpts, 5, { mode: "exhaustive", budget: BOOTSTRAP_EXACT_HOLE_BUDGET_5 }).kind,
    ).toBe("exhaustive");
  });

  it("hole-less continue record rejected missing-witness", () => {
    const r = start({ kind: "continue", points: QUAD7, owners: ALT7, selectedHole: null });
    expect(r.status).toBe("rejected");
    expect(reb(r).code).toBe("missing-witness");
  });
});

describe("k6 fixture starts", () => {
  it("registered fixture resolves like supplied; unknown ref rejected", () => {
    if (!hasFixtureStart("test:k6-basic")) {
      registerFixtureStart("test:k6-basic", { points: [...PENT], selectedHole: [...PENT] });
    }
    const ok = start({ kind: "fixture", scenarioRef: "test:k6-basic" });
    expect(ok.status).toBe("accepted");
    expect(ok.state?.strategy?.nodeId).toBe("k6:boot");
    const bad = start({ kind: "fixture", scenarioRef: "test:nope" });
    expect(bad.status).toBe("rejected");
  });
});

describe("holeToPointList (§24.0b conversion)", () => {
  // A real k5-shaped terminal state (placement order p1..p7).
  function k5state(): GameState {
    const pts = [P(0, 0), P(10, 0), P(20, 28), P(10, 9), P(0, 1), P(1, 0), P(30, 30)];
    return {
      seq: 0,
      k: 5,
      mode: "break",
      points: pts.map((p, i) => ({
        id: `p${i + 1}`,
        owner: (i % 2 === 0 ? "maker" : "breaker") as Player,
        pt: p,
        move: i + 1,
      })),
      turn: "breaker",
      terminal: null,
      strategy: null,
    };
  }

  it("positive: canonical-first witness converts vertex-by-vertex", () => {
    const st = k5state();
    const found = findKHoles(
      st.points.map((p) => ({ id: p.id, pt: p.pt })),
      5,
      { mode: "exhaustive", budget: 20000000 },
    );
    expect(found.kind).toBe("exhaustive");
    if (found.kind !== "exhaustive" || found.holes.length === 0) {
      throw new Error("test bug: no 5-hole");
    }
    const hole = found.holes[0] as (typeof found.holes)[number];
    const conv = holeToPointList(hole, st.points);
    expect(conv.ok).toBe(true);
    if (conv.ok) {
      expect(conv.pts.length).toBe(5);
      hole.verts.forEach((id, i) => {
        const src = st.points.find((p) => p.id === id)?.pt as Pt;
        expect((conv.pts[i] as Pt).x.toString()).toBe(src.x.toString());
        expect((conv.pts[i] as Pt).y.toString()).toBe(src.y.toString());
      });
    }
  });

  it("malformed-id → missing-point; reversed order → non-canonical; 4 verts → bad-cardinality", () => {
    const st = k5state();
    expect(holeToPointList({ k: 5, verts: ["p1", "p2", "p3", "p4", "px"] }, st.points)).toEqual({
      ok: false,
      reason: "missing-point",
    });
    const found = findKHoles(
      st.points.map((p) => ({ id: p.id, pt: p.pt })),
      5,
      { mode: "exhaustive", budget: 20000000 },
    );
    if (found.kind !== "exhaustive" || found.holes.length === 0) {
      throw new Error("test bug");
    }
    const hole = found.holes[0] as (typeof found.holes)[number];
    expect(
      holeToPointList({ k: 5, verts: [...hole.verts].reverse() }, st.points),
    ).toEqual({ ok: false, reason: "non-canonical" });
    expect(
      holeToPointList({ k: 5, verts: hole.verts.slice(0, 4) }, st.points),
    ).toEqual({ ok: false, reason: "bad-cardinality" });
  });

  it("same record twice → identical initial hash (replay determinism)", () => {
    const rec = { kind: "continue" as const, points: MULTI7, owners: ALT7, selectedHole: null };
    const a = start(rec);
    const b = start(rec);
    expect(a.status).toBe("accepted");
    expect(b.status).toBe("accepted");
    expect(stateHash(a.state as GameState)).toBe(stateHash(b.state as GameState));
  });
});

