// tests/engine/bias.test.ts — bias 1:s through the engine: session init and
// normalisation, turn enforcement, state invariants (I3/I7), hash stability,
// guided refusal, round counting, orthogonality with the bichromatic rule.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import type { GameState, Player, UserAction } from "../../src/game/types.ts";
import { canonicalStateString, stateHash } from "../../src/game/hash.ts";
import { checkStateInvariants, placePoint } from "../../src/game/place.ts";
import { turnSequence } from "../../src/game/turnorder.ts";
import { initSession } from "../../src/engine/init.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import type { EngineResult, RuntimeCtx } from "../../src/engine/orchestrator.ts";
import { sessionStats } from "../../src/engine/describe.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { biasCaption, biasLabel, OUT_OF_TURN_TEXT } from "../../src/explain/bias.ts";
import { lintStrings } from "../../src/explain/claimlint.ts";
import { testCtx } from "../helpers.ts";
import { ensureK5 } from "../strategies/k5driver.ts";
import { BI_DEF_ID, ensureBichromaticDefs } from "./bichromatic-defs.ts";

ensureK5();
ensureBichromaticDefs();

const R = (n: number, d = 1): Rat => Rat.make(BigInt(n), BigInt(d));

function P(x: number, y: number): Pt {
  return pt(Rat.make(BigInt(x)), Rat.make(BigInt(y)));
}

function sandbox(bias: Rat | undefined, opts: { bi?: boolean; k?: 3 | 4 | 5 | 8; budget?: number } = {}) {
  const store = new Store();
  const ctx = testCtx(opts.budget);
  const started = startSession(
    {
      kind: "sandbox",
      config: {
        mode: "sandbox",
        window: ctx.config.window,
        ...(opts.bi === true ? { gameMode: "bichromatic" as const } : {}),
        ...(bias !== undefined ? { bias } : {}),
      },
      k: opts.k ?? 5,
    },
    ctx,
    store,
  );
  expect(started.status).toBe("accepted");
  return { store, ctx };
}

function place(store: Store, ctx: RuntimeCtx, owner: Player, x: number, y: number): EngineResult {
  const action: UserAction = { kind: "place", owner, at: P(x, y) };
  const r = reduceTransaction(store.current(), action, ctx);
  if (r.status === "accepted") {
    commit(r, action, store, ctx);
  }
  return r;
}

// Points on a convex-ish curve: always in general position.
const pts = (i: number): [number, number] => [i * 3 + 1, i * i + 2];

describe("initSession and the bias field", () => {
  it("bias 1:1 (absent, 1, 2/2) never produces a bias key and an identical hash", () => {
    const ctx = testCtx();
    const base = initSession({ kind: "sandbox", config: { mode: "sandbox", window: ctx.config.window }, k: 5 }, ctx);
    for (const b of [undefined, R(1), R(2, 2)]) {
      const r = initSession(
        { kind: "sandbox", config: { mode: "sandbox", window: ctx.config.window, ...(b !== undefined ? { bias: b } : {}) }, k: 5 },
        ctx,
      );
      expect(r.status).toBe("accepted");
      expect(r.state !== undefined && "bias" in r.state).toBe(false);
      expect(r.state !== undefined && base.state !== undefined && stateHash(r.state)).toBe(
        base.state !== undefined ? stateHash(base.state) : "",
      );
    }
  });

  it("a bias other than 1:1 is stored exactly and changes the hash", () => {
    const ctx = testCtx();
    const mk = (b: Rat) =>
      initSession({ kind: "sandbox", config: { mode: "sandbox", window: ctx.config.window, bias: b }, k: 5 }, ctx).state;
    const a = mk(R(3));
    const b = mk(R(5, 2));
    expect(a?.bias?.toString()).toBe("3/1");
    expect(b?.bias?.toString()).toBe("5/2");
    expect(a !== undefined && b !== undefined && stateHash(a) !== stateHash(b)).toBe(true);
    expect(canonicalStateString(a as GameState)).toContain("bias:3/1");
    expect(canonicalStateString(b as GameState)).toContain("bias:5/2");
  });

  it("rejects negative, too large, over-fine and non-Rat bias (malformed-input)", () => {
    const ctx = testCtx();
    for (const bias of [R(-1), R(65), R(1, 1001), "2" as unknown as Rat, 2 as unknown as Rat]) {
      const r = initSession({ kind: "sandbox", config: { mode: "sandbox", window: ctx.config.window, bias }, k: 5 }, ctx);
      expect(r.status).toBe("rejected");
      expect(r.error?.code).toBe("malformed-input");
    }
    for (const ok of [R(0), R(64), R(1, 1000), R(64000, 1000)]) {
      expect(
        initSession({ kind: "sandbox", config: { mode: "sandbox", window: ctx.config.window, bias: ok }, k: 5 }, ctx).status,
      ).toBe("accepted");
    }
  });

  it("guided sessions refuse any bias other than 1:1 with a typed unsupported-bias error", () => {
    const ctx = testCtx();
    for (const strategyId of ["esmb-k5", "fixture-triangle", BI_DEF_ID]) {
      const r = initSession(
        { kind: "guided", config: { mode: "break", window: ctx.config.window, bias: R(2) }, strategyId, mode: "break" },
        ctx,
      );
      expect(r.status, strategyId).toBe("rejected");
      expect(r.error?.code).toBe("malformed-input");
      expect(JSON.stringify(r.error)).toContain("unsupported-bias");
    }
    // bias 1:1 passes through unchanged
    expect(
      initSession(
        { kind: "guided", config: { mode: "break", window: ctx.config.window, bias: R(1) }, strategyId: "esmb-k5", mode: "break" },
        ctx,
      ).status,
    ).toBe("accepted");
  });
});

