// tests/replay/bichromatic.test.ts — replay format v3 (game mode), fail-closed
// version handling, v2<->v3 migration, bichromatic replay integrity.
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
import { downgradeReplayToV2, migrateReplayToV3 } from "../../src/replay/migrate.ts";
import { validateReplay } from "../../src/replay/validate.ts";
import { stateHash } from "../../src/game/hash.ts";
import { ensureK5 } from "../strategies/k5driver.ts";
import { ensureK6 } from "../strategies/k6driver.ts";
import { testCtx } from "../helpers.ts";
import { BI_DEF_ID, MONO_DEF_ID, ensureBichromaticDefs } from "../engine/bichromatic-defs.ts";

ensureK5();
ensureK6();
ensureBichromaticDefs();

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "replays");
const META = { createdAt: "2026-11-21T00:00:00.000Z", app: "t", appVersion: "0.0.0" };

function P(x: number, y: number) {
  return pt(Rat.make(BigInt(x)), Rat.make(BigInt(y)));
}

function play(store: Store, ctx: RuntimeCtx, owner: "maker" | "breaker", x: number, y: number): void {
  const action = { kind: "place" as const, owner, at: P(x, y) };
  const r = reduceTransaction(store.current(), action, ctx);
  if (r.status !== "accepted") {
    throw new Error("rejected");
  }
  commit(r, action, store, ctx);
}

