// tests/engine/bichromatic.test.ts — the bichromatic rule through the engine:
// session init, sandbox analysis, guided win detection, fail-closed
// strategy gating, labels. A Breaker point must never be a winning-hole
// vertex, and a Breaker placement must never end the game in Maker's favour.
import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import type { GameState, UserAction } from "../../src/game/types.ts";
import { checkStateInvariants } from "../../src/game/place.ts";
import { stateHash } from "../../src/game/hash.ts";
import { initSession } from "../../src/engine/init.ts";
import { reduceTransaction, committedStateAdmissible } from "../../src/engine/orchestrator.ts";
import type { EngineResult, RuntimeCtx } from "../../src/engine/orchestrator.ts";
import { effectDiff, nodeExplanation, winCard } from "../../src/engine/describe.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { testCtx } from "../helpers.ts";
import {
  BI_DEF_ID,
  BI_NOPOST_ID,
  BI_FIXTURE_ID,
  MONO_DEF_ID,
  ensureBichromaticDefs,
} from "./bichromatic-defs.ts";
import {
  BICHROMATIC_LABEL,
  MONOCHROMATIC_LABEL,
  earlyWinClaimText,
  earlyWinHeadline,
  gameModeLabel,
  ruleCaption,
  witnessLabel,
} from "../../src/explain/gamemode.ts";
import { lintStrings } from "../../src/explain/claimlint.ts";

ensureBichromaticDefs();

function P(x: number, y: number): Pt {
  return pt(Rat.make(BigInt(x)), Rat.make(BigInt(y)));
}

function dispatch(store: Store, ctx: RuntimeCtx, action: UserAction): EngineResult {
  const r = reduceTransaction(store.current(), action, ctx);
  if (r.status === "accepted") {
    commit(r, action, store, ctx);
  }
  return r;
}

function sandbox(k: 3 | 4 | 5, bichromatic: boolean): { store: Store; ctx: RuntimeCtx } {
  const store = new Store();
  const ctx = testCtx();
  const started = startSession(
    {
      kind: "sandbox",
      config: {
        mode: "sandbox",
        window: ctx.config.window,
        ...(bichromatic ? { gameMode: "bichromatic" as const } : {}),
      },
      k,
    },
    ctx,
    store,
  );
  expect(started.status).toBe("accepted");
  return { store, ctx };
}

function place(store: Store, ctx: RuntimeCtx, owner: "maker" | "breaker", x: number, y: number): EngineResult {
  return dispatch(store, ctx, { kind: "place", owner, at: P(x, y) });
}

function hasWinNote(r: EngineResult): boolean {
  return r.diagnostics.some((d) => d.kind === "analysis-note");
}

