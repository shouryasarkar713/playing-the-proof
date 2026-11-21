// tests/audit/lifecycle-state.test.ts — transaction/state audit (item B):
// transient states never stored/serialized, metadata owned by session,
// immutability + structural sharing, determinism, no UI bypass.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stateHash } from "../../src/game/hash.ts";
import type { GameState } from "../../src/game/types.ts";
import {
  CommitGateError,
  committedStateAdmissible,
  reduceTransaction,
} from "../../src/engine/orchestrator.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { ensureK5, playK5Game } from "../strategies/k5driver.ts";
import { ensureK6 } from "../strategies/k6driver.ts";
import { mulberry32, testCtx } from "../helpers.ts";
import {
  P,
  evidence,
  exportText,
  guidedRequest,
  newSession,
  sandboxRequest,
  step,
} from "./audit-helpers.ts";

ensureK5();
ensureK6();

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

function walk(d: string): string[] {
  return readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".ts") ? [join(d, e.name)] : [],
  );
}

function deepIsFrozen(v: unknown, seen = new Set<unknown>()): boolean {
  if (typeof v !== "object" || v === null || seen.has(v)) {
    return true;
  }
  seen.add(v);
  if (!Object.isFrozen(v)) {
    return false;
  }
  return Object.values(v as Record<string, unknown>).every((x) => deepIsFrozen(x, seen));
}

describe("B. engine output carries no session metadata; states immutable; deterministic", () => {
  it("reduceTransaction events have no txnId/i/indexInTxn/parent; nextState.seq == input seq; result deep-frozen", () => {
    const ctx = testCtx();
    const { store } = newSession(guidedRequest(ctx, "esmb-k5"), ctx);
    const before = store.current();
    const r = reduceTransaction(before, { kind: "place", owner: "breaker", at: P(10, 0) }, ctx);
    expect(r.status).toBe("accepted");
    expect(r.events.length).toBeGreaterThanOrEqual(2);
    for (const e of r.events) {
      for (const forbidden of ["i", "txnId", "indexInTxn", "parent"]) {
        expect(forbidden in e).toBe(false);
      }
    }
    expect(r.nextState?.seq).toBe(before.seq);
    expect(deepIsFrozen(r)).toBe(true);
    // A different seq on the input only changes the hash through seq (no id allocated by engine).
    const before2: GameState = { ...before, seq: 41 };
    const r2 = reduceTransaction(before2, { kind: "place", owner: "breaker", at: P(10, 0) }, ctx);
    expect(r2.nextState?.seq).toBe(41);
  });

  it("input state is not mutated and reduction is deterministic (same inputs => same hashes, 30 random k5 games re-run)", () => {
    const rows: unknown[] = [];
    for (let g = 0; g < 10; g += 1) {
      const a = playK5Game(mulberry32(1000 + g), g % 2 === 0 ? "safe" : "blunder");
      const b = playK5Game(mulberry32(1000 + g), g % 2 === 0 ? "safe" : "blunder");
      expect(b).toEqual(a);
    }
    const ctx = testCtx();
    const { store } = newSession(guidedRequest(ctx, "esmb-k5"), ctx);
    const s0 = store.current();
    const h0 = stateHash(s0);
    const snapshot = JSON.stringify(s0, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
    const hashes: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const r = reduceTransaction(s0, { kind: "place", owner: "breaker", at: P(10, 0) }, ctx);
      hashes.push(stateHash(r.nextState as GameState));
      rows.push({ run: i, hash: hashes[i], events: r.events.map((e) => e.stateHash) });
    }
    expect(new Set(hashes).size).toBe(1);
    expect(stateHash(s0)).toBe(h0);
    expect(JSON.stringify(s0, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))).toBe(snapshot);
    evidence("state-determinism", rows);
  });

  it("hash is independent of vars insertion order and covers seq/mode/turn/terminal", () => {
    const ctx = testCtx();
    const { store } = newSession(guidedRequest(ctx, "esmb-k5"), ctx);
    const s = store.current();
    const rt = s.strategy as NonNullable<GameState["strategy"]>;
    const reversed: GameState = {
      ...s,
      strategy: { ...rt, vars: Object.fromEntries(Object.entries(rt.vars).reverse()) },
    };
    expect(stateHash(reversed)).toBe(stateHash(s));
    expect(stateHash({ ...s, seq: s.seq + 1 })).not.toBe(stateHash(s));
    expect(stateHash({ ...s, mode: "proof" })).not.toBe(stateHash(s));
  });

  it("structural sharing: placement reuses prior point records; store states/tree deep-frozen", () => {
    const ctx = testCtx();
    const { store } = newSession(sandboxRequest(ctx), ctx);
    step(store, ctx, { kind: "place", owner: "maker", at: P(1, 1) });
    const s1 = store.current();
    step(store, ctx, { kind: "place", owner: "breaker", at: P(5, 2) });
    const s2 = store.current();
    expect(s2.points[0]).toBe(s1.points[0]);
    expect(deepIsFrozen(s1)).toBe(true);
    expect(deepIsFrozen(s2)).toBe(true);
    expect(deepIsFrozen(store.tree())).toBe(true);
    expect(() => {
      (s2.points as unknown as unknown[]).push(1);
    }).toThrow();
  });
});

