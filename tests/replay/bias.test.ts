// tests/replay/bias.test.ts — replay format v4 (bias): round-trip, tamper
// resistance, version gating, migration. Unbiased sessions keep v2/v3 bytes.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import type { RuntimeCtx } from "../../src/engine/orchestrator.ts";
import { assembleReplayFile } from "../../src/engine/replay.ts";
import { parseReplayFile, serializeReplay } from "../../src/replay/format.ts";
import {
  downgradeReplayToV2,
  migrateReplayToV3,
  migrateReplayToV4,
} from "../../src/replay/migrate.ts";
import { validateReplay } from "../../src/replay/validate.ts";
import { stateHash } from "../../src/game/hash.ts";
import { turnSequence } from "../../src/game/turnorder.ts";
import type { Player } from "../../src/game/types.ts";
import { ensureK5 } from "../strategies/k5driver.ts";
import { ensureK6 } from "../strategies/k6driver.ts";
import { testCtx } from "../helpers.ts";

ensureK5();
ensureK6();

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "replays");
const META = { createdAt: "2026-11-22T00:00:00.000Z", app: "t", appVersion: "0.0.0" };
const R = (n: number, d = 1): Rat => Rat.make(BigInt(n), BigInt(d));
const pts = (i: number): [number, number] => [i * 3 + 1, i * i + 2];

function play(store: Store, ctx: RuntimeCtx, owner: Player, i: number): void {
  const at = pt(Rat.make(BigInt(pts(i)[0])), Rat.make(BigInt(pts(i)[1])));
  const action = { kind: "place" as const, owner, at };
  const r = reduceTransaction(store.current(), action, ctx);
  if (r.status !== "accepted") {
    throw new Error("rejected");
  }
  commit(r, action, store, ctx);
}

function session(bias: Rat | undefined, bi: boolean, n = 8): string {
  const store = new Store();
  const ctx = testCtx(1000);
  startSession(
    {
      kind: "sandbox",
      config: {
        mode: "sandbox",
        window: ctx.config.window,
        ...(bi ? { gameMode: "bichromatic" as const } : {}),
        ...(bias !== undefined ? { bias } : {}),
      },
      k: 8,
    },
    ctx,
    store,
  );
  const seq = bias === undefined ? Array.from({ length: n }, (_, i) => (i % 2 === 0 ? "maker" : "breaker") as Player) : turnSequence(bias, n);
  seq.forEach((o, i) => play(store, ctx, o, i));
  const st = store.current();
  const file = assembleReplayFile(
    store.tree(),
    store.cursorTxnId(),
    {
      k: st.k,
      mode: st.mode,
      ...(bi ? { gameMode: "bichromatic" as const } : {}),
      ...(bias !== undefined ? { bias } : {}),
      window: ctx.config.window,
      strategyId: null,
      strategyStart: null,
      meta: META,
      engineVersion: "0.0.0",
    },
    ctx,
  );
  return serializeReplay(file);
}

function mutate(text: string, f: (doc: Record<string, unknown>) => void): string {
  const doc = JSON.parse(text) as Record<string, unknown>;
  f(doc);
  return JSON.stringify(doc);
}

const cfgOf = (text: string): Record<string, unknown> =>
  (JSON.parse(text) as { config: Record<string, unknown> }).config;

describe("writer chooses the lowest expressive version", () => {
  it("unbiased monochromatic stays v2, unbiased bichromatic stays v3 (keys unchanged)", () => {
    const v2 = session(undefined, false);
    expect((JSON.parse(v2) as { version: number }).version).toBe(2);
    expect(Object.keys(cfgOf(v2))).toEqual(["k", "mode", "window"]);
    const v3 = session(undefined, true);
    expect((JSON.parse(v3) as { version: number }).version).toBe(3);
    expect(Object.keys(cfgOf(v3))).toEqual(["k", "mode", "gameMode", "window"]);
  });
  it("an explicit 1:1 bias is still written as v2 (absence)", () => {
    const text = session(R(1), false);
    expect((JSON.parse(text) as { version: number }).version).toBe(2);
    expect(text).toBe(session(undefined, false));
  });
  it("any other bias writes v4 with gameMode and bias", () => {
    const text = session(R(5, 2), false);
    const doc = JSON.parse(text) as { version: number };
    expect(doc.version).toBe(4);
    expect(Object.keys(cfgOf(text))).toEqual(["k", "mode", "gameMode", "bias", "window"]);
    expect(cfgOf(text)["gameMode"]).toBe("monochromatic");
    expect(cfgOf(text)["bias"]).toBe("5/2");
    expect(cfgOf(session(R(2), true))["gameMode"]).toBe("bichromatic");
  });
});

describe("v4 round trip and fold", () => {
  for (const [label, bias, bi] of [
    ["s = 2", R(2), false],
    ["s = 3/2", R(3, 2), false],
    ["s = 1/2", R(1, 2), false],
    ["s = 0", R(0), false],
    ["s = 12", R(12), false],
    ["s = 5/2 bichromatic", R(5, 2), true],
  ] as const) {
    it(`${label}: byte round trip, re-validates, states carry the bias`, () => {
      const text = session(bias, bi, 9);
      const parsed = parseReplayFile(text);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) {
        return;
      }
      expect(serializeReplay(parsed.file)).toBe(text);
      const v = validateReplay(parsed.file, testCtx(1000));
      expect(v.ok).toBe(true);
      if (v.ok) {
        for (const st of v.states.values()) {
          expect(st.bias?.equals(bias)).toBe(true);
        }
      }
    });
  }
});