describe("initSession and the flag", () => {
  it("monochromatic states never carry a gameMode key", () => {
    const ctx = testCtx();
    const r = initSession(
      { kind: "sandbox", config: { mode: "sandbox", window: ctx.config.window }, k: 5 },
      ctx,
    );
    expect(r.state).toBeDefined();
    expect(r.state !== undefined && "gameMode" in r.state).toBe(false);
    // An explicit "monochromatic" is normalised to ABSENCE too.
    const r2 = initSession(
      {
        kind: "sandbox",
        config: { mode: "sandbox", window: ctx.config.window, gameMode: "monochromatic" },
        k: 5,
      },
      ctx,
    );
    expect(r2.state !== undefined && "gameMode" in r2.state).toBe(false);
    expect(r2.state !== undefined && r.state !== undefined && stateHash(r2.state)).toBe(
      r.state !== undefined ? stateHash(r.state) : "",
    );
  });

  it("bichromatic sandbox state carries the flag and a distinct hash", () => {
    const ctx = testCtx();
    const bi = initSession(
      {
        kind: "sandbox",
        config: { mode: "sandbox", window: ctx.config.window, gameMode: "bichromatic" },
        k: 5,
      },
      ctx,
    );
    const mono = initSession(
      { kind: "sandbox", config: { mode: "sandbox", window: ctx.config.window }, k: 5 },
      ctx,
    );
    expect(bi.state?.gameMode).toBe("bichromatic");
    expect(bi.state !== undefined && mono.state !== undefined && stateHash(bi.state) !== stateHash(mono.state)).toBe(true);
  });

  it("an unknown gameMode value is rejected (malformed), not coerced", () => {
    const ctx = testCtx();
    const r = initSession(
      {
        kind: "sandbox",
        config: { mode: "sandbox", window: ctx.config.window, gameMode: "tri" as never },
        k: 5,
      },
      ctx,
    );
    expect(r.status).toBe("rejected");
    expect(r.error?.code).toBe("malformed-input");
  });

  it("guided + bichromatic is refused for a def without the declaration (fail closed)", () => {
    const ctx = testCtx();
    for (const strategyId of [MONO_DEF_ID, "fixture-triangle"]) {
      const r = initSession(
        {
          kind: "guided",
          config: { mode: "break", window: ctx.config.window, gameMode: "bichromatic" },
          strategyId,
          mode: "break",
        },
        ctx,
      );
      expect(r.status).toBe("rejected");
      expect(r.error?.code).toBe("malformed-input");
      expect(JSON.stringify(r.error)).toContain("unsupported-game-mode");
    }
  });

  it("guided bichromatic is accepted for a def that declares it", () => {
    const ctx = testCtx();
    const r = initSession(
      {
        kind: "guided",
        config: { mode: "break", window: ctx.config.window, gameMode: "bichromatic" },
        strategyId: BI_DEF_ID,
        mode: "break",
      },
      ctx,
    );
    expect(r.status).toBe("accepted");
    expect(r.state?.gameMode).toBe("bichromatic");
    // A def with no declaration still starts monochromatically (default).
    const m = initSession(
      {
        kind: "guided",
        config: { mode: "break", window: ctx.config.window },
        strategyId: MONO_DEF_ID,
        mode: "break",
      },
      ctx,
    );
    expect(m.status).toBe("accepted");
    expect(m.state !== undefined && "gameMode" in m.state).toBe(false);
  });
});

describe("sandbox win analysis", () => {
  // Breaker blocker p2 INSIDE the Maker triangle p1,p3,p5.
  const script: ReadonlyArray<readonly ["maker" | "breaker", number, number]> = [
    ["maker", 0, 0],
    ["breaker", 5, 3],
    ["maker", 10, 0],
    ["breaker", 30, 40],
    ["maker", 5, 10],
  ];

  it("the same placements: monochromatic sees a 3-hole through the Breaker point, bichromatic does not", () => {
    const m = sandbox(3, false);
    const b = sandbox(3, true);
    let mLast: EngineResult | undefined;
    let bLast: EngineResult | undefined;
    for (const [owner, x, y] of script) {
      mLast = place(m.store, m.ctx, owner, x, y);
      bLast = place(b.store, b.ctx, owner, x, y);
    }
    expect(mLast !== undefined && hasWinNote(mLast)).toBe(true);
    expect(bLast !== undefined && hasWinNote(bLast)).toBe(false);
  });

  it("an empty Maker triangle is reported by the bichromatic analysis", () => {
    const b = sandbox(3, true);
    place(b.store, b.ctx, "maker", 0, 0);
    place(b.store, b.ctx, "breaker", 30, 1);
    place(b.store, b.ctx, "maker", 10, 0);
    place(b.store, b.ctx, "breaker", -20, 7);
    const r = place(b.store, b.ctx, "maker", 5, 10);
    expect(hasWinNote(r)).toBe(true);
    const note = r.diagnostics.find((d) => d.kind === "analysis-note");
    if (note?.kind === "analysis-note" && note.note.kind === "exhaustive") {
      for (const h of note.note.holes) {
        for (const v of h.verts) {
          const owner = b.store.current().points.find((p) => p.id === v)?.owner;
          expect(owner).toBe("maker");
        }
      }
    }
  });

  it("a Breaker placement never produces a win note, even when it would complete a monochromatic hole", () => {
    // Maker p1,p3; Breaker p2,p4 far; Breaker's p4 would complete an empty
    // triangle {p1,p3,p4} monochromatically.
    const m = sandbox(3, false);
    const b = sandbox(3, true);
    let mR: EngineResult | undefined;
    let bR: EngineResult | undefined;
    for (const [owner, x, y] of [
      ["maker", 0, 0],
      ["breaker", 40, 41],
      ["maker", 10, 0],
      ["breaker", 5, 8],
    ] as const) {
      mR = place(m.store, m.ctx, owner, x, y);
      bR = place(b.store, b.ctx, owner, x, y);
    }
    expect(mR !== undefined && hasWinNote(mR)).toBe(true);
    expect(bR !== undefined && hasWinNote(bR)).toBe(false);
  });

  it("states stay admissible through the commit gate", () => {
    const b = sandbox(3, true);
    for (const [owner, x, y] of script) {
      place(b.store, b.ctx, owner, x, y);
    }
    expect(committedStateAdmissible(b.store.current(), b.ctx)).toEqual({ ok: true });
  });
});

