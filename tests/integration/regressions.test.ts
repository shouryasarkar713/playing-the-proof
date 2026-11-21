// tests/integration/regressions.test.ts — the regression corpus (Phase 18):
// every debugging session's failing config lands in
// data/scenarios/regressions/ as JSON and is replayed here. Files are
// auto-discovered (sorted), so adding a config is adding the test.
// Schema: {id, note?, strategy, window?, strategyStart?, moves[], expect}.
// expect is exactly one of: {terminal: null, nodeId?, points?},
// {terminal: "maker-won", points?}, {terminal: "uncovered", origin,
// reason?}, {startRejected: code}.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import type { StrategyStart } from "../../src/game/types.ts";
import { ensureK5 } from "../strategies/k5driver.ts";
import { ensureK6 } from "../strategies/k6driver.ts";
import { testCtx } from "../helpers.ts";

ensureK5();
ensureK6();

const DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "data",
  "scenarios",
  "regressions",
);

interface RegressionFile {
  id: string;
  note?: string;
  strategy: string;
  window?: { xMin: string; yMin: string; xMax: string; yMax: string };
  strategyStart?: { points: Array<[number, number]>; selectedHole: Array<[number, number]> };
  moves: Array<{ owner: "maker" | "breaker"; at: [string, string] }>;
  expect:
    | { terminal: null; nodeId?: string; points?: number }
    | { terminal: "maker-won"; points?: number }
    | { terminal: "uncovered"; origin: string; reason?: string }
    | { startRejected: string };
}

function names(): string[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
}

function load(name: string): RegressionFile {
  const raw = JSON.parse(readFileSync(join(DIR, name), "utf8")) as RegressionFile;
  if (typeof raw.id !== "string" || typeof raw.strategy !== "string") {
    throw new Error(`regressions: ${name} missing id/strategy — corrupt fixture`);
  }
  if (!Array.isArray(raw.moves) || typeof raw.expect !== "object" || raw.expect === null) {
    throw new Error(`regressions: ${name} missing moves/expect — corrupt fixture`);
  }
  return raw;
}

function ratOf(s: string): Rat {
  return Rat.fromJSON(s);
}

function ptOf(at: [string, string]): Pt {
  return pt(ratOf(at[0]), ratOf(at[1]));
}

function intPt(pair: [number, number]): Pt {
  return pt(Rat.make(BigInt(pair[0])), Rat.make(BigInt(pair[1])));
}

function runOne(raw: RegressionFile): void {
  const base = testCtx();
  const config =
    raw.window === undefined
      ? base.config
      : {
          ...base.config,
          window: {
            xMin: ratOf(raw.window.xMin),
            yMin: ratOf(raw.window.yMin),
            xMax: ratOf(raw.window.xMax),
            yMax: ratOf(raw.window.yMax),
          },
        };
  const ctx = { ...base, config };
  let start: StrategyStart | undefined = undefined;
  if (raw.strategyStart !== undefined) {
    const pts = raw.strategyStart.points.map(intPt);
    const sel = raw.strategyStart.selectedHole.map(intPt);
    start = { kind: "supplied", points: pts, selectedHole: sel };
  }
  const store = new Store();
  const started = startSession(
    raw.strategy === "esmb-k5" && start === undefined
      ? {
          kind: "guided",
          config: { mode: "break", window: config.window },
          strategyId: raw.strategy,
          mode: "break",
        }
      : {
          kind: "guided",
          config: { mode: "break", window: config.window },
          strategyId: raw.strategy,
          mode: "break",
          ...(start !== undefined ? { strategyStart: start } : {}),
        },
    ctx,
    store,
  );
  if ("startRejected" in raw.expect) {
    expect(started.status).toBe("rejected");
    if (started.status !== "rejected" || started.error === undefined) {
      throw new Error(`regressions/${raw.id}: expected a start rejection`);
    }
    expect(started.error.code).toBe(raw.expect.startRejected);
    return;
  }
  if (started.status !== "accepted") {
    throw new Error(`regressions/${raw.id}: start rejected — fixture stale?`);
  }
  for (const move of raw.moves) {
    const at = ptOf(move.at);
    const r = reduceTransaction(store.current(), { kind: "place", owner: move.owner, at }, ctx);
    if (r.status !== "accepted") {
      throw new Error(`regressions/${raw.id}: move rejected — fixture stale?`);
    }
    commit(r, { kind: "place", owner: move.owner, at }, store, ctx);
  }
  const cur = store.current();
  if (raw.expect.terminal === "maker-won") {
    expect(cur.terminal?.kind).toBe("maker-won");
    if (raw.expect.points !== undefined) {
      expect(cur.points.length).toBe(raw.expect.points);
    }
    return;
  }
  if (raw.expect.terminal === null) {
    expect(cur.terminal).toBe(null);
    if (raw.expect.nodeId !== undefined) {
      expect(cur.strategy?.nodeId).toBe(raw.expect.nodeId);
    }
    if (raw.expect.points !== undefined) {
      expect(cur.points.length).toBe(raw.expect.points);
    }
    return;
  }
  if (cur.terminal?.kind !== "uncovered") {
    throw new Error(
      `regressions/${raw.id}: expected uncovered, got ${cur.terminal?.kind ?? "null"}`,
    );
  }
  expect(cur.terminal.report.origin).toBe(raw.expect.origin);
  if (raw.expect.reason !== undefined) {
    expect(cur.terminal.report.reason).toBe(raw.expect.reason);
  }
}

describe("regression corpus (data/scenarios/regressions/)", () => {
  it("corpus is non-empty", () => {
    expect(names().length).toBeGreaterThan(0);
  });

  for (const name of ["r1-boundary-uncovered.json", "r2-swallow-wedge-b1.json", "r3-blocked-pentagon-supplied.json"]) {
    it(`replays: ${name}`, () => {
      runOne(load(name));
    });
  }

  it("every file in the folder replays (auto-discovery)", () => {
    for (const name of names()) {
      runOne(load(name));
    }
  });
});
