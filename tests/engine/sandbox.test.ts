// tests/engine/sandbox.test.ts — Phase-7 engine-only integration: session
// launch, scripted sandbox play through startSession + reduceTransaction +
// commit (test dispatch shim), sequencing, branching, rejections, the
// sandbox win/analysis-note split, and the commit gate.
import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { stateHash } from "../../src/game/hash.ts";
import type {
  GameState,
  UserAction,
} from "../../src/game/types.ts";
import {
  committedStateAdmissible,
  CommitGateError,
  reduceTransaction,
} from "../../src/engine/orchestrator.ts";
import type { EngineResult } from "../../src/engine/orchestrator.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { navigate } from "../../src/session/navigate.ts";
import { Store, UnknownTxnError } from "../../src/session/store.ts";
import { chainTo, childrenOf } from "../../src/session/sessionTree.ts";
import { testCtx } from "../helpers.ts";
import type { RuntimeCtx } from "../../src/engine/orchestrator.ts";

function P(x: number, y: number): Pt {
  return pt(Rat.make(BigInt(x)), Rat.make(BigInt(y)));
}

function launch(k: 3 | 4 | 5 | 6 | 7 | 8 = 5): {
  store: Store;
  ctx: RuntimeCtx;
  state: GameState;
} {
  const store = new Store();
  const ctx = testCtx();
  const started = startSession(
    { kind: "sandbox", config: { mode: "sandbox", window: ctx.config.window }, k },
    ctx,
    store,
  );
  if (started.status !== "accepted" || started.state === undefined) {
    throw new Error("launch failed");
  }
  return { store, ctx, state: started.state };
}

// Test dispatch shim: reduce → commit (rejections commit nothing).
function dispatch(
  store: Store,
  ctx: RuntimeCtx,
  action: UserAction,
): EngineResult {
  const r = reduceTransaction(store.current(), action, ctx);
  if (r.status === "rejected") {
    return r;
  }
  commit(r, action, store, ctx);
  return r;
}

describe("session launch (txn 0)", () => {
  it("commits an empty board with zero events and a null-root chain", () => {
    const { store, state } = launch(5);
    expect(state.points).toEqual([]);
    expect(state.seq).toBe(0);
    expect(state.turn).toBe("maker");
    const tree = store.tree();
    expect(tree.transactions.length).toBe(1);
    const txn = tree.transactions[0] as (typeof tree.transactions)[number];
    expect(txn.txnId).toBe(0);
    expect(txn.parentTxnId).toBe(null);
    expect(txn.events).toEqual([]);
    expect(txn.beforeHash).toBe(null);
    expect(txn.afterHash).toBe(stateHash(state));
    expect(txn.result).toEqual({ kind: "committed" });
    expect(store.cursorTxnId()).toBe(0);
  });

  it("rejects out-of-range k and guided requests (Phase-7 scope)", () => {
    const store = new Store();
    const ctx = testCtx();
    const badK = startSession(
      {
        kind: "sandbox",
        config: { mode: "sandbox", window: ctx.config.window },
        k: 9 as unknown as 5,
      },
      ctx,
      store,
    );
    expect(badK.status).toBe("rejected");
    if (badK.status === "rejected") {
      expect(badK.error?.code).toBe("malformed-input");
    }
    expect(store.tree().transactions.length).toBe(0);
    const guided = startSession(
      {
        kind: "guided",
        config: { mode: "break", window: ctx.config.window },
        strategyId: "esmb-k5",
        mode: "break",
      },
      ctx,
      store,
    );
    expect(guided.status).toBe("rejected");
    expect(store.tree().transactions.length).toBe(0);
  });
});