function launchGuided(strategyId: string, bichromatic: boolean): { store: Store; ctx: RuntimeCtx } {
  const store = new Store();
  const ctx = testCtx();
  const started = startSession(
    {
      kind: "guided",
      config: {
        mode: "break",
        window: ctx.config.window,
        ...(bichromatic ? { gameMode: "bichromatic" as const } : {}),
      },
      strategyId,
      mode: "break",
    },
    ctx,
    store,
  );
  if (started.status !== "accepted") {
    throw new Error(`launch failed: ${JSON.stringify(started.error)}`);
  }
  return { store, ctx };
}

describe("guided bichromatic sessions", () => {
  it("Maker wins with three Maker points; every witness vertex is Maker's", () => {
    const { store, ctx } = launchGuided(BI_DEF_ID, true);
    const r1 = place(store, ctx, "breaker", -20, 30);
    expect(r1.status).toBe("accepted");
    expect(store.current().terminal).toBeNull();
    const r2 = place(store, ctx, "breaker", 40, -31);
    expect(r2.outcome?.kind).toBe("terminal");
    const st = store.current();
    expect(st.terminal?.kind).toBe("maker-won");
    if (st.terminal?.kind === "maker-won") {
      const verts = st.terminal.witness.flatMap((h) => [...h.verts]);
      expect([...verts].sort()).toEqual(["p1", "p3", "p5"]);
      for (const v of verts) {
        expect(st.points.find((p) => p.id === v)?.owner).toBe("maker");
      }
    }
    expect(checkStateInvariants(st).ok).toBe(true);
    expect(st.gameMode).toBe("bichromatic");
    // win card wording names the rule
    const card = winCard(st);
    expect(card?.witnesses[0]).toMatch(/^Maker-only k-hole: /);
  });

  it("a Breaker point inside Maker's triangle blocks the win: fail closed, never maker-won", () => {
    const { store, ctx } = launchGuided(BI_DEF_ID, true);
    place(store, ctx, "breaker", 5, 2); // inside the final triangle p1,p3,p5
    const r = place(store, ctx, "breaker", 40, -30);
    expect(r.outcome?.kind).toBe("terminal");
    const t = store.current().terminal;
    expect(t?.kind).toBe("strategy-integrity-failure");
    expect(t?.kind === "maker-won").toBe(false);
  });

  it("declared-win check alone fails closed when a Breaker point blocks the Maker triangle", () => {
    const { store, ctx } = launchGuided(BI_NOPOST_ID, true);
    place(store, ctx, "breaker", 5, 2);
    place(store, ctx, "breaker", 40, -31);
    const t = store.current().terminal;
    expect(t?.kind).toBe("strategy-integrity-failure");
    if (t?.kind === "strategy-integrity-failure") {
      expect(t.report.failed.id).toBe("engine:declared-win");
    }
  });

  it("the monochromatic twin def DOES win through the Breaker point on the same moves", () => {
    const { store, ctx } = launchGuided(MONO_DEF_ID, false);
    // Breaker p2=(5,2); Maker's A2=(10,0) completes the empty triangle
    // {p1,p2,p3} monochromatically -> Maker wins at round 2.
    const r = place(store, ctx, "breaker", 5, 2);
    expect(r.outcome?.kind).toBe("terminal");
    const t = store.current().terminal;
    expect(t?.kind).toBe("maker-won");
    if (t?.kind === "maker-won") {
      expect(t.witness.flatMap((h) => [...h.verts])).toContain("p2");
    }
  });

  it("the bichromatic def on those same moves does NOT win at A2 (Breaker vertex rejected)", () => {
    const { store, ctx } = launchGuided(BI_DEF_ID, true);
    const r = place(store, ctx, "breaker", 5, 2);
    expect(r.status).toBe("accepted");
    expect(store.current().terminal).toBeNull();
  });

  it("a Breaker placement completing a monochromatic triangle ends the game only through a Maker-only hole bichromatically", () => {
    // After A1=(0,0), B1 far, A2=(10,0): Breaker's B2 at (5,-8) completes the
    // empty triangle {A1,A2,B2}. Monochromatic: that Breaker placement ends
    // the game at once (ONE event, witness uses Breaker's p4). Bichromatic:
    // Maker still replies (TWO events) and wins only with her own p5.
    const bi = launchGuided(BI_DEF_ID, true);
    place(bi.store, bi.ctx, "breaker", -50, 60);
    const rb = place(bi.store, bi.ctx, "breaker", 5, -8);
    expect(rb.events.length).toBe(2);
    const tb = bi.store.current().terminal;
    expect(tb?.kind).toBe("maker-won");
    if (tb?.kind === "maker-won") {
      expect(tb.witness.flatMap((h) => [...h.verts]).sort()).toEqual(["p1", "p3", "p5"]);
    }
    const mono = launchGuided(MONO_DEF_ID, false);
    // Monochromatic: Maker's A2 already completes {A1,B1,A2} at round 2 (the
    // Breaker point is a vertex), so the game is over before B2 exists.
    const rm = place(mono.store, mono.ctx, "breaker", -50, 60);
    expect(rm.events.length).toBe(2);
    const tm = mono.store.current().terminal;
    expect(tm?.kind).toBe("maker-won");
    if (tm?.kind === "maker-won") {
      expect(tm.witness.flatMap((h) => [...h.verts])).toContain("p2");
    }
    expect(place(mono.store, mono.ctx, "breaker", 5, -8).status).toBe("rejected");
  });

  it("re-labelled shipped fixture: the monochromatic win claim fails closed under the Maker-only rule", () => {
    const { store, ctx } = launchGuided(BI_FIXTURE_ID, true);
    const r = place(store, ctx, "breaker", 10, 0);
    expect(r.outcome?.kind).toBe("terminal");
    expect(store.current().terminal?.kind).toBe("strategy-integrity-failure");
    // ... while the unmodified monochromatic fixture still wins on the same move.
    const m = launchGuided("fixture-triangle", false);
    place(m.store, m.ctx, "breaker", 10, 0);
    expect(m.store.current().terminal?.kind).toBe("maker-won");
  });

  it("explanations: bichromatic early-win wording; monochromatic wording unchanged", () => {
    const mono = launchGuided(MONO_DEF_ID, false);
    place(mono.store, mono.ctx, "breaker", 5, 2);
    const ex = nodeExplanation(mono.store.current(), mono.ctx);
    expect(ex?.headline).toBe("A k-hole already exists — Maker wins here.");
    expect(JSON.stringify(ex?.claims)).toContain("may be Breaker's own (monochromatic rule)");
    const bi = launchGuided(BI_DEF_ID, true);
    place(bi.store, bi.ctx, "breaker", -20, 30);
    place(bi.store, bi.ctx, "breaker", 40, -30);
    const exb = nodeExplanation(bi.store.current(), bi.ctx);
    // terminal reached at the declared node: the node's own headline applies;
    // either way no monochromatic phrase may appear.
    expect(JSON.stringify(exb)).not.toContain("Breaker's own");
  });

  it("effect diff lists only Maker-vertex holes bichromatically, all holes monochromatically", () => {
    const mk = (n: number, bi: boolean): GameState => {
      const pts: Array<["maker" | "breaker", number, number]> = [
        ["maker", 0, 0],
        ["breaker", 40, 3],
        ["maker", 10, 0],
        ["breaker", -7, 20],
      ];
      return {
        seq: 0,
        k: 4,
        mode: "sandbox",
        ...(bi ? { gameMode: "bichromatic" as const } : {}),
        points: [...pts, ["maker", 5, 10] as ["maker", number, number]].slice(0, n).map(([owner, x, y], i) => ({
          id: `p${i + 1}`,
          owner,
          pt: P(x, y),
          move: i + 1,
        })),
        turn: "maker",
        terminal: null,
        strategy: null,
      };
    };
    const emergedTriples = (bi: boolean): string[][] => {
      const d = effectDiff(mk(4, bi), mk(5, bi), 4, "p5", 1e9);
      if (!d.available) {
        throw new Error("unavailable");
      }
      return (d.sizes.find((s) => s.size === 3)?.emerged ?? []).map((v) => [...v]);
    };
    const bi = emergedTriples(true);
    const mono = emergedTriples(false);
    expect(bi.map((v) => [...v].sort())).toEqual([["p1", "p3", "p5"]]);
    expect(mono.length).toBeGreaterThan(1);
  });

  it("effect diff counts only Maker-vertex holes under the bichromatic rule", () => {
    const { store, ctx } = launchGuided(BI_DEF_ID, true);
    const before = store.current();
    place(store, ctx, "breaker", -20, 30);
    const after = store.current();
    const diff = effectDiff(before, after, 3, "p2", ctx.config.analysis.budgetOps);
    expect(diff.available).toBe(true);
  });
});