describe("tamper resistance", () => {
  const base = session(R(2), false);
  const folds = (text: string): boolean => {
    const p = parseReplayFile(text);
    return p.ok && validateReplay(p.file, testCtx(1000)).ok;
  };
  it("the untouched file folds", () => {
    expect(folds(base)).toBe(true);
  });
  it("changing the bias breaks the fold (owners/hashes no longer match)", () => {
    for (const b of ["3/1", "1/1", "5/2", "1/2", "0/1"]) {
      const t = mutate(base, (d) => {
        (d["config"] as Record<string, unknown>)["bias"] = b;
      });
      expect(folds(t), b).toBe(false);
    }
  });
  it("flipping an event owner breaks the fold", () => {
    const t = mutate(base, (d) => {
      const txns = d["transactions"] as Array<{ events: Array<{ owner: string }>; action: { owner?: string } }>;
      const x = txns[2] as (typeof txns)[number];
      x.action.owner = x.action.owner === "maker" ? "breaker" : "maker";
      (x.events[0] as { owner: string }).owner = x.action.owner as string;
    });
    expect(folds(t)).toBe(false);
  });
  it("dropping the rule to monochromatic-unbiased v2 breaks the fold", () => {
    const t = mutate(base, (d) => {
      d["version"] = 2;
      delete (d["config"] as Record<string, unknown>)["bias"];
      delete (d["config"] as Record<string, unknown>)["gameMode"];
    });
    expect(folds(t)).toBe(false);
  });
});

describe("version gating", () => {
  it("v4 requires a canonical in-range bias and a gameMode", () => {
    const base = session(R(2), false);
    for (const bad of ["2", "4/2", "-1/2", "65/1", "1/1001", "x", 2, null]) {
      const t = mutate(base, (d) => {
        (d["config"] as Record<string, unknown>)["bias"] = bad;
      });
      const r = parseReplayFile(t);
      expect(r.ok, String(bad)).toBe(false);
      if (!r.ok) {
        expect(r.issues.some((i) => i.path === "config.bias")).toBe(true);
      }
    }
    const missing = mutate(base, (d) => {
      delete (d["config"] as Record<string, unknown>)["bias"];
    });
    expect(parseReplayFile(missing).ok).toBe(false);
    const noMode = mutate(base, (d) => {
      delete (d["config"] as Record<string, unknown>)["gameMode"];
    });
    expect(parseReplayFile(noMode).ok).toBe(false);
  });
  it("v2 and v3 forbid bias", () => {
    for (const [v, text] of [
      [2, session(undefined, false)],
      [3, session(undefined, true)],
    ] as const) {
      const t = mutate(text, (d) => {
        (d["config"] as Record<string, unknown>)["bias"] = "2/1";
      });
      const r = parseReplayFile(t);
      expect(r.ok, `v${v}`).toBe(false);
      if (!r.ok) {
        expect(r.issues.some((i) => i.path === "config.bias" && i.code === "bad-version")).toBe(true);
      }
    }
  });
  it("unknown versions are rejected", () => {
    for (const v of [0, 1, 5, "4"]) {
      const t = mutate(session(R(2), false), (d) => {
        d["version"] = v;
      });
      const r = parseReplayFile(t);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.issues.some((i) => i.code === "bad-version")).toBe(true);
      }
    }
  });
});

describe("migration", () => {
  const names = readdirSync(DIR).filter((f) => f.endsWith(".replay.json")).sort();
  for (const name of names) {
    it(`${name}: v2 -> v4 -> back is byte-identical with unchanged state hashes`, () => {
      if (name === "k5-integrity.replay.json") {
        return; // needs a test-only def; covered by roundtrip.test.ts
      }
      const text = readFileSync(join(DIR, name), "utf8");
      const parsed = parseReplayFile(text);
      if (!parsed.ok) {
        throw new Error("parse");
      }
      const v4 = migrateReplayToV4(parsed.file);
      expect(v4.version).toBe(4);
      expect(v4.config.bias?.toString()).toBe("1/1");
      const reparsed = parseReplayFile(serializeReplay(v4));
      expect(reparsed.ok).toBe(true);
      if (!reparsed.ok) {
        return;
      }
      const a = validateReplay(parsed.file, testCtx());
      const b = validateReplay(reparsed.file, testCtx());
      expect(a.ok && b.ok).toBe(true);
      if (a.ok && b.ok) {
        expect([...b.states.values()].map(stateHash)).toEqual([...a.states.values()].map(stateHash));
      }
      const back = downgradeReplayToV2(reparsed.file);
      expect(back === null ? "" : serializeReplay(back)).toBe(text);
    });
  }

  it("biased sessions cannot be downgraded; unit v4 downgrades to v3 and v2", () => {
    const biased = parseReplayFile(session(R(2), false));
    if (!biased.ok) {
      throw new Error("parse");
    }
    expect(downgradeReplayToV2(biased.file)).toBeNull();
    expect(() => migrateReplayToV3(biased.file)).toThrow();
    const mono = parseReplayFile(session(undefined, false));
    if (!mono.ok) {
      throw new Error("parse");
    }
    const u4 = migrateReplayToV4(mono.file);
    expect(migrateReplayToV4(u4)).toBe(u4);
    const v3 = migrateReplayToV3(u4);
    expect(v3.version).toBe(3);
    expect(v3.config.gameMode).toBe("monochromatic");
    expect(v3.config.bias).toBeUndefined();
    const bi = parseReplayFile(session(undefined, true));
    if (!bi.ok) {
      throw new Error("parse");
    }
    const bi4 = migrateReplayToV4(bi.file);
    expect(bi4.config.gameMode).toBe("bichromatic");
    expect(downgradeReplayToV2(bi4)).toBeNull();
    expect(migrateReplayToV3(bi4).config.gameMode).toBe("bichromatic");
  });
});