describe("sandbox play (scripted)", () => {
  it("places with alternating owners, sequenced events, chained hashes", () => {
    const { store, ctx } = launch(5);
    dispatch(store, ctx, { kind: "place", owner: "maker", at: P(0, 0) });
    dispatch(store, ctx, { kind: "place", owner: "breaker", at: P(10, 0) });
    dispatch(store, ctx, { kind: "place", owner: "maker", at: P(0, 10) });
    const tree = store.tree();
    expect(tree.transactions.length).toBe(4);
    expect(tree.events.length).toBe(3);
    const ordinals = tree.events.map((e) => e.i);
    expect(ordinals).toEqual([1, 2, 3]);
    expect(tree.events[0]?.parent).toBe(null);
    expect(tree.events[1]?.parent).toBe(1);
    expect(tree.events[2]?.parent).toBe(2);
    // txn/event linkage + CardinalityRule (1 event per sandbox txn).
    for (const txnId of [1, 2, 3]) {
      const txn = tree.transactions[txnId] as (typeof tree.transactions)[number];
      expect(txn.events.length).toBe(1);
      expect(txn.events[0]?.txnId).toBe(txnId);
      expect(txn.events[0]?.indexInTxn).toBe(1);
    }
    // Hash chain + seq contract.
    for (const txnId of [0, 1, 2, 3]) {
      const txn = tree.transactions[txnId] as (typeof tree.transactions)[number];
      const st = store.stateAtTxn(txnId);
      expect(st.seq).toBe(txnId);
      expect(txn.afterHash).toBe(stateHash(st));
      if (txnId > 0) {
        const prev = tree.transactions[txnId - 1] as (typeof tree.transactions)[number];
        expect(txn.beforeHash).toBe(prev.afterHash);
      }
    }
    // Reducer preserves the input seq (never invents metadata).
    const cur = store.current();
    const r = reduceTransaction(cur, { kind: "place", owner: "breaker", at: P(5, 6) }, ctx);
    expect(r.status).toBe("accepted");
    if (r.status === "accepted" && r.nextState !== undefined) {
      expect(r.nextState.seq).toBe(cur.seq);
    }
    // Event milestone (§5.8 invariant 2): nodeAfter null + milestone hash.
    if (r.status === "accepted" && r.nextState !== undefined) {
      expect(r.events.length).toBe(1);
      const ev = r.events[0] as (typeof r.events)[number];
      expect(ev.nodeAfter).toBe(null);
      expect(ev.caseId).toBe(undefined);
      expect(ev.stateHash).toBe(stateHash(r.nextState));
    }
  });

  it("a completed k-hole is an analysis note, never a terminal", () => {
    const { store, ctx } = launch(3);
    dispatch(store, ctx, { kind: "place", owner: "maker", at: P(0, 0) });
    dispatch(store, ctx, { kind: "place", owner: "breaker", at: P(4, 0) });
    const r = dispatch(store, ctx, { kind: "place", owner: "maker", at: P(0, 4) });
    expect(r.status).toBe("accepted");
    if (r.status === "accepted") {
      expect(r.outcome).toEqual({ kind: "committed" });
      expect(r.nextState?.terminal).toBe(null);
      const note = r.diagnostics.find((d) => d.kind === "analysis-note");
      expect(note !== undefined).toBe(true);
      if (note !== undefined && note.kind === "analysis-note") {
        expect(note.note.kind).toBe("exhaustive");
      }
    }
    // Play continues past the hole.
    dispatch(store, ctx, { kind: "place", owner: "breaker", at: P(10, 10) });
    expect(store.current().points.length).toBe(4);
    expect(store.current().terminal).toBe(null);
  });

  it("rejections change nothing (no txn, no event, diagnostics only)", () => {
    const { store, ctx } = launch(5);
    dispatch(store, ctx, { kind: "place", owner: "maker", at: P(0, 0) });
    const before = store.tree().transactions.length;
    const r = dispatch(
      store,
      ctx,
      { kind: "place", owner: "breaker", at: P(0, 0) },
    );
    expect(r.status).toBe("rejected");
    if (r.status === "rejected") {
      expect(r.events).toEqual([]);
      expect(r.diagnostics[0]?.kind).toBe("rejection");
    }
    expect(store.tree().transactions.length).toBe(before);
    expect(store.tree().events.length).toBe(1);
  });
});

describe("branching and navigation", () => {
  it("branch creates a sibling; undo-at-0 is a no-op", () => {
    const { store, ctx } = launch(5);
    dispatch(store, ctx, { kind: "place", owner: "maker", at: P(0, 0) });
    dispatch(store, ctx, { kind: "place", owner: "breaker", at: P(10, 0) });
    navigate(store, { kind: "branch", atTxnId: 1 });
    expect(store.cursorTxnId()).toBe(1);
    expect(store.current().points.length).toBe(1);
    dispatch(store, ctx, { kind: "place", owner: "breaker", at: P(0, 10) });
    const tree = store.tree();
    expect(childrenOf(tree, 1).length).toBe(2);
    const branch = childrenOf(tree, 1)[1] as (typeof tree.transactions)[number];
    expect(branch.parentTxnId).toBe(1);
    expect(branch.txnId).toBe(3);
    expect(branch.beforeHash).toBe(
      (tree.transactions[1] as (typeof tree.transactions)[number]).afterHash,
    );
    expect(chainTo(tree, 3).map((t) => t.txnId)).toEqual([0, 1, 3]);
    navigate(store, { kind: "goto", txnId: 2 });
    expect(store.current().points.length).toBe(2);
    navigate(store, { kind: "undo" });
    expect(store.cursorTxnId()).toBe(1);
    navigate(store, { kind: "goto", txnId: 0 });
    navigate(store, { kind: "undo" });
    expect(store.cursorTxnId()).toBe(0);
  });

  it("unknown transactions throw UnknownTxn", () => {
    const { store } = launch(5);
    expect(() => store.stateAtTxn(99)).toThrow(UnknownTxnError);
    expect(() => navigate(store, { kind: "goto", txnId: 99 })).toThrow(
      UnknownTxnError,
    );
  });
});

describe("commit gate", () => {
  it("admits sandbox states; throws CommitGateError on violations", () => {
    const { store, ctx } = launch(5);
    const cur = store.current();
    expect(committedStateAdmissible(cur, ctx)).toEqual({ ok: true });
    const bad: GameState = { ...cur, turn: "breaker" };
    const admission = committedStateAdmissible(bad, ctx);
    expect(admission.ok).toBe(false);
    const fake = {
      status: "accepted",
      outcome: { kind: "committed" },
      nextState: bad,
      events: [],
      diagnostics: [],
    } as EngineResult;
    const txnsBefore = store.tree().transactions.length;
    expect(() =>
      commit(fake, { kind: "place", owner: "maker", at: P(1, 1) }, store, ctx),
    ).toThrow(CommitGateError);
    expect(store.tree().transactions.length).toBe(txnsBefore);
  });

  it("publishes snapshots to subscribers on every commit", () => {
    const { store, ctx } = launch(5);
    const seen: number[] = [];
    const unsub = store.subscribe((snap) => {
      seen.push(snap.cursorTxnId);
    });
    dispatch(store, ctx, { kind: "place", owner: "maker", at: P(0, 0) });
    navigate(store, { kind: "undo" });
    expect(seen).toEqual([1, 0]);
    unsub();
    dispatch(store, ctx, { kind: "place", owner: "breaker", at: P(5, 6) });
    expect(seen).toEqual([1, 0]);
  });
});
