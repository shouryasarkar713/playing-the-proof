// tests/engine/bichromatic-defs.ts — test-only strategy defs for the
// bichromatic rule: a k=3 "three Maker points" construction registered twice
// (once declaring bichromatic support, once monochromatic) so the SAME
// action sequence can be played under both rules.
import { Rat } from "../../src/geometry/rat.ts";
import type { Rat as RatType } from "../../src/geometry/rat.ts";
import { registerStrategy, strategies } from "../../src/strategy/registry.ts";
import type { StrategyDef, StrategyNode } from "../../src/strategy/types.ts";
import { fixtureTriangle } from "../../src/strategy/strategies/fixtureTriangle.ts";

const int = (n: bigint): RatType => Rat.make(n);

const why = {
  headline: "test node",
  claims: [{ tier: "strategy-rule" as const, text: "Test construction." }],
  sourceRef: "test",
};

function node(partial: Partial<StrategyNode> & Pick<StrategyNode, "id" | "role">): StrategyNode {
  return { show: [], why, sourceRef: "test", ...partial } as StrategyNode;
}

function threeMaker(
  id: string,
  gameModes?: StrategyDef["gameModes"],
  withPost = true,
): StrategyDef {
  return {
    id,
    k: 3,
    version: "1.0.0",
    source: { paper: "none — test construction", stepMap: {} },
    entry: "entry",
    ...(gameModes !== undefined ? { gameModes } : {}),
    nodes: {
      entry: node({
        id: "entry",
        role: "maker-move",
        next: "await-b1",
        placeBind: "A1",
        move: { kind: "fixed", at: [{ kind: "const", x: int(0n), y: int(0n) }] },
      }),
      "await-b1": node({
        id: "await-b1",
        role: "classify-breaker",
        routes: [
          { case: "t:any1", when: { kind: "all" }, target: "m2", bind: { B1: { kind: "last" } } },
        ],
      }),
      m2: node({
        id: "m2",
        role: "maker-move",
        next: "await-b2",
        placeBind: "A2",
        move: { kind: "fixed", at: [{ kind: "const", x: int(10n), y: int(0n) }] },
      }),
      "await-b2": node({
        id: "await-b2",
        role: "classify-breaker",
        routes: [
          { case: "t:any2", when: { kind: "all" }, target: "m3", bind: { B2: { kind: "last" } } },
        ],
      }),
      m3: node({
        id: "m3",
        role: "maker-move",
        next: "win",
        placeBind: "A3",
        move: {
          kind: "fixed",
          at: [
            { kind: "const", x: int(5n), y: int(8n) },
            { kind: "const", x: int(6n), y: int(9n) },
          ],
        },
        ...(withPost ? { post: [{ kind: "exists-k-hole" as const, k: 3 }] } : {}),
      }),
      win: node({ id: "win", role: "terminal" }),
    },
  };
}

export const BI_DEF_ID = "test:three-maker-bi";
export const MONO_DEF_ID = "test:three-maker-mono";
export const BI_FIXTURE_ID = "test:fixture-triangle-bi";
// Same construction WITHOUT the m3 post-condition: the declared-win check at
// the terminal node is then the only guard against a false win.
export const BI_NOPOST_ID = "test:three-maker-bi-nopost";

export function ensureBichromaticDefs(): void {
  if (!strategies().has(BI_NOPOST_ID)) {
    registerStrategy(threeMaker(BI_NOPOST_ID, ["bichromatic"], false), "fixture");
  }
  if (!strategies().has(BI_DEF_ID)) {
    registerStrategy(threeMaker(BI_DEF_ID, ["bichromatic"]), "fixture");
  }
  if (!strategies().has(MONO_DEF_ID)) {
    registerStrategy(threeMaker(MONO_DEF_ID), "fixture");
  }
  if (!strategies().has(BI_FIXTURE_ID)) {
    // The shipped monochromatic fixture, re-labelled as bichromatic-capable:
    // its "any non-collinear A2 wins" claim is FALSE under the Maker-only
    // rule, so the engine must fail closed instead of declaring a win.
    registerStrategy(
      { ...fixtureTriangle, id: BI_FIXTURE_ID, gameModes: ["bichromatic"] },
      "fixture",
    );
  }
  if (!strategies().has("fixture-triangle")) {
    registerStrategy(fixtureTriangle, "fixture");
  }
}