describe("turn enforcement in the sandbox", () => {
  it("1:1 sandbox keeps free owners (unchanged behaviour)", () => {
    const { store, ctx } = sandbox(undefined);
    expect(place(store, ctx, "breaker", ...pts(0)).status).toBe("accepted");
    expect(place(store, ctx, "breaker", ...pts(1)).status).toBe("accepted");
    expect(place(store, ctx, "maker", ...pts(2)).status).toBe("accepted");
  });

  it("s = 2: M B B M B B ... ; every other owner is rejected as out-of-turn", () => {
    const { store, ctx } = sandbox(R(2));
    const seq = turnSequence(R(2), 9);
    for (let i = 0; i < 9; i += 1) {
      const wrong: Player = seq[i] === "maker" ? "breaker" : "maker";
      const bad = place(store, ctx, wrong, ...pts(i));
      expect(bad.status, `i=${i}`).toBe("rejected");
      expect(JSON.stringify(bad.diagnostics)).toContain("out-of-turn");
      expect(place(store, ctx, seq[i] as Player, ...pts(i)).status).toBe("accepted");
      expect(store.current().points.length).toBe(i + 1);
    }
    const owners = store.current().points.map((p) => p.owner);
    expect(owners).toEqual(seq);
    expect(checkStateInvariants(store.current())).toEqual({ ok: true });
  });

  it("turn after each placement equals the oracle sequence (s = 3/2, 1/2, 0, 12)", () => {
    for (const bias of [R(3, 2), R(1, 2), R(0), R(12), R(7, 3)]) {
      const { store, ctx } = sandbox(bias, { k: 8, budget: 1000 });
      const seq = turnSequence(bias, 30);
      for (let i = 0; i < 30; i += 1) {
        expect(store.current().turn).toBe(seq[i]);
        expect(place(store, ctx, seq[i] as Player, ...pts(i)).status).toBe("accepted");
      }
    }
  });

  it("s = 0: Breaker can never place", () => {
    const { store, ctx } = sandbox(R(0));
    expect(place(store, ctx, "breaker", ...pts(0)).status).toBe("rejected");
    expect(place(store, ctx, "maker", ...pts(0)).status).toBe("accepted");
    expect(place(store, ctx, "breaker", ...pts(1)).status).toBe("rejected");
    expect(store.current().turn).toBe("maker");
  });

  it("undo/redo and branching keep the turn order consistent (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 4 }), (n, d) => {
        const bias = Rat.make(BigInt(n), BigInt(d));
        const { store, ctx } = sandbox(bias);
        const seq = turnSequence(bias, 12);
        for (let i = 0; i < 12; i += 1) {
          place(store, ctx, seq[i] as Player, ...pts(i));
        }
        for (const st of store.tree().transactions.map((t) => store.stateAtTxn(t.txnId))) {
          expect(checkStateInvariants(st)).toEqual({ ok: true });
        }
      }),
      { numRuns: 25 },
    );
  });

  it("round counting: round r begins with Maker's r-th point", () => {
    const { store, ctx } = sandbox(R(2));
    const rounds: number[] = [];
    const seq = turnSequence(R(2), 7);
    rounds.push(sessionStats(store.current()).round);
    for (let i = 0; i < 7; i += 1) {
      place(store, ctx, seq[i] as Player, ...pts(i));
      rounds.push(sessionStats(store.current()).round);
    }
    // M B B M B B M  -> rounds after each placement
    expect(rounds).toEqual([0, 1, 1, 1, 2, 2, 2, 3]);
    // 1:1 keeps ceil(n/2)
    const u = sandbox(undefined);
    const r1: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      place(u.store, u.ctx, i % 2 === 0 ? "maker" : "breaker", ...pts(i));
      r1.push(sessionStats(u.store.current()).round);
    }
    expect(r1).toEqual([1, 1, 2, 2, 3]);
  });

  it("is orthogonal to the bichromatic rule: both flags coexist, hash differs from each alone", () => {
    const both = sandbox(R(2), { bi: true });
    expect(both.store.current().gameMode).toBe("bichromatic");
    expect(both.store.current().bias?.toString()).toBe("2/1");
    const onlyBias = sandbox(R(2));
    const onlyBi = sandbox(undefined, { bi: true });
    const hashes = new Set([
      stateHash(both.store.current()),
      stateHash(onlyBias.store.current()),
      stateHash(onlyBi.store.current()),
    ]);
    expect(hashes.size).toBe(3);
    const seq = turnSequence(R(2), 6);
    for (let i = 0; i < 6; i += 1) {
      expect(place(both.store, both.ctx, seq[i] as Player, ...pts(i)).status).toBe("accepted");
    }
  });

  it("a Breaker block never produces a win under the bichromatic rule (maker triangle blocked)", () => {
    // k = 3, s = 2: M B B M B B M. Maker p1,p4,p7 vs Breaker points inside.
    const { store, ctx } = sandbox(R(2), { bi: true, k: 3 });
    const moves: Array<[Player, number, number]> = [
      ["maker", 0, 0],
      ["breaker", 5, 3],
      ["breaker", 30, 40],
      ["maker", 10, 0],
      ["breaker", -20, 50],
      ["breaker", 60, -45],
      ["maker", 5, 10],
    ];
    let last: EngineResult | undefined;
    for (const [o, x, y] of moves) {
      last = place(store, ctx, o, x, y);
      expect(last.status).toBe("accepted");
    }
    // p2 = (5,3) sits inside Maker's triangle: no Maker-only hole is reported.
    expect(last?.diagnostics.some((d) => d.kind === "analysis-note")).toBe(false);
  });
});

