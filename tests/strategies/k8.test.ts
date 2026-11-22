// tests/strategies/k8.test.ts — esmb-k8 guided tour (Das–Valla Lemma 9):
// registration, branch-interaction data, the Figure 3–5 path through the real
// engine with exact structure checks, every encoded response class, the
// unverified classes ending as typed uncovered terminals, negatives, replay.
import { describe, expect, it } from "vitest";
import { isKHole } from "../../src/geometry/holes.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import type { GameState } from "../../src/game/types.ts";
import { Store } from "../../src/session/store.ts";
import { startSession } from "../../src/session/commit.ts";
import { commit } from "../../src/session/commit.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import { assembleReplayFile } from "../../src/engine/replay.ts";
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
import { esmbK8 } from "../../src/strategy/strategies/k8/def.ts";
import { lintSources } from "../../src/explain/claimlint.ts";
import { caseData } from "../../src/engine/describe.ts";
import { placePoint } from "../../src/game/place.ts";
import { classifyB0Hept } from "../../src/strategy/strategies/k8/classify.ts";
import { testCtx } from "../helpers.ts";
import {
  HEPTAGON,
  P,
  breakerMove,
  centroid,
  ensureK8,
  initK8,
  ptOf,
  vars,
} from "./k8driver.ts";
import { cellReps, verifyEight } from "./k8tree.ts";
import type { StrategyDef } from "../../src/strategy/types.ts";

ensureK8();
const ctx = testCtx();
const [A, , C, , E, F] = HEPTAGON as [Pt, Pt, Pt, Pt, Pt, Pt, Pt];
const B0 = centroid([A, C, E, F]);

// The scripted Figure 3–5 path up to the parked B3 state.
let TOUR: { states: GameState[]; points: Pt[] } | null = null;
function tourToB3(): { states: GameState[]; points: Pt[] } {
  if (TOUR !== null) {
    return TOUR;
  }
  const states: GameState[] = [initK8(ctx)];
  const points: Pt[] = [];
  const play = (at: Pt): GameState => {
    const st = breakerMove(states[states.length - 1] as GameState, at, ctx);
    if (st === null) {
      throw new Error("tour: rejected");
    }
    states.push(st.state);
    points.push(at);
    return st.state;
  };
  const s1 = play(B0);
  const tri = (vars(s1)["TRI"] as string[]).map((id) => ptOf(s1, id));
  const s2 = play(centroid(tri));
  const X = (vars(s2)["X"] as string[]).map((id) => ptOf(s2, id));
  play(centroid([X[0] as Pt, X[2] as Pt, X[4] as Pt]));
  TOUR = { states, points };
  return TOUR;
}

describe("esmb-k8 registration and branch data", () => {
  it("is registered core k=8 with derived status validated-randomized", () => {
    const rs = strategies().get("esmb-k8");
    expect(rs?.def.k).toBe(8);
    expect(effectiveStatus(rs as NonNullable<typeof rs>)).toBe("validated-randomized");
    expect(esmbK8.domain?.coverage).toBe("partial");
  });

  it("every classify route declares its interaction; classes are exactly the documented ones", () => {
    const table: Record<string, string> = {};
    for (const n of Object.values(esmbK8.nodes)) {
      for (const r of n.routes ?? []) {
        expect(r.interaction).toBeDefined();
        table[r.case] = r.interaction as string;
      }
    }
    expect(table).toEqual({
      "k8:b0:outside-heptagon": "interactive",
      "k8:b0:inside-pair": "guided",
      "k8:b0:inside-no-pair": "unverified",
      "k8:b1:inside-shared-triangle": "guided",
      "k8:b1:elsewhere": "unverified",
      "k8:b2:inside-seven": "guided",
      "k8:b2:outside-seven": "interactive",
      "k8:b3:seven-hole": "interactive",
      "k8:b3:vertex-pair": "guided",
      "k8:b3:no-pair": "unverified",
      "k8:b4:inside-seven-A": "interactive",
      "k8:b4:inside-seven-B": "interactive",
      "k8:b4:elsewhere": "interactive",
    });
  });

  it("serializes as data (interaction survives the codec) and every claim is tiered and ClaimLint-clean", () => {
    const json = serializeStrategyDef(esmbK8);
    const back = hydrateStrategyDef(JSON.parse(JSON.stringify(json)));
    expect(serializeStrategyDef(back)).toEqual(json);
    const sources: Array<{ text: string; tier: string; ref?: string }> = [];
    for (const n of Object.values(esmbK8.nodes)) {
      expect(n.sourceRef.length).toBeGreaterThan(0);
      for (const c of [...n.why.claims, ...(n.why.threats ?? []), ...(n.why.invariantNotes ?? [])]) {
        sources.push({ text: c.text, tier: c.tier, ...(c.ref !== undefined ? { ref: c.ref } : {}) });
      }
      sources.push({ text: n.why.headline, tier: "strategy-rule" });
    }
    expect(lintSources(sources as never)).toEqual([]);
  });

  it("registry rejects an interactive route to a terminal (G3) but accepts it for an unverified one", () => {
    const boot = esmbK8.nodes["k8:boot"];
    if (boot === undefined || boot.routes === undefined) {
      throw new Error("test bug");
    }
    const routes = boot.routes;
    const mk = (interaction: "interactive" | "unverified", id: string): StrategyDef => ({
      ...esmbK8,
      id,
      nodes: {
        ...esmbK8.nodes,
        "k8:boot": {
          ...boot,
          routes: [
            ...routes.slice(0, -1),
            { case: "x", when: { kind: "all" }, target: "k8:win", interaction },
          ],
        },
      },
    });
    expect(() => registerStrategy(mk("interactive", "test:k8-g3"), "core")).toThrow(RegistrationError);
    expect(() => registerStrategy(mk("unverified", "test:k8-ok"), "core")).not.toThrow();
  });
});