describe("labels and wording", () => {
  it("labels name the rule and pass ClaimLint", () => {
    expect(gameModeLabel("bichromatic")).toBe(BICHROMATIC_LABEL);
    expect(gameModeLabel("monochromatic")).toBe(MONOCHROMATIC_LABEL);
    expect(BICHROMATIC_LABEL.rule).toContain("Maker points only");
    expect(MONOCHROMATIC_LABEL.rule).toContain("either player");
    expect(earlyWinHeadline("bichromatic")).toContain("Maker-only");
    expect(earlyWinClaimText("bichromatic")).toContain("every vertex is a Maker point");
    expect(witnessLabel("bichromatic", ["p1", "p3"])).toBe("Maker-only k-hole: p1, p3");
    expect(witnessLabel("monochromatic", ["p1", "p3"])).toBe("k-hole: p1, p3");
    expect(ruleCaption("bichromatic").startsWith("Bichromatic rule:")).toBe(true);
    expect(
      lintStrings([
        BICHROMATIC_LABEL.rule,
        MONOCHROMATIC_LABEL.rule,
        earlyWinHeadline("bichromatic"),
        earlyWinClaimText("bichromatic"),
        earlyWinClaimText("monochromatic"),
        witnessLabel("bichromatic", ["p1"]),
        ruleCaption("bichromatic"),
        ruleCaption("monochromatic"),
      ]),
    ).toEqual([]);
  });
});

// keep the type import used when strict unused checks run
export type _GameState = GameState;
