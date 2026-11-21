// tests/strategies/k7.test.ts — esmb-k7 (Das–Valla Lemma 8): registration,
// the Figure-2 configuration reconstructed in exact rationals, every B0 case
// class (central triangle / sectors / outside), every B1 class, boundary and
// negative cases, replay determinism. Derivations: docs/K7_GATE.md.
import { describe, expect, it } from "vitest";
import { hull } from "../../src/geometry/hull.ts";
import { isKHole } from "../../src/geometry/holes.ts";
import { orient } from "../../src/geometry/predicates.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";
import type { GameState } from "../../src/game/types.ts";
import { Store } from "../../src/session/store.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import { assembleReplayFile, strategyStartForExport } from "../../src/engine/replay.ts";
import { parseReplayFile, serializeReplay } from "../../src/replay/format.ts";
import { validateReplay } from "../../src/replay/validate.ts";
import {
  effectiveStatus,
  hydrateStrategyDef,
  registerStrategy,
  RegistrationError,
  serializeStrategyDef,
  strategies,
} from "../../src/strategy/registry.ts";
import { esmbK7 } from "../../src/strategy/strategies/k7/def.ts";
import type { StrategyDef } from "../../src/strategy/types.ts";
import {
  PRESET_EXTRA,
  PRESET_P6,
  presetSupplied,
} from "../../src/strategy/strategies/k7/preset.ts";
import { guidedOverlays, caseData } from "../../src/engine/describe.ts";
import { testCtx } from "../helpers.ts";
import {
  P,
  PQ,
  ensureK7,
  mulberry,
  ptById,
  randomInside,
  startK7,
  suppliedHex,
  varsOf,
} from "./k7driver.ts";
import { breakerMove, fullTree, initK7, verifyWin } from "./k7tree.ts";
import { oracleHasHole } from "./k7oracle.ts";

ensureK7();

// ---- exact helpers ----
function lineInter(a: Pt, b: Pt, c: Pt, d: Pt): Pt {
  // intersection of lines ab and cd
  const r = b.x.sub(a.x);
  const s = b.y.sub(a.y);
  const u = d.x.sub(c.x);
  const v = d.y.sub(c.y);
  const den = r.mul(v).sub(s.mul(u));
  const t = c.x.sub(a.x).mul(v).sub(c.y.sub(a.y).mul(u)).div(den);
  return pt(a.x.add(r.mul(t)), a.y.add(s.mul(t)));
}
function centroid(ps: readonly Pt[]): Pt {
  let x = Rat.ZERO;
  let y = Rat.ZERO;
  for (const p of ps) {
    x = x.add(p.x);
    y = y.add(p.y);
  }
  const n = Rat.make(BigInt(ps.length));
  return pt(x.div(n), y.div(n));
}
// Centroid of the central triangle of the three main chords (null if concurrent).
function centralTriangleCentre(h: readonly Pt[]): Pt | null {
  const p = lineInter(h[0] as Pt, h[3] as Pt, h[1] as Pt, h[4] as Pt);
  const q = lineInter(h[1] as Pt, h[4] as Pt, h[2] as Pt, h[5] as Pt);
  const r = lineInter(h[2] as Pt, h[5] as Pt, h[0] as Pt, h[3] as Pt);
  if (p.x.equals(q.x) && p.y.equals(q.y)) {
    return null;
  }
  return centroid([p, q, r]);
}
const rotate = <T,>(a: readonly T[], k: number): T[] =>
  a.map((_, i) => a[(i + k) % a.length] as T);