describe("the Figure 3–5 path (exact structure at every step)", () => {
  const { states, points } = tourToB3();
  const s1 = states[1] as GameState;
  const s2 = states[2] as GameState;
  const s3 = states[3] as GameState;

  it("B0 → two 5-holes sharing only a segment → A1 → two 6-holes meeting exactly in the triangle B0·E·A1", () => {
    const v = vars(s1);
    const all = s1.points.map((p) => p.pt);
    for (const k of ["pentA", "pentB"]) {
      expect((v[k] as string[]).length).toBe(5);
    }
    for (const k of ["twinA", "twinB"]) {
      expect(isKHole((v[k] as string[]).map((id) => ptOf(s1, id)), all)).toBe(true);
    }
    expect((v["TRI"] as string[]).slice().sort()).toEqual(
      [v["A1"], v["B0"], (v["SE"] as string[])[0]].sort() as string[],
    );
  });

  it("B1 in the shared triangle → A2 creates a 7-hole X and the Observation 1 structure; points count so far", () => {
    const v = vars(s2);
    const X = (v["X"] as string[]).map((id) => ptOf(s2, id));
    expect(X.length).toBe(7);
    expect(isKHole(X, s2.points.map((p) => p.pt))).toBe(true);
    expect(s2.points.length).toBe(7 + 4); // heptagon + B0 A1 B1 A2
  });

  it("B2 inside X → A3 (forcing pair); the state parks at the B3 classifier", () => {
    expect(s3.strategy?.nodeId).toBe("k8:r3:classify");
    expect(s3.points.length).toBe(7 + 6); // + B2 A3
    expect(points.length).toBe(3);
  });

  it("the B3 case map is honestly unavailable (no bounded boundary set), never a guess", () => {
    const cd = caseData(s3, ctx);
    expect(cd?.cells.available).toBe(false);
  });

});

describe("other encoded classes and honest refusals", () => {
  it("B0 outside the heptagon → immediate extension to an 8-hole", () => {
    const st = breakerMove(initK8(ctx), P(60, 60), ctx);
    expect(st?.caseId).toBe("k8:b0:outside-heptagon");
    expect(verifyEight((st as { state: GameState }).state)).toBeNull();
  });

  it("every B0 cell inside the heptagon has a surviving chord-half pair (the no-pair class is empty here; the route stays as a fail-closed guard)", () => {
    const s0 = initK8(ctx);
    const hole = (vars(s0)["P7"] as string[]).slice();
    const tally: Record<string, number> = {};
    for (const r of cellReps(s0.points.map((p) => p.pt), ctx)) {
      const hypo = placePoint(s0, "breaker", r);
      const out = classifyB0Hept.classify(hypo, { hole }, ctx.config);
      const tag = out.kind === "classified" ? out.result.tag : "integrity";
      tally[tag] = (tally[tag] ?? 0) + 1;
    }
    expect(tally["no-pair"] ?? 0).toBe(0);
    expect(tally["pair"]).toBeGreaterThan(20);
    expect(tally["outside"]).toBeGreaterThan(20);
    expect(tally["integrity"]).toBeUndefined();
  });

  it("B1 outside the shared triangle ends as uncovered; B2 outside X wins at once", () => {
    const s1 = tourToB3().states[1] as GameState;
    const far = breakerMove(s1, P(900, 900), ctx);
    expect(far?.caseId).toBe("k8:b1:elsewhere");
    expect(far?.state.terminal?.kind).toBe("uncovered");
    const s2 = tourToB3().states[2] as GameState;
    const out = breakerMove(s2, P(-800, 700), ctx);
    expect(out?.caseId).toBe("k8:b2:outside-seven");
    expect(verifyEight((out as { state: GameState }).state)).toBeNull();
  });

  it("rejects an even-count start (parity) for the k=8 tour", () => {
    const r = reduceTransaction(initK8(ctx), { kind: "place", owner: "maker", at: P(1, 1) }, ctx);
    expect(r.status).toBe("rejected");
  });
});

describe("replay determinism", () => {
  it("the tour up to B2 exports, parses, validates and re-folds", () => {
    const store = new Store();
    startSession(
      { kind: "guided", config: { mode: "break", window: ctx.config.window }, strategyId: "esmb-k8", mode: "break" },
      ctx,
      store,
    );
    const place = (at: Pt): void => {
      const r = reduceTransaction(store.current(), { kind: "place", owner: "breaker", at }, ctx);
      if (r.status !== "accepted") {
        throw new Error("test bug");
      }
      commit(r, { kind: "place", owner: "breaker", at }, store, ctx);
    };
    place(B0);
    const v1 = vars(store.current());
    place(centroid((v1["TRI"] as string[]).map((id) => ptOf(store.current(), id))));
    const assembled = assembleReplayFile(
      store.tree(),
      store.cursorTxnId(),
      {
        k: 8,
        mode: "break",
        window: ctx.config.window,
        strategyId: "esmb-k8",
        strategyStart: null,
        meta: { createdAt: "2026-11-21T00:00:00.000Z", app: "t", appVersion: "0.0.0" },
        engineVersion: "0.0.0",
      },
      ctx,
    );
    const withStart = {
      ...assembled,
      strategyStart: {
        kind: "continue" as const,
        points: store.stateAtTxn(0).points.map((p) => p.pt),
        owners: store.stateAtTxn(0).points.map((p) => p.owner),
        selectedHole: [...HEPTAGON],
      },
    };
    const text = serializeReplay(withStart);
    const parsed = parseReplayFile(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(validateReplay(parsed.file, ctx).ok).toBe(true);
      expect(serializeReplay(parsed.file)).toBe(text);
    }
  });
});