describe("B. transient reduction states never become stored/serialized/navigable", () => {
  it("every state in a stored k5 session passes the commit gate (parked at classify-breaker or terminal) and no replay carries vars", () => {
    const ctx = testCtx();
    const { store } = newSession(guidedRequest(ctx, "esmb-k5"), ctx);
    for (const at of [P(10, 0), P(7, 9), P(-30, -30)]) {
      step(store, ctx, { kind: "place", owner: "breaker", at });
    }
    const rows: unknown[] = [];
    for (const t of store.tree().transactions) {
      const st = store.stateAtTxn(t.txnId);
      const adm = committedStateAdmissible(st, ctx);
      expect(adm.ok).toBe(true);
      const nodeId = st.strategy?.nodeId;
      rows.push({ txn: t.txnId, nodeId, terminal: st.terminal?.kind ?? null, lastCase: st.strategy?.lastCase ?? null });
    }
    evidence("state-stored-nodes", rows);
    const text = exportText(store, ctx);
    expect(text).not.toContain('"vars"');
    expect(text).not.toContain('"lastCase"');
  });

  it("commit gate refuses a non-parked non-terminal state (transient shape) with CommitGateError", () => {
    const ctx = testCtx();
    const { store } = newSession(guidedRequest(ctx, "esmb-k5"), ctx);
    const r = reduceTransaction(store.current(), { kind: "place", owner: "breaker", at: P(10, 0) }, ctx);
    if (r.status !== "accepted" || r.nextState === undefined || r.nextState.strategy === null) {
      throw new Error("unreachable");
    }
    // Forge a leaked transient: move the runtime off the classify node.
    const forged: GameState = {
      ...r.nextState,
      strategy: { ...r.nextState.strategy, nodeId: "k5:r1:co-shoulder" },
    };
    expect(() => commit({ ...r, nextState: forged }, { kind: "place", owner: "breaker", at: P(10, 0) }, store, ctx)).toThrow(CommitGateError);
  });

  it("commit() owns txn ids/event ordinals/parents; engine+replay validator never allocate", () => {
    const hits: Record<string, string[]> = { nextTxnId: [], nextEventOrdinal: [], catchUpCounters: [] };
    for (const f of walk(SRC)) {
      const text = readFileSync(f, "utf8");
      const rel = f.slice(SRC.length + 1).replaceAll("\\", "/");
      for (const key of Object.keys(hits)) {
        if (text.includes(`${key}(`)) {
          (hits[key] as string[]).push(rel);
        }
      }
    }
    evidence("state-metadata-callsites", hits);
    expect(hits["nextTxnId"]?.sort()).toEqual(["session/commit.ts", "session/store.ts"]);
    expect(hits["nextEventOrdinal"]?.sort()).toEqual(["session/commit.ts", "session/store.ts"]);
    expect(hits["catchUpCounters"]?.sort()).toEqual(["session/store.ts", "ui/replay-io.ts"]);
    // engine never builds MoveEvent metadata
    for (const f of walk(join(SRC, "engine"))) {
      expect(readFileSync(f, "utf8")).not.toMatch(/indexInTxn\s*:/);
    }
  });

  it("navigation: undo/goto/branch never call the reducer (store version counters unchanged); sessions branch from any txn", () => {
    const ctx = testCtx();
    const { store } = newSession(sandboxRequest(ctx), ctx);
    step(store, ctx, { kind: "place", owner: "maker", at: P(1, 1) });
    step(store, ctx, { kind: "place", owner: "breaker", at: P(5, 2) });
    const n = store.tree().transactions.length;
    store.setCursor(1);
    expect(store.tree().transactions.length).toBe(n);
    step(store, ctx, { kind: "place", owner: "breaker", at: P(9, 3) });
    const t = store.tree().transactions;
    expect(t.length).toBe(n + 1);
    expect(t[t.length - 1]?.parentTxnId).toBe(1);
  });
});

describe("B. no UI path bypasses the engine for game transitions (static scan of src/ui)", () => {
  it("placePoint/withStrategy/withTerminal/withSeq/reduceTransaction/commit( only via ui/dispatch.ts; store.append only in ui/replay-io.ts", () => {
    const findings: Record<string, string[]> = {};
    const pats: Record<string, RegExp> = {
      placePoint: /\bplacePoint\b/,
      withStrategy: /\bwithStrategy\b/,
      withTerminal: /\bwithTerminal\b/,
      withSeq: /\bwithSeq\b/,
      reduceTransaction: /\breduceTransaction\b/,
      "commit(": /(?<![\w.])commit\(/,
      "store.append": /\.append\(txn|store\.append\(/,
      initSession: /\binitSession\b/,
      "points.push": /points\.push|points\[[^\]]+\]\s*=/,
    };
    for (const f of walk(join(SRC, "ui"))) {
      const text = readFileSync(f, "utf8").replace(/\/\/.*$/gm, "");
      const rel = f.slice(SRC.length + 1).replaceAll("\\", "/");
      for (const [name, re] of Object.entries(pats)) {
        if (re.test(text)) {
          (findings[name] ??= []).push(rel);
        }
      }
    }
    evidence("state-ui-bypass-scan", findings);
    expect(findings["placePoint"]).toBeUndefined();
    expect(findings["withStrategy"]).toBeUndefined();
    expect(findings["withTerminal"]).toBeUndefined();
    expect(findings["withSeq"]).toBeUndefined();
    expect(findings["points.push"]).toBeUndefined();
    expect(findings["initSession"]).toBeUndefined();
    expect(findings["reduceTransaction"]).toEqual(["ui/dispatch.ts"]);
    expect(findings["commit("]).toEqual(["ui/dispatch.ts"]);
    // The ONLY non-dispatch history writer (resume) — it bypasses the commit gate.
    expect(findings["store.append"]).toEqual(["ui/replay-io.ts"]);
  });

  it("startSession(init) is the only other state source; it is gate-checked", () => {
    const ctx = testCtx();
    const store = new Store();
    const r = startSession(sandboxRequest(ctx), ctx, store);
    expect(r.status).toBe("accepted");
    expect(r.txn?.events.length).toBe(0);
    expect(r.txn?.beforeHash).toBe(null);
  });
});