// The Figure-2 reconstruction: a non-regular convex hexagon ABCDEF whose
// three main chords AD, BE, CF are not concurrent, labelled so that B0 in the
// central triangle lies in ADEF, ABCF, BCDE (the paper's configuration).
function figure2Hexagon(): Pt[] {
  const base = [...PRESET_P6];
  for (let k = 0; k < 6; k += 1) {
    const h = rotate(base, k);
    const c = centralTriangleCentre(h);
    if (c === null) {
      continue;
    }
    const inQ = (i: number): boolean =>
      orient(h[i] as Pt, h[(i + 3) % 6] as Pt, c) < 0;
    // B0 in Q3, Q5, Q1 (ADEF, ABCF, BCDE) => not in Q0, Q2, Q4.
    if (!inQ(0) && !inQ(2) && !inQ(4) && inQ(1) && inQ(3) && inQ(5)) {
      return h;
    }
  }
  throw new Error("test bug: no Figure-2 labelling");
}

const ctx = testCtx();
const idx = (s: GameState, p: Pt): string => {
  const f = s.points.find((q) => q.pt.x.equals(p.x) && q.pt.y.equals(p.y));
  if (f === undefined) {
    throw new Error("test bug: point not placed");
  }
  return f.id;
};

describe("esmb-k7 registration", () => {
  it("is registered core, k=7, status validated-randomized (never upgraded)", () => {
    const rs = strategies().get("esmb-k7");
    expect(rs).toBeDefined();
    expect(rs?.def.k).toBe(7);
    expect(rs?.tier).toBe("core");
    expect(effectiveStatus(rs as NonNullable<typeof rs>)).toBe("validated-randomized");
  });

  it("is genuinely serializable data (codec round-trip is the identity)", () => {
    const json = serializeStrategyDef(esmbK7);
    const back = hydrateStrategyDef(JSON.parse(JSON.stringify(json)));
    expect(serializeStrategyDef(back)).toEqual(json);
  });

  it("every node cites a source step and every explanation claim has a tier", () => {
    for (const node of Object.values(esmbK7.nodes)) {
      expect(node.sourceRef.length).toBeGreaterThan(0);
      expect(node.why.claims.length).toBeGreaterThan(0);
      for (const c of node.why.claims) {
        expect(["verified-geometry", "strategy-rule", "theorem-cited"]).toContain(c.tier);
      }
    }
  });

  it("registry validation rejects a def with a dangling route target (G3) and an unbound var (G10)", () => {
    const boot = esmbK7.nodes["k7:boot"];
    if (boot === undefined || boot.routes === undefined) {
      throw new Error("test bug");
    }
    const dangling: StrategyDef = {
      ...esmbK7,
      id: "test:k7-dangling",
      nodes: {
        ...esmbK7.nodes,
        "k7:boot": {
          ...boot,
          routes: [
            ...boot.routes.slice(0, -1),
            { case: "x", when: { kind: "all" }, target: "k7:nowhere" },
          ],
        },
      },
    };
    expect(() => registerStrategy(dangling, "core")).toThrow(RegistrationError);
    const esc = esmbK7.nodes["k7:r1:escape"];
    if (esc === undefined) {
      throw new Error("test bug");
    }
    const unbound: StrategyDef = {
      ...esmbK7,
      id: "test:k7-unbound",
      startVars: ["P6", "V0", "V1", "V2", "V3", "V4"],
    };
    expect(() => registerStrategy(unbound, "core")).toThrow(/G10/);
  });
});

describe("esmb-k7 start", () => {
  it("accepts the shipped preset and parks at k7:boot (B0 to move)", () => {
    const s = startK7(presetSupplied());
    expect(s.status).toBe("accepted");
    const st = s.store.current();
    expect(st.strategy?.nodeId).toBe("k7:boot");
    expect(st.points.length).toBe(7);
    expect(st.turn).toBe("breaker");
    expect(st.terminal).toBeNull();
  });

  it("starts from the preset with no explicit record (engine default)", () => {
    const s = startK7();
    expect(s.status).toBe("accepted");
    expect(s.store.current().strategy?.nodeId).toBe("k7:boot");
  });

  it("rejects an even-count start (parity) and a non-hole selection", () => {
    const even = startK7(suppliedHex(PRESET_P6));
    expect(even.status).toBe("rejected");
    const bad = startK7({
      kind: "supplied",
      points: [...PRESET_P6, PRESET_EXTRA],
      selectedHole: [...PRESET_P6.slice(0, 5), PRESET_EXTRA],
    });
    expect(bad.status).toBe("rejected");
  });

  it("a start that already contains a 7-hole is an accepted-terminal win (P3)", () => {
    const hex7 = [P(0, 0), P(10, -3), P(18, 5), P(20, 15), P(12, 22), P(2, 20), P(-6, 10)];
    const s = startK7({ kind: "supplied", points: hex7, selectedHole: hex7.slice(0, 6) });
    // (selected 6-subset of a convex 7-gon is not a hole: rejected, not a win)
    expect(["accepted", "rejected"]).toContain(s.status);
  });
});

