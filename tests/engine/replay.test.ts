// tests/engine/replay.test.ts — assembleReplayFile/strategyStartForExport
// branches (Phase 18): unknown strategies, uncovered-terminal expansion
// (success + both fail-loud throws), and start-record re-derivation.
import { describe, expect, it } from "vitest";
import { Store } from "../../src/session/store.ts";
import { startSession } from "../../src/session/commit.ts";
import type { ActionTransaction, Terminal } from "../../src/game/types.ts";
import {
  assembleReplayFile,
  strategyStartForExport,
} from "../../src/engine/replay.ts";
import type { AssembleOpts } from "../../src/engine/replay.ts";
import { ensureK5 } from "../strategies/k5driver.ts";
import { P, ensureK6 } from "../strategies/k6driver.ts";
import { guidedState } from "../strategy/scaffolding.ts";
import { sandboxState, testCtx } from "../helpers.ts";

ensureK5();
ensureK6();

function opts(over: Partial<AssembleOpts> = {}): AssembleOpts {
  const ctx = testCtx();
  return {
    k: 5,
    mode: "break",
    window: ctx.config.window,
    strategyId: null,
    strategyStart: null,
    meta: { createdAt: "t", app: "t", appVersion: "0.0.0" },
    engineVersion: "0.0.0",
    ...over,
  };
}

function uncoveredTerminal(nodeId: string): Terminal {
  return {
    kind: "uncovered",
    report: {
      origin: "maker-construction",
      reason: "window-exhausted",
      at: { nodeId, move: { kind: "extend-hole" } },
      detail: "d",
    },
  };
}

function treeWith(terminal: Terminal): {
  transactions: ActionTransaction[];
  events: ActionTransaction["events"];
} {
  return {
    transactions: [
      {
        txnId: 0,
        parentTxnId: null,
        action: { kind: "init" },
        events: [],
        beforeHash: null,
        afterHash: "x",
        result: { kind: "terminal", terminal },
      },
    ],
    events: [],
  };
}

describe("assembleReplayFile guards + uncovered expansion", () => {
  it("unknown strategyId throws (never a silent empty strategy)", () => {
    expect(() =>
      assembleReplayFile(treeWith(uncoveredTerminal("k5:blunder")), 0, opts({ strategyId: "nope" }), testCtx()),
    ).toThrowError(/unknown strategyId/);
  });

  it("maker-construction without a def throws fail-loud", () => {
    expect(() =>
      assembleReplayFile(treeWith(uncoveredTerminal("k5:blunder")), 0, opts(), testCtx()),
    ).toThrowError(/without a def/);
  });

  it("maker-construction at a moveless node throws fail-loud", () => {
    expect(() =>
      assembleReplayFile(
        treeWith(uncoveredTerminal("k5:await-b1")),
        0,
        opts({ strategyId: "esmb-k5" }),
        testCtx(),
      ),
    ).toThrowError(/has no move/);
  });

  it("maker-construction at a move node expands to the full MoveSpec", () => {
    const file = assembleReplayFile(
      treeWith(uncoveredTerminal("k5:blunder")),
      0,
      opts({ strategyId: "esmb-k5" }),
      testCtx(),
    );
    const txn = file.transactions[0];
    expect(txn?.result.kind).toBe("terminal");
    if (txn?.result.kind === "terminal" && txn.result.terminal.kind === "uncovered") {
      const report = txn.result.terminal.report;
      if (report.origin === "maker-construction") {
        expect(report.at.move).toMatchObject({ kind: "extend" });
      } else {
        throw new Error("test bug");
      }
    }
  });
});

describe("strategyStartForExport re-derivation", () => {
  it("null for strategy-free states", () => {
    expect(strategyStartForExport(sandboxState([P(0, 0)]))).toBe(null);
  });

  it("null for non-bootstrap runtimes (P5 unbound / unresolvable)", () => {
    expect(strategyStartForExport(guidedState([P(0, 0)], 6, "k6:boot", {}))).toBe(null);
    expect(
      strategyStartForExport(guidedState([P(0, 0)], 6, "k6:boot", { P5: "p1" })),
    ).toBe(null);
    expect(
      strategyStartForExport(guidedState([P(0, 0)], 6, "k6:boot", { P5: ["p99"] })),
    ).toBe(null);
  });

  it("re-derives an equivalent continue record from a k6 boot", () => {
    const pent = [P(0, 0), P(10, 0), P(13, 8), P(5, 13), P(-3, 8)];
    const store = new Store();
    const ctx = testCtx();
    const started = startSession(
      {
        kind: "guided",
        config: { mode: "break", window: ctx.config.window },
        strategyId: "esmb-k6",
        mode: "break",
        strategyStart: { kind: "supplied", points: pent, selectedHole: pent },
      },
      ctx,
      store,
    );
    expect(started.status).toBe("accepted");
    const rec = strategyStartForExport(store.stateAtTxn(0));
    expect(rec?.kind).toBe("continue");
    if (rec?.kind === "continue" && rec.selectedHole !== null) {
      expect(rec.selectedHole.length).toBe(5);
      expect(rec.points.length).toBe(5);
    }
  });
});
