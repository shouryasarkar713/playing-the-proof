// tests/replay/roundtrip.test.ts — shipped-sample round-trips + fold
// re-validation (§15, §27): serializeReplay(parseReplayFile(s)) is
// canonical-equal for every file under data/replays/, and every sample
// re-validates cleanly. Also proves the engine/output shape contract
// (AssembledReplay assignable to ReplayFile) in CI.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import { assembleReplayFile } from "../../src/engine/replay.ts";
import {
  parseReplayFile,
  serializeReplay,
} from "../../src/replay/format.ts";
import type { ReplayFile } from "../../src/replay/format.ts";
import { validateReplay } from "../../src/replay/validate.ts";
import { registerStrategy, strategies } from "../../src/strategy/registry.ts";
import type { StrategyDef, StrategyNode } from "../../src/strategy/types.ts";
import { Rat } from "../../src/geometry/rat.ts";
import { esmbK5 } from "../../src/strategy/strategies/k5/def.ts";
import { ensureK5 } from "../strategies/k5driver.ts";
import { ensureK6 } from "../strategies/k6driver.ts";
import { P } from "../strategy/scaffolding.ts";
import { testCtx } from "../helpers.ts";

ensureK5();
ensureK6();

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "replays");

function sampleNames(): string[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".replay.json"))
    .sort();
}

function readSample(name: string): string {
  return readFileSync(join(DIR, name), "utf8");
}

// The integrity sample's test-only def (same mutation the generator used;
// guarded for shared worker registries).
function ensureMisplaced(): void {
  if (strategies().has("test:k5-misplace")) {
    return;
  }
  const misNodes: Record<string, StrategyNode> = {};
  for (const [nid, n] of Object.entries(esmbK5.nodes)) {
    misNodes[nid] = { ...n };
  }
  const co = esmbK5.nodes["k5:r3:co-shoulder"];
  if (co === undefined) {
    throw new Error("test bug: no co-shoulder node");
  }
  misNodes["k5:r3:co-shoulder"] = {
    ...co,
    move: {
      kind: "fixed",
      at: [{ kind: "const", x: Rat.make(11n), y: Rat.make(14n) }],
    },
  };
  const def: StrategyDef = { ...esmbK5, id: "test:k5-misplace", nodes: misNodes };
  registerStrategy(def, "experimental-extension");
}

describe("shipped replay samples", () => {
  it("corpus is non-empty", () => {
    expect(sampleNames().length).toBeGreaterThan(0);
  });

  for (const name of [
    "k5-safe.replay.json",
    "k5-blunder.replay.json",
    "k5-branch.replay.json",
    "k5-boundary-uncovered.replay.json",
    "k5-integrity.replay.json",
    "k6-routeb.replay.json",
    "k6-immediate.replay.json",
    "sandbox-placed.replay.json",
  ]) {
    it(`round-trips + re-validates: ${name}`, () => {
      if (name === "k5-integrity.replay.json") {
        ensureMisplaced();
      }
      const text = readSample(name);
      const parsed = parseReplayFile(text);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) {
        throw new Error(`parse failed: ${JSON.stringify(parsed.issues)}`);
      }
      // Canonical equality: re-serializing the parse reproduces the file.
      expect(serializeReplay(parsed.file)).toBe(text);
      // The fold re-derives every state cleanly.
      const validated = validateReplay(parsed.file, testCtx());
      expect(validated.ok).toBe(true);
      if (!validated.ok) {
        throw new Error(`fold failed: ${JSON.stringify(validated.issues)}`);
      }
    });
  }
});

describe("engine output shape contract", () => {
  it("assembleReplayFile output is assignable to ReplayFile (no cast)", () => {
    const store = new Store();
    const ctx = testCtx();
    const started = startSession(
      { kind: "sandbox", config: { mode: "sandbox", window: ctx.config.window }, k: 5 },
      ctx,
      store,
    );
    expect(started.status).toBe("accepted");
    const at = P(3, 4);
    const r = reduceTransaction(store.current(), { kind: "place", owner: "maker", at }, ctx);
    if (r.status !== "accepted") {
      throw new Error("unreachable");
    }
    commit(r, { kind: "place", owner: "maker", at }, store, ctx);
    const state = store.current();
    const assembled = assembleReplayFile(
      store.tree(),
      store.cursorTxnId(),
      {
        k: state.k,
        mode: state.mode,
        window: ctx.config.window,
        strategyId: null,
        strategyStart: null,
        meta: { createdAt: "2026-09-27T00:00:00.000Z", app: "t", appVersion: "0.0.0" },
        engineVersion: "0.0.0",
      },
      ctx,
    );
    // No cast: proves the layer-clean structural contract in CI.
    const file: ReplayFile = assembled;
    expect(serializeReplay(file).length).toBeGreaterThan(0);
  });
});