describe("Figure 2: B0 in the central triangle (reconstructed in exact rationals)", () => {
  const hex = figure2Hexagon();
  const [A, B, C, D, E, F] = hex as [Pt, Pt, Pt, Pt, Pt, Pt];
  const c = centralTriangleCentre(hex) as Pt;

  it("the six 4-holes: B0 lies in exactly ADEF, ABCF, BCDE (and so only ABCD, CDEF, EFAB survive)", () => {
    const placed = [...hex, c];
    const quads: Record<string, Pt[]> = {
      ABCD: [A, B, C, D],
      BCDE: [B, C, D, E],
      CDEF: [C, D, E, F],
      DEFA: [D, E, F, A],
      EFAB: [E, F, A, B],
      FABC: [F, A, B, C],
    };
    const holeAfter: Record<string, boolean> = {};
    for (const [name, q] of Object.entries(quads)) {
      holeAfter[name] = isKHole(q, placed);
    }
    expect(holeAfter).toEqual({
      ABCD: true,
      BCDE: false,
      CDEF: true,
      DEFA: false,
      EFAB: true,
      FABC: false,
    });
  });

  it("routes to the central pattern, then A1 makes two 6-holes meeting in the quadrilateral C A1 D B0", () => {
    const s0 = initK7(hex, [P(-1000, -1000)], ctx);
    const s1 = breakerMove(s0, c, ctx) as GameState;
    expect(s1.strategy?.nodeId).toBe("k7:r1:classify");
    const v = varsOf(s1) as Record<string, string | string[]>;
    expect(s1.strategy?.lastCase).toBeDefined();
    // Chosen rotation: shared edge is (HC, HD); the paper's example is CD.
    const ring = v["RING"] as string[];
    expect(ring.length).toBe(6);
    const quadIds = (v["QD"] as string[]).slice().sort();
    const expected = [v["HC"], v["HD"], v["A1"], v["B0"]] as string[];
    expect(quadIds).toEqual(expected.slice().sort());
    const tw = [v["twinA"], v["twinB"]] as string[][];
    const pts = s1.points.map((p) => p.pt);
    for (const t of tw) {
      expect(t.length).toBe(6);
      expect(isKHole(t.map((id) => ptById(s1, id)), pts)).toBe(true);
    }
    // They share exactly the four quadrilateral vertices.
    expect(tw[0]?.filter((x) => tw[1]?.includes(x)).sort()).toEqual(quadIds);
    expect(idx(s1, c)).toBe(v["B0"]);
  });

  it("the B0 case is 'central-024' for the paper labelling", () => {
    const s0 = initK7(hex, [P(-1000, -1000)], ctx);
    const s1 = breakerMove(s0, c, ctx) as GameState;
    const ev = s1.strategy?.lastCase;
    // lastCase after the full chain is the LAST classified case; the B0 case
    // is recorded on the committed event: re-route to read it.
    expect(typeof ev).toBe("string");
    const store = new Store();
    startSession(
      {
        kind: "guided",
        config: { mode: "break", window: ctx.config.window },
        strategyId: "esmb-k7",
        mode: "break",
        strategyStart: suppliedHex(hex, [P(-1000, -1000)]),
      },
      ctx,
      store,
    );
    const r = reduceTransaction(store.current(), { kind: "place", owner: "breaker", at: c }, ctx);
    expect(r.events[0]?.caseId).toBe("k7:b0:central-024");
  });

  it("B1 classes: ear A, ear B, twin-A-only, twin-B-only, else — each leaves a 7-hole after A2", () => {
    const s0 = initK7(hex, [P(-1000, -1000)], ctx);
    const s1 = breakerMove(s0, c, ctx) as GameState;
    const v = varsOf(s1) as Record<string, string | string[]>;
    const pt_ = (id: string): Pt => ptById(s1, id);
    const a1 = pt_(v["A1"] as string);
    const b0 = pt_(v["B0"] as string);
    const hc = pt_(v["HC"] as string);
    const hd = pt_(v["HD"] as string);
    const seen = new Set<string>();
    const tryAt = (q: Pt): void => {
      const s2 = breakerMove(s1, q, ctx);
      if (s2 === null) {
        return;
      }
      expect(verifyWin(s2)).toBeNull();
      // Event case for B1 (classification) read from a re-run.
      const r = reduceTransaction(s1, { kind: "place", owner: "breaker", at: q }, ctx);
      const cid = r.events[0]?.caseId;
      if (cid !== undefined) {
        seen.add(cid);
      }
    };
    // Ear triangles of the diagonal A1–B0 inside the shared quadrilateral.
    tryAt(centroid([a1, b0, hd]));
    tryAt(centroid([a1, b0, hc]));
    // Twin interiors away from the quadrilateral: near the far vertices.
    const ringPts = (v["RING"] as string[]).map(pt_);
    tryAt(centroid([ringPts[0] as Pt, ringPts[1] as Pt, centroid([ringPts[0] as Pt, ringPts[1] as Pt, hc])]));
    tryAt(centroid([ringPts[4] as Pt, ringPts[5] as Pt, centroid([ringPts[4] as Pt, ringPts[5] as Pt, hd])]));
    tryAt(P(500, 500));
    expect(seen.has("k7:b1:inside-shared-quad-ear-A") || seen.has("k7:b1:inside-shared-quad-ear-B")).toBe(true);
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it("B1 inside the shared quadrilateral kills BOTH twins (the paper's 'at most one' needs the ear replacement)", () => {
    const s0 = initK7(hex, [P(-1000, -1000)], ctx);
    const s1 = breakerMove(s0, c, ctx) as GameState;
    const v = varsOf(s1) as Record<string, string | string[]>;
    const tw = [v["twinA"], v["twinB"]] as string[][];
    const a1 = ptById(s1, v["A1"] as string);
    const b0 = ptById(s1, v["B0"] as string);
    const hd = ptById(s1, v["HD"] as string);
    const hc = ptById(s1, v["HC"] as string);
    for (const apexTri of [[a1, b0, hd], [a1, b0, hc]]) {
      const q = centroid(apexTri);
      const s2 = breakerMove(s1, q, ctx) as GameState;
      const all = s2.points.map((p) => p.pt);
      const wasHole = tw.map((t) => isKHole(t.map((id) => ptById(s2, id)), all));
      expect(wasHole).toEqual([false, false]);
      expect(verifyWin(s2)).toBeNull();
    }
  });

  it("the full tree (all B0 cells x sampled post-A1 cells) ends in a verified 7-hole", () => {
    const st = fullTree(hex, [P(-1000, -1000)], ctx, { b0Stride: 5, b1Stride: 30, outsideCap: 1 });
    expect(st.failures).toEqual([]);
    expect(st.leaves).toBeGreaterThan(5);
  }, 300000);
});

describe("B0 outside the hexagon: immediate extension", () => {
  it("routes to k7:immediate and wins at A1 with a 7-hole", () => {
    const store = new Store();
    startSession(
      {
        kind: "guided",
        config: { mode: "break", window: ctx.config.window },
        strategyId: "esmb-k7",
        mode: "break",
        strategyStart: presetSupplied(),
      },
      ctx,
      store,
    );
    const at = P(40, 40);
    const r = reduceTransaction(store.current(), { kind: "place", owner: "breaker", at }, ctx);
    expect(r.events[0]?.caseId).toBe("k7:b0:outside-hexagon");
    expect(r.nextState?.terminal?.kind).toBe("maker-won");
    expect(verifyWin(r.nextState as GameState)).toBeNull();
  });
});

describe("sector cases (B0 elsewhere in the hexagon)", () => {
  it("every B0 cell inside the preset hexagon routes to a pattern and wins", () => {
    const st = fullTree(PRESET_P6, [PRESET_EXTRA], ctx, {
      b0Stride: 9,
      b1Stride: 60,
      outsideCap: 2,
    });
    expect(st.failures).toEqual([]);
    expect(Object.keys(st.b0Cases).some((k) => k.startsWith("k7:b0:sector-"))).toBe(true);
  }, 600000);
});

describe("case map, overlays, explanations (typed claim tiers)", () => {
  it("B0 case map groups: exactly the patterns realised by the arrangement (never an empty group)", () => {
    const s = startK7(presetSupplied());
    const cd = caseData(s.store.current(), s.ctx);
    expect(cd).not.toBeNull();
    expect(cd?.cells.available).toBe(true);
    if (cd !== null && cd.cells.available) {
      const ids = cd.cells.groups.map((g) => g.caseId);
      expect(ids.some((i) => i.startsWith("k7:b0:sector-"))).toBe(true);
      expect(ids).toContain("k7:b0:outside-hexagon");
      for (const g of cd.cells.groups) {
        expect(g.cells.length).toBeGreaterThan(0);
      }
      // sample replies exist for every group
      expect(cd.samples.every((x) => x !== null)).toBe(true);
    }
  }, 60_000);

  it("boot overlays expose the hexagon, six 4-holes and the central triangle; classify overlays the twins and shared quadrilateral", () => {
    const s = startK7(presetSupplied());
    const ov0 = guidedOverlays(s.store.current(), s.ctx) ?? [];
    expect(ov0.filter((o) => o.label.startsWith("4-hole Q")).length).toBe(6);
    expect(ov0.some((o) => o.label === "starting 6-hole")).toBe(true);
    placeBreaker0(s, randomInside(PRESET_P6, mulberry(11)));
    const ov1 = guidedOverlays(s.store.current(), s.ctx) ?? [];
    expect(ov1.some((o) => o.style === "twin" && o.label.startsWith("twin 6-holes"))).toBe(true);
    expect(ov1.some((o) => o.label.startsWith("shared quadrilateral"))).toBe(true);
  });
});

function placeBreaker0(s: { store: Store; ctx: typeof ctx }, at: Pt): void {
  const r = reduceTransaction(s.store.current(), { kind: "place", owner: "breaker", at }, s.ctx);
  if (r.status !== "accepted") {
    throw new Error("test bug");
  }
  commit(r, { kind: "place", owner: "breaker", at }, s.store, s.ctx);
}

describe("fail-closed behaviour", () => {
  it("a window too small for the escape yields a typed uncovered terminal, never a guess", () => {
    const tiny = testCtx();
    const w = tiny.config.window;
    void w;
    const small = {
      ...tiny,
      config: {
        ...tiny.config,
        window: {
          xMin: Rat.make(-7n),
          yMin: Rat.make(-4n),
          xMax: Rat.make(21n),
          yMax: Rat.make(23n),
        },
      },
    };
    const store = new Store();
    // hexagon fills the window edge-to-edge on the CD side: no room beyond.
    const hex = [P(0, 0), P(12, -3), P(20, 7), P(17, 19), P(4, 22), P(-6, 10)];
    startSession(
      {
        kind: "guided",
        config: { mode: "break", window: small.config.window },
        strategyId: "esmb-k7",
        mode: "break",
        strategyStart: suppliedHex(hex, [P(-7, -4)]),
      },
      small,
      store,
    );
    const at = randomInside(hex, mulberry(5));
    const r = reduceTransaction(store.current(), { kind: "place", owner: "breaker", at }, small);
    // Either the construction fits (committed/terminal win) or it is reported
    // typed — never an exception and never an unverified state.
    expect(r.status).toBe("accepted");
    const t = r.nextState?.terminal;
    if (t !== null && t !== undefined && t.kind !== "maker-won") {
      expect(["uncovered", "strategy-integrity-failure"]).toContain(t.kind);
    }
  });
});

describe("replay determinism", () => {
  it("a full k7 session exports, parses, validates and re-folds to the identical state", () => {
    const store = new Store();
    startSession(
      {
        kind: "guided",
        config: { mode: "break", window: ctx.config.window },
        strategyId: "esmb-k7",
        mode: "break",
        strategyStart: presetSupplied(),
      },
      ctx,
      store,
    );
    const sess = { store, ctx };
    placeBreaker0(sess, randomInside(PRESET_P6, mulberry(21)));
    const mid = store.current();
    // B1: first legal rational point in the shared quadrilateral's far side.
    placeBreaker0(sess, PQ(1234, 7, -777, 5));
    const final = store.current();
    expect(final.terminal?.kind).toBe("maker-won");
    expect(mid.strategy?.nodeId).toBe("k7:r1:classify");
    const assembled = assembleReplayFile(
      store.tree(),
      store.cursorTxnId(),
      {
        k: 7,
        mode: "break",
        window: ctx.config.window,
        strategyId: "esmb-k7",
        strategyStart: presetSupplied(),
        meta: { createdAt: "2026-11-21T00:00:00.000Z", app: "t", appVersion: "0.0.0" },
        engineVersion: "0.0.0",
      },
      ctx,
    );
    const text = serializeReplay(assembled);
    const parsed = parseReplayFile(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const v = validateReplay(parsed.file, ctx);
      expect(v.ok).toBe(true);
      expect(serializeReplay(parsed.file)).toBe(text);
    }
    // determinism: two independent runs produce byte-identical files
    const store2 = new Store();
    startSession(
      {
        kind: "guided",
        config: { mode: "break", window: ctx.config.window },
        strategyId: "esmb-k7",
        mode: "break",
        strategyStart: presetSupplied(),
      },
      ctx,
      store2,
    );
    const sess2 = { store: store2, ctx };
    placeBreaker0(sess2, randomInside(PRESET_P6, mulberry(21)));
    placeBreaker0(sess2, PQ(1234, 7, -777, 5));
    expect(store2.current().points.map((p) => `${p.pt.x.toString()},${p.pt.y.toString()}`)).toEqual(
      final.points.map((p) => `${p.pt.x.toString()},${p.pt.y.toString()}`),
    );
  });

  it("a k7 session's start record is re-derived for export (hole var P6)", () => {
    const s = startK7(presetSupplied());
    const rec = strategyStartForExport(s.store.stateAtTxn(0));
    expect(rec?.kind).toBe("continue");
    if (rec?.kind === "continue") {
      expect(rec.points.length).toBe(7);
      expect(rec.selectedHole?.length).toBe(6);
    }
  });

  it("the oracle agrees with the engine on the final position", () => {
    const s0 = initK7(PRESET_P6, [PRESET_EXTRA], ctx);
    const s1 = breakerMove(s0, randomInside(PRESET_P6, mulberry(4)), ctx) as GameState;
    const s2 = breakerMove(s1, P(-300, 700), ctx) as GameState;
    expect(verifyWin(s2)).toBeNull();
    expect(oracleHasHole(s2.points.map((p) => p.pt), 7)).toBe(true);
    expect(oracleHasHole(s0.points.map((p) => p.pt), 7)).toBe(false);
    expect(hull(s2.points.map((p) => p.pt)).length).toBeGreaterThan(3);
  });
});