function sandboxReplay(bichromatic: boolean): string {
  const store = new Store();
  const ctx = testCtx();
  startSession(
    {
      kind: "sandbox",
      config: {
        mode: "sandbox",
        window: ctx.config.window,
        ...(bichromatic ? { gameMode: "bichromatic" as const } : {}),
      },
      k: 3,
    },
    ctx,
    store,
  );
  play(store, ctx, "maker", 0, 0);
  play(store, ctx, "breaker", 5, 3);
  play(store, ctx, "maker", 10, 0);
  play(store, ctx, "breaker", 30, 40);
  play(store, ctx, "maker", 5, 10);
  const st = store.current();
  const file = assembleReplayFile(
    store.tree(),
    store.cursorTxnId(),
    {
      k: st.k,
      mode: st.mode,
      ...(bichromatic ? { gameMode: "bichromatic" as const } : {}),
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

function guidedReplay(id: string, bichromatic: boolean): string {
  const store = new Store();
  const ctx = testCtx();
  const started = startSession(
    {
      kind: "guided",
      config: {
        mode: "break",
        window: ctx.config.window,
        ...(bichromatic ? { gameMode: "bichromatic" as const } : {}),
      },
      strategyId: id,
      mode: "break",
    },
    ctx,
    store,
  );
  expect(started.status).toBe("accepted");
  play(store, ctx, "breaker", -20, 30);
  if (bichromatic) {
    play(store, ctx, "breaker", 40, -31);
  }
  const st = store.current();
  const file = assembleReplayFile(
    store.tree(),
    store.cursorTxnId(),
    {
      k: st.k,
      mode: st.mode,
      ...(bichromatic ? { gameMode: "bichromatic" as const } : {}),
      window: ctx.config.window,
      strategyId: id,
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

describe("format v3", () => {
  it("monochromatic sessions are still written as v2 with no gameMode key", () => {
    const text = sandboxReplay(false);
    const doc = JSON.parse(text) as { version: number; config: Record<string, unknown> };
    expect(doc.version).toBe(2);
    expect(Object.keys(doc.config)).toEqual(["k", "mode", "window"]);
  });

  it("bichromatic sandbox session: v3, round-trips byte-exactly, re-validates", () => {
    const text = sandboxReplay(true);
    const doc = JSON.parse(text) as { version: number; config: { gameMode: string } };
    expect(doc.version).toBe(3);
    expect(doc.config.gameMode).toBe("bichromatic");
    const parsed = parseReplayFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(serializeReplay(parsed.file)).toBe(text);
    const v = validateReplay(parsed.file, testCtx());
    expect(v.ok).toBe(true);
    if (v.ok) {
      for (const st of v.states.values()) {
        expect(st.gameMode).toBe("bichromatic");
      }
    }
  });

  it("the same moves under the two rules fold to different state hashes", () => {
    const b = parseReplayFile(sandboxReplay(true));
    const m = parseReplayFile(sandboxReplay(false));
    if (!b.ok || !m.ok) {
      throw new Error("parse");
    }
    const vb = validateReplay(b.file, testCtx());
    const vm = validateReplay(m.file, testCtx());
    if (!vb.ok || !vm.ok) {
      throw new Error("validate");
    }
    const hb = [...vb.states.values()].map(stateHash).at(-1);
    const hm = [...vm.states.values()].map(stateHash).at(-1);
    expect(hb).not.toBe(hm);
  });

  it("rewriting a bichromatic file as monochromatic is caught by the hash chain", () => {
    const text = mutate(sandboxReplay(true), (d) => {
      (d["config"] as Record<string, unknown>)["gameMode"] = "monochromatic";
    });
    const parsed = parseReplayFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const v = validateReplay(parsed.file, testCtx());
    expect(v.ok).toBe(false);
  });

  it("rewriting a monochromatic v2 file as bichromatic v3 is caught by the hash chain", () => {
    const text = mutate(sandboxReplay(false), (d) => {
      d["version"] = 3;
      (d["config"] as Record<string, unknown>)["gameMode"] = "bichromatic";
    });
    const parsed = parseReplayFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(validateReplay(parsed.file, testCtx()).ok).toBe(false);
  });

  it("v2 forbids gameMode; v3 requires a valid one; other versions are rejected", () => {
    const v2 = mutate(sandboxReplay(false), (d) => {
      (d["config"] as Record<string, unknown>)["gameMode"] = "bichromatic";
    });
    const r2 = parseReplayFile(v2);
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.issues.some((i) => i.path === "config.gameMode" && i.code === "bad-version")).toBe(true);
    }
    const v3missing = mutate(sandboxReplay(true), (d) => {
      delete (d["config"] as Record<string, unknown>)["gameMode"];
    });
    expect(parseReplayFile(v3missing).ok).toBe(false);
    const v3bad = mutate(sandboxReplay(true), (d) => {
      (d["config"] as Record<string, unknown>)["gameMode"] = "tri";
    });
    expect(parseReplayFile(v3bad).ok).toBe(false);
    for (const bad of [1, 4, "3", null]) {
      const t = mutate(sandboxReplay(true), (d) => {
        d["version"] = bad;
      });
      const r = parseReplayFile(t);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.issues.some((i) => i.code === "bad-version")).toBe(true);
      }
    }
  });

  it("guided bichromatic replay (declared def) round-trips and re-validates, terminal included", () => {
    const text = guidedReplay(BI_DEF_ID, true);
    const parsed = parseReplayFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(serializeReplay(parsed.file)).toBe(text);
    const v = validateReplay(parsed.file, testCtx());
    expect(v.ok).toBe(true);
    if (v.ok) {
      const last = [...v.states.values()].at(-1);
      expect(last?.terminal?.kind).toBe("maker-won");
    }
  });

  it("a bichromatic file naming a monochromatic-only def is refused by the fold", () => {
    const text = mutate(guidedReplay(MONO_DEF_ID, false), (d) => {
      d["version"] = 3;
      (d["config"] as Record<string, unknown>)["gameMode"] = "bichromatic";
    });
    const parsed = parseReplayFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const v = validateReplay(parsed.file, testCtx());
    expect(v.ok).toBe(false);
  });

  it("a tampered bichromatic witness (Breaker vertex) is rejected by the fold", () => {
    const text = mutate(guidedReplay(BI_DEF_ID, true), (d) => {
      const txns = d["transactions"] as Array<{ result: { kind: string; terminal?: { witness: Array<{ verts: string[] }> } } }>;
      const t = txns.find((x) => x.result.kind === "terminal");
      if (t?.result.terminal === undefined) {
        throw new Error("no terminal");
      }
      t.result.terminal.witness[0]!.verts = ["p1", "p2", "p3"];
    });
    const parsed = parseReplayFile(text);
    if (!parsed.ok) {
      return; // rejected at parse: also fine
    }
    expect(validateReplay(parsed.file, testCtx()).ok).toBe(false);
  });
});

describe("v2 <-> v3 migration", () => {
  const names = readdirSync(DIR).filter((f) => f.endsWith(".replay.json")).sort();
  it("corpus is non-empty", () => {
    expect(names.length).toBeGreaterThan(0);
  });
  for (const name of names) {
    it(`migrates ${name} to v3 and back byte-identically with unchanged hashes`, () => {
      if (name === "k5-integrity.replay.json") {
        return; // needs a test-only def; round-trip covered in roundtrip.test.ts
      }
      const text = readFileSync(join(DIR, name), "utf8");
      const parsed = parseReplayFile(text);
      if (!parsed.ok) {
        throw new Error("parse");
      }
      const v3 = migrateReplayToV3(parsed.file);
      expect(v3.version).toBe(3);
      expect(v3.config.gameMode).toBe("monochromatic");
      const v3text = serializeReplay(v3);
      const reparsed = parseReplayFile(v3text);
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

  it("migration is idempotent; bichromatic cannot be downgraded", () => {
    const bi = parseReplayFile(sandboxReplay(true));
    const mo = parseReplayFile(sandboxReplay(false));
    if (!bi.ok || !mo.ok) {
      throw new Error("parse");
    }
    expect(migrateReplayToV3(bi.file)).toBe(bi.file);
    expect(downgradeReplayToV2(bi.file)).toBeNull();
    expect(downgradeReplayToV2(mo.file)).toBe(mo.file);
    const once = migrateReplayToV3(mo.file);
    expect(migrateReplayToV3(once)).toBe(once);
  });
});