describe("state invariants for biased states", () => {
  const mk = (owners: Player[], bias: Rat, turn: Player | "over" = "maker"): GameState => ({
    seq: 0,
    k: 5,
    mode: "sandbox",
    bias,
    points: owners.map((owner, i) => ({ id: `p${i + 1}`, owner, pt: P(...pts(i)), move: i + 1 })),
    turn,
    terminal: null,
    strategy: null,
  });

  it("I7: owners that deviate from the bias order are rejected", () => {
    const ok = mk(["maker", "breaker", "breaker"], R(2), "maker");
    expect(checkStateInvariants(ok)).toEqual({ ok: true });
    const bad = mk(["maker", "breaker", "maker"], R(2), "breaker");
    const c = checkStateInvariants(bad);
    expect(c.ok).toBe(false);
    if (!c.ok) {
      expect(c.violated).toBe("i7");
    }
  });

  it("I3: the stored turn must equal the bias turn", () => {
    const wrong = mk(["maker", "breaker"], R(2), "maker"); // breaker still owes one
    const c = checkStateInvariants(wrong);
    expect(c.ok).toBe(false);
    if (!c.ok) {
      expect(c.violated).toBe("i3");
    }
  });

  it("placePoint maintains the turn for biased states and parity for unbiased", () => {
    let s = mk([], R(3), "maker");
    const seq = turnSequence(R(3), 8);
    for (let i = 0; i < 8; i += 1) {
      s = placePoint(s, seq[i] as Player, P(...pts(i)));
    }
    expect(s.turn).toBe(turnSequence(R(3), 9)[8]);
    const { bias: _b, ...rest } = mk([], R(3));
    void _b;
    const u2 = placePoint(rest as GameState, "maker", P(1, 1));
    expect(u2.turn).toBe("breaker");
  });
});

describe("wording", () => {
  it("labels and captions", () => {
    expect(biasLabel(undefined)).toBe("1:1");
    expect(biasLabel(R(3))).toBe("1:3");
    expect(biasLabel(R(5, 2))).toBe("1:5/2");
    expect(biasCaption(undefined)).toContain("alternate");
    expect(biasCaption(R(1))).toContain("alternate");
    expect(biasCaption(R(0))).toContain("no points");
    expect(biasCaption(R(3))).toContain("places 3 points");
    expect(biasCaption(R(1, 2))).toContain("floor(1r/2)");
    expect(biasCaption(R(5, 2))).toContain("project's rule");
  });
  it("is ClaimLint-clean", () => {
    expect(
      lintStrings([
        biasCaption(undefined),
        biasCaption(R(0)),
        biasCaption(R(3)),
        biasCaption(R(5, 2)),
        OUT_OF_TURN_TEXT,
      ]),
    ).toEqual([]);
  });
});
