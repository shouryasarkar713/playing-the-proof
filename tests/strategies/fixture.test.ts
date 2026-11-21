// tests/strategies/fixture.test.ts — full guided sessions on the [FIX]
// triangle: init parks, txn1 routes + chains to a round-2 win (Cardinality
// guided=2), milestones, store isolation, determinism, status.
import { describe, expect, it } from "vitest";
import { placePoint } from "../../src/game/place.ts";
import { withStrategy } from "../../src/game/types.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import { stateHash } from "../../src/game/hash.ts";
import { fixtureTriangle } from "../../src/strategy/strategies/fixtureTriangle.ts";
import {
  effectiveStatus,
  registerStrategy,
} from "../../src/strategy/registry.ts";
import { P } from "../strategy/scaffolding.ts";
import { testCtx } from "../helpers.ts";

registerStrategy(fixtureTriangle, "fixture");

function launch() {
  const store = new Store();
  const ctx = testCtx();
  const started = startSession(
    {
      kind: "guided",
      config: { mode: "break", window: ctx.config.window },
      strategyId: "fixture-triangle",
      mode: "break",
    },
    ctx,
    store,
  );
  expect(started.status).toBe("accepted");
  if (started.status !== "accepted" || started.state === undefined) {
    throw new Error("unreachable");
  }
  return { store, ctx, state: started.state };
}

describe("fixture init (txn 0)", () => {
  it("places A1=(0,0), parks at await-b1, zero events", () => {
    const { store, state } = launch();
    expect(state.points.length).toBe(1);
    expect(state.points[0]?.id).toBe("p1");
    expect(state.points[0]?.owner).toBe("maker");
    expect(state.points[0]?.pt.x.toString()).toBe("0/1");
    expect(state.strategy?.nodeId).toBe("await-b1");
    expect(state.strategy?.vars).toEqual({ A1: "p1" });
    expect(state.turn).toBe("breaker");
    expect(state.seq).toBe(0);
    const txn = store.tree().transactions[0];
    expect(txn?.events).toEqual([]);
    expect(txn?.result).toEqual({ kind: "committed" });
  });
});

describe("fixture txn1 (breaker + maker win)", () => {
  function play(x: number, y: number) {
    const { store, ctx } = launch();
    const at = P(x, y);
    const r = reduceTransaction(
      store.current(),
      { kind: "place", owner: "breaker", at },
      ctx,
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") {
      throw new Error("unreachable");
    }
    commit(r, { kind: "place", owner: "breaker", at }, store, ctx);
    return { store, r };
  }

  it("B1=(10,0): A2=(5/2,7/2) exactly; maker-won with the triangle", () => {
    const { store, r } = play(10, 0);
    // CardinalityRule: guided = 2 events (Breaker + automatic Maker).
    expect(r.events.length).toBe(2);
    const [b1, a2] = [r.events[0], r.events[1]];
    expect(b1?.owner).toBe("breaker");
    expect(b1?.caseId).toBe("fx:any");
    expect(b1?.nodeAfter).toBe("after-b1");
    expect(a2?.owner).toBe("maker");
    expect(a2?.appliedPoint).toBe("p3");
    expect(a2?.nodeAfter).toBe("win");
    expect(a2?.caseId).toBe(undefined);
    // A2 is the first legal fixed candidate, exactly.
    expect(a2?.at.x.toString()).toBe("5/2");
    expect(a2?.at.y.toString()).toBe("7/2");
    // Terminal.
    expect(r.outcome?.kind).toBe("terminal");
    if (r.outcome?.kind === "terminal") {
      expect(r.outcome.terminal.kind).toBe("maker-won");
      if (r.outcome.terminal.kind === "maker-won") {
        expect(r.outcome.terminal.nodeId).toBe("win");
        expect(r.outcome.terminal.witness.length).toBe(1);
        expect(
          [...r.outcome.terminal.witness[0]?.verts ?? []].sort(),
        ).toEqual(["p1", "p2", "p3"]);
      }
    }
    const cur = store.current();
    expect(cur.strategy?.nodeId).toBe("win");
    expect(cur.strategy?.vars).toMatchObject({ A1: "p1", B1: "p2", A2: "p3" });
    expect(cur.terminal?.kind).toBe("maker-won");
    // Milestone: breaker event hashes the post-verified routed state
    // (nodeId after-b1) — equals committed-minus-seq (park-pre changed
    // nothing and the chain advanced past it... verified structurally:
    // nodeAfter names the milestone node).
    expect(b1?.nodeAfter).toBe("after-b1");
  });

  it("second candidate when B1 blocks the first", () => {
    // B1=(5,2): line A1–B1 is y=(2/5)x; (5/2,7/2) off it... first candidate
    // legal? orient((0,0),(5,2),(5/2,7/2)) = 5·3.5−2·2.5 = 17.5−5 ≠ 0 ✓
    // legal → still first. Use B1 on the first-candidate ray instead:
    // B1=(5,7): collinear with A1,(5/2,7/2)? (5/2,7/2) vs (5,7): 2.5·7−3.5·5
    // = 17.5−17.5 = 0 → blocked → second candidate (7/2,5/2) placed.
    const { r } = play(5, 7);
    const a2 = r.events[1];
    expect(a2?.at.x.toString()).toBe("7/2");
    expect(a2?.at.y.toString()).toBe("5/2");
  });

  it("sessions are deterministic (same B1, same everything)", () => {
    const a = play(10, 0);
    const b = play(10, 0);
    expect(JSON.stringify(a.r.events)).toBe(JSON.stringify(b.r.events));
    expect(stateHash(a.store.current())).toBe(stateHash(b.store.current()));
  });

  it("store isolation: only committed (parked-or-terminal) states stored", () => {
    const { store } = play(10, 0);
    const tree = store.tree();
    expect(tree.transactions.length).toBe(2);
    for (const txnId of [0, 1]) {
      const st = store.stateAtTxn(txnId);
      expect(st.seq).toBe(txnId);
      if (st.terminal === null) {
        expect(st.strategy?.nodeId).toBe("await-b1");
      } else {
        expect(st.terminal.kind).toBe("maker-won");
      }
    }
  });

  it("committed guided states are frozen", () => {
    const { store } = play(10, 0);
    const cur = store.current();
    expect(() => {
      ((cur as unknown as Record<string, unknown>)["turn"] = "maker");
    }).toThrow();
  });

  it("derived status is fixture (Gate E precursor)", () => {
    const { ctx } = launch();
    const rs = ctx.strategies.get("fixture-triangle");
    expect(rs !== undefined).toBe(true);
    if (rs !== undefined) {
      expect(effectiveStatus(rs)).toBe("fixture");
    }
  });

  it("breaker milestone hashes the post-verified routed state (§5.8 row 2)", () => {
    // Reconstruct the transient routed state R exactly: txn-0 state +
    // Breaker placement (seq preserved) + route bindings, advanced to the
    // route target — then the event hash must equal stateHash(R).
    const { store, r } = play(10, 0);
    const s0 = store.stateAtTxn(0);
    const b1 = r.events[0];
    expect(b1?.nodeAfter).toBe("after-b1");
    let R = placePoint(s0, "breaker", P(10, 0));
    R = withStrategy(R, (rt) => ({
      ...rt,
      lastCase: "fx:any",
      vars: { ...rt.vars, B1: "p2" },
      nodeId: "after-b1",
    }));
    expect(b1?.stateHash).toBe(stateHash(R));
  });
});
