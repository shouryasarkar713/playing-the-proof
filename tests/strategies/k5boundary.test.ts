// tests/strategies/k5boundary.test.ts — the edge-of-window uncovered path
// on the REAL esmb-k5 (Phase-12 test spec): with the window corners exactly
// on the played rectangle, the blunder-branch extend has no room inside the
// window on any hole edge → maker-construction/window-exhausted (honest
// uncovered, never a guess). Plus attack-log export → refold re-validation.
import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { attackLog } from "../../src/engine/describe.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import type { RuntimeCtx } from "../../src/engine/orchestrator.ts";
import type { Configuration, GameState } from "../../src/game/types.ts";
import { P } from "../strategy/scaffolding.ts";
import { testCtx } from "../helpers.ts";
import { ensureK5, refoldK5 } from "./k5driver.ts";

ensureK5();

// Window corners exactly on the scripted rectangle (boundary-inclusive
// legality, §4.4 rung 1 non-strict).
function cornerConfig(): Configuration {
  const base = testCtx().config;
  return {
    ...base,
    window: {
      xMin: Rat.make(0n),
      yMin: Rat.make(0n),
      xMax: Rat.make(20n),
      yMax: Rat.make(28n),
    },
  };
}

function cornerCtx(): RuntimeCtx {
  const base = testCtx();
  return { ...base, config: cornerConfig() };
}

function launchCorner(): { store: Store; ctx: RuntimeCtx } {
  const store = new Store();
  const ctx = cornerCtx();
  const started = startSession(
    {
      kind: "guided",
      config: { mode: "break", window: ctx.config.window },
      strategyId: "esmb-k5",
      mode: "break",
    },
    ctx,
    store,
  );
  expect(started.status).toBe("accepted");
  return { store, ctx };
}

function breaker(store: Store, ctx: RuntimeCtx, at: Pt): GameState {
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
  return store.current();
}

describe("k5 boundary quad → uncovered (maker-construction/window-exhausted)", () => {
  it("corners (0,28)/(20,0): blunder extend has no room → honest uncovered", () => {
    const { store, ctx } = launchCorner();
    // A1=(0,0) corner; B1=(0,28) corner; A2=(20,28) corner (first legal
    // fixed candidate); B2=(20,0) corner — convex rectangle (blunder).
    breaker(store, ctx, P(0, 28));
    expect(store.current().strategy?.nodeId).toBe("k5:r2:classify");
    expect(store.current().points[2]?.pt.x.toString()).toBe("20/1");
    const cur = breaker(store, ctx, P(20, 0));
    expect(cur.strategy?.lastCase).toBe("k5:b2:convex");
    expect(cur.terminal?.kind).toBe("uncovered");
    if (cur.terminal?.kind === "uncovered") {
      expect(cur.terminal.report.origin).toBe("maker-construction");
      if (cur.terminal.report.origin === "maker-construction") {
        expect(cur.terminal.report.reason).toBe("window-exhausted");
        expect(cur.terminal.report.at.nodeId).toBe("k5:blunder");
      }
    }
    expect(cur.points.length).toBe(4);
  });

  it("attack log records the uncovered txn; summary counts it", () => {
    const { store, ctx } = launchCorner();
    breaker(store, ctx, P(0, 28));
    breaker(store, ctx, P(20, 0));
    const log = attackLog(
      store.tree(),
      (id) => store.stateAtTxn(id),
      ctx.config.analysis.budgetOps,
    );
    expect(log !== null).toBe(true);
    expect(log?.entries.length).toBe(2);
    expect(log?.entries[1]?.terminalKind).toBe("uncovered");
    expect(log?.summary.uncovered).toBe(1);
    expect(log?.summary.wins).toBe(0);
    expect(log?.strategyId).toBe("esmb-k5");
  });

  it("export → refold reproduces the uncovered terminal (replay check)", () => {
    const { store, ctx } = launchCorner();
    breaker(store, ctx, P(0, 28));
    breaker(store, ctx, P(20, 0));
    const log = attackLog(
      store.tree(),
      (id) => store.stateAtTxn(id),
      ctx.config.analysis.budgetOps,
    );
    expect(log !== null).toBe(true);
    // JSON round-trip (the export shape) + point parse.
    const wire = JSON.parse(JSON.stringify(log)) as NonNullable<typeof log>;
    expect(wire.format).toBe("esmb-attack-log");
    const pts = wire.entries.map((e) =>
      pt(Rat.fromString(e.point.x), Rat.fromString(e.point.y)),
    );
    const re = refoldK5(pts, cornerConfig());
    expect(re.won).toBe(false);
    expect(re.terminalKind).toBe("uncovered");
    expect(re.points).toBe(4);
  });
});
