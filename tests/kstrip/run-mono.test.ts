import { describe, expect, it } from "vitest";
import {
  createGreedyBlockingPolicy,
  createRandomLegalPolicy,
  createStrategyAwarePolicy,
  runKStrip,
} from "../../src/kstrip/index.ts";

describe("runKStrip mono 1:1", () => {
  for (const [name, mk] of [
    ["random", () => createRandomLegalPolicy(1)],
    ["greedy", () => createGreedyBlockingPolicy()],
    ["aware", () => createStrategyAwarePolicy()],
  ] as const) {
    for (const k of [2, 3, 4]) {
      it(`${name} k=${k} t=1`, () => {
        const r = runKStrip(k, 1, mk());
        expect(r.message).toBe("goal met; every claimed strip re-verified exactly");
        expect(r.status).toBe("completed");
        expect(r.claims.length).toBeGreaterThanOrEqual(1);
      });
    }
  }
});
