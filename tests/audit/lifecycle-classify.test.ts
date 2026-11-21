// tests/audit/lifecycle-classify.test.ts — independent audit of the
// classify-breaker lifecycle (§10.4/§10.8 v1.2.9). Spies wrap the REAL
// verification/pipeline (checkPre/checkPost) and strategy/runtime (classify)
// so every call, its arguments and its returned object are logged in call
// order; assertions are then made over the log. Evidence is written to
// AUDIT_EVIDENCE_DIR via node:fs.
import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GameState } from "../../src/game/types.ts";
import type { StrategyNode } from "../../src/strategy/types.ts";
import { stateHash } from "../../src/game/hash.ts";

interface Entry {
  fn: "classify:enter" | "classify:exit" | "checkPre" | "checkPost";
  nodeId?: string;
  role?: string;
  state?: GameState;
  result?: unknown;
}

const log = vi.hoisted((): Entry[] => []);

vi.mock("../../src/verification/pipeline.ts", async (importOriginal) => {
  const m =
    await importOriginal<typeof import("../../src/verification/pipeline.ts")>();
  return {
    ...m,
    checkPre: (state: GameState, node: StrategyNode, config: never) => {
      const result = m.checkPre(state, node, config);
      log.push({ fn: "checkPre", nodeId: node.id, role: node.role, state, result });
      return result;
    },
    checkPost: (state: GameState, node: StrategyNode, config: never) => {
      const result = m.checkPost(state, node, config);
      log.push({ fn: "checkPost", nodeId: node.id, role: node.role, state, result });
      return result;
    },
  };
});

vi.mock("../../src/strategy/runtime.ts", async (importOriginal) => {
  const m = await importOriginal<typeof import("../../src/strategy/runtime.ts")>();
  return {
    ...m,
    classify: (...args: Parameters<typeof m.classify>) => {
      log.push({ fn: "classify:enter", state: args[1], nodeId: args[2] });
      const result = m.classify(...args);
      log.push({ fn: "classify:exit", result });
      return result;
    },
  };
});

import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { registerChecker } from "../../src/verification/invariants.ts";
import type { CustomChecker } from "../../src/verification/invariants.ts";
import { registerStrategy, strategies } from "../../src/strategy/registry.ts";
import type { StrategyDef } from "../../src/strategy/types.ts";
import { ensureK5, playK5Game } from "../strategies/k5driver.ts";
import { ensureK6, playK6Game } from "../strategies/k6driver.ts";
import { mulberry32, testCtx } from "../helpers.ts";
import { P, evidence, replayDoc, REPLAY_DIR, guidedRequest } from "./audit-helpers.ts";

ensureK5();
ensureK6();

// ---- log segmentation: one segment per classify() call -------------------
interface Segment {
  entries: Entry[];
}

function segments(from = 0): Segment[] {
  const out: Segment[] = [];
  let cur: Segment | null = null;
  for (const e of log.slice(from)) {
    if (e.fn === "classify:enter") {
      cur = { entries: [] };
      out.push(cur);
    }
    cur?.entries.push(e);
  }
  return out;
}

function checkSegment(seg: Segment): {
  classifyPosts: number;
  pres: number;
  posts: number;
  verifCallsInsideClassify: number;
} {
  const es = seg.entries;
  const exitIdx = es.findIndex((e) => e.fn === "classify:exit");
  expect(exitIdx).toBe(1); // nothing at all between enter and exit
  const verifInside = es
    .slice(0, exitIdx)
    .filter((e) => e.fn === "checkPre" || e.fn === "checkPost").length;
  const classifyNodeId = es[0]?.nodeId as string;
  const exit = es[exitIdx] as Entry;
  const ok = (exit.result as { ok: boolean }).ok;
  const posts = es.filter((e) => e.fn === "checkPost");
  const pres = es.filter((e) => e.fn === "checkPre");
  const classifyPosts = posts.filter((e) => e.nodeId === classifyNodeId && e.role === "classify-breaker");
  if (ok) {
    // (3)(4): first verification call after routing = the classify node's
    // checkPost, on a transient state whose nodeId STILL names the node and
    // whose lastCase/bindings are already applied.
    const first = es[exitIdx + 1] as Entry;
    expect(first.fn).toBe("checkPost");
    expect(first.nodeId).toBe(classifyNodeId);
    const routed = exit.result as {
      ok: true;
      case: string;
      target: string;
      bindings: Record<string, unknown>;
    };
    expect(first.state?.strategy?.nodeId).toBe(classifyNodeId);
    expect(first.state?.strategy?.lastCase).toBe(routed.case);
    for (const [name, value] of Object.entries(routed.bindings)) {
      expect(first.state?.strategy?.vars[name]).toEqual(value);
    }
    // classify's own input state is NOT the transient (no hidden advance).
    expect(es[0]?.state?.strategy?.nodeId).toBe(classifyNodeId);
    expect(first.state).not.toBe(es[0]?.state); // a distinct transient value
  } else {
    expect(posts.length + pres.length).toBe(0);
  }
  // no duplicated verification inside one transaction
  const seen = new Set<string>();
  for (const e of [...pres, ...posts]) {
    const key = `${e.fn}|${e.nodeId}|${e.state?.points.length}|${e.state?.strategy?.lastCase}|${e.state?.strategy?.nodeId}`;
    expect(seen.has(key)).toBe(false);
    seen.add(key);
  }
  return {
    classifyPosts: classifyPosts.length,
    pres: pres.length,
    posts: posts.length,
    verifCallsInsideClassify: verifInside,
  };
}

describe("A. classify-breaker lifecycle — real k5/k6 games under spies", () => {
  it("k=5 random games (safe + blunder): classify routes only; exactly one classify-node checkPost per routed txn; no duplicates", () => {
    const rows: unknown[] = [];
    const rand = mulberry32(4242);
    for (const mode of ["safe", "blunder"] as const) {
      for (let g = 0; g < 8; g += 1) {
        const start = log.length;
        const res = playK5Game(rand, mode);
        expect(res.won).toBe(true);
        for (const seg of segments(start)) {
          const c = checkSegment(seg);
          expect(c.verifCallsInsideClassify).toBe(0);
          expect(c.classifyPosts).toBe(1);
          rows.push({ k: 5, mode, game: g, ...c });
        }
      }
    }
    evidence("lifecycle-k5-counts", rows);
    expect(rows.length).toBeGreaterThan(30);
  });

  it("k=6 random games: same invariants (computed steps included)", () => {
    const rows: unknown[] = [];
    const rand = mulberry32(777);
    for (const [b0, b1] of [
      ["forced", "random"],
      ["outside", "targeted"],
      ["ear", "random"],
    ] as const) {
      for (let g = 0; g < 4; g += 1) {
        const start = log.length;
        const res = playK6Game(rand, b0, b1);
        expect(res.won).toBe(true);
        for (const seg of segments(start)) {
          const c = checkSegment(seg);
          expect(c.verifCallsInsideClassify).toBe(0);
          expect(c.classifyPosts).toBe(1);
          rows.push({ k: 6, b0, b1, game: g, ...c });
        }
      }
    }
    evidence("lifecycle-k6-counts", rows);
    expect(rows.length).toBeGreaterThan(5);
  });

  it("event milestones: each event's stateHash/nodeAfter equals the first checkPre state after it (all 8 shipped replays driven through the engine)", () => {
    const files = readdirSync(REPLAY_DIR).filter((f) => f.endsWith(".replay.json"));
    const report: Record<string, unknown> = {};
    for (const name of files) {
      if (name === "k5-integrity.replay.json" || name === "sandbox-placed.replay.json") {
        continue; // test-only def / sandbox (no milestones)
      }
      const doc = replayDoc(name);
      const ctx = testCtx();
      const store = new Store();
      const strat = doc["strategy"] as { id: string };
      const start = startSession(
        {
          ...guidedRequest(ctx, strat.id),
          ...(doc["strategyStart"] !== null && doc["strategyStart"] !== undefined
            ? { strategyStart: parseStart(doc["strategyStart"]) }
            : {}),
        },
        ctx,
        store,
      );
      expect(start.status).toBe("accepted");
      let checkedEvents = 0;
      for (const t of (doc["transactions"] as Record<string, unknown>[]).slice(1)) {
        store.setCursor(t["parentTxnId"] as number);
        const action = parseAction(t["action"]);
        const from = log.length;
        const parent = store.current();
        const r = reduceTransaction(parent, action, ctx);
        expect(r.status).toBe("accepted");
        if (r.status !== "accepted" || r.nextState === undefined) {
          throw new Error("unreachable");
        }
        const seg = segments(from);
        expect(seg.length).toBeLessThanOrEqual(1);
        const pres = log.slice(from).filter((e) => e.fn === "checkPre");
        r.events.forEach((ev) => {
          if (ev.nodeAfter === null) {
            // terminal-first events: hash IS the final terminal state's hash.
            expect(ev.stateHash).toBe(stateHash(r.nextState as GameState));
            checkedEvents += 1;
            return;
          }
          const n = Number(ev.appliedPoint.slice(1));
          const pre = pres.find((e) => e.state?.points.length === n);
          if (pre !== undefined) {
            expect(pre.nodeId).toBe(ev.nodeAfter);
            expect(stateHash(pre.state as GameState)).toBe(ev.stateHash);
            checkedEvents += 1;
          } else {
            // Event terminated the txn (milestone state = pre-terminal state).
            const ns = r.nextState as GameState;
            const pre0: GameState = {
              ...ns,
              terminal: null,
              turn: ns.points.length % 2 === 0 ? "maker" : "breaker",
            };
            expect(stateHash(pre0)).toBe(ev.stateHash);
            checkedEvents += 1;
          }
        });
        commit(r, action, store, ctx);
      }
      report[name] = { events: checkedEvents };
    }
    evidence("lifecycle-event-milestones", report);
  });
});

// ---- synthetic defs: success and FAILURE of the classify node's post -------
const calls = { count: 0 };
const countPass: CustomChecker = {
  id: "audit:count-pass",
  describe: "counts, passes",
  check: () => {
    calls.count += 1;
    return { id: "audit:count-pass", kind: "invariant", passed: true, detail: `run ${calls.count}` };
  },
};
const countFail: CustomChecker = {
  id: "audit:count-fail",
  describe: "counts, fails",
  check: () => {
    calls.count += 1;
    return { id: "audit:count-fail", kind: "invariant", passed: false, detail: `decided false (run ${calls.count})` };
  },
};
registerChecker(countPass);
registerChecker(countFail);

function fixed(id: string, next: string, x: number, y: number, placeBind?: string): StrategyDef["nodes"][string] {
  return {
    id,
    role: "maker-move",
    next,
    ...(placeBind !== undefined ? { placeBind } : {}),
    move: { kind: "fixed", at: [{ kind: "const", x: P(x, y).x, y: P(x, y).y }] },
    show: [],
    why: { headline: "t", claims: [], sourceRef: "t" },
    sourceRef: "t",
  };
}

function def(id: string, checkerId: string): StrategyDef {
  const base = { show: [], why: { headline: "t", claims: [], sourceRef: "t" }, sourceRef: "t" } as const;
  return {
    id,
    k: 5,
    version: "0.0.0",
    source: { paper: "test", stepMap: {} },
    entry: "entry",
    nodes: {
      entry: fixed("entry", "C", 0, 0, "A1"),
      C: {
        id: "C",
        role: "classify-breaker",
        routes: [{ case: "t:any", when: { kind: "all" }, target: "M1", bind: { B1: { kind: "last" } } }],
        post: [{ kind: "custom", checkerId, args: {}, describe: "x" }],
        ...base,
      },
      M1: fixed("M1", "T", 50, 50),
      T: {
        id: "T",
        role: "classify-breaker",
        routes: [{ case: "t:halt", when: { kind: "all" }, target: "Tm" }],
        ...base,
      },
      Tm: fixed("Tm", "Tt", 999, 999),
      Tt: { id: "Tt", role: "terminal", ...base },
    },
  };
}

function ensure(d: StrategyDef): void {
  if (!strategies().has(d.id)) {
    registerStrategy(d, "experimental-extension");
  }
}

describe("A. classify post: success and failure (synthetic defs, real engine)", () => {
  function run(defId: string): {
    seg: Segment;
    r: ReturnType<typeof reduceTransaction>;
    store: Store;
  } {
    const ctx = testCtx();
    const store = new Store();
    const started = startSession(guidedRequest(ctx, defId), ctx, store);
    expect(started.status).toBe("accepted");
    calls.count = 0;
    const from = log.length;
    const r = reduceTransaction(store.current(), { kind: "place", owner: "breaker", at: P(10, 0) }, ctx);
    const segs = segments(from);
    expect(segs.length).toBe(1);
    return { seg: segs[0] as Segment, r, store };
  }

  it("SUCCESS: checker runs once; advance only after post; milestone = routed+verified state", () => {
    ensure(def("audit-pass", "audit:count-pass"));
    const { seg, r } = run("audit-pass");
    expect(calls.count).toBe(1);
    const c = checkSegment(seg);
    expect(c.classifyPosts).toBe(1);
    expect(c.verifCallsInsideClassify).toBe(0);
    if (r.status !== "accepted" || r.nextState === undefined) {
      throw new Error("unreachable");
    }
    expect(r.events[0]?.caseId).toBe("t:any");
    expect(r.events[0]?.nodeAfter).toBe("M1");
    // post (nodeId=C) strictly precedes the first pre on the target M1.
    const order = seg.entries.filter((e) => e.fn === "checkPost" || e.fn === "checkPre").map((e) => `${e.fn}:${e.nodeId}`);
    expect(order[0]).toBe("checkPost:C");
    expect(order[1]).toBe("checkPre:M1");
    evidence("lifecycle-success-order", order);
  });

  it("FAILURE: exactly one checker run, report consumed verbatim (same object), no advance, no further verification, failure milestone", () => {
    ensure(def("audit-fail", "audit:count-fail"));
    const { seg, r } = run("audit-fail");
    expect(calls.count).toBe(1); // (4)+(5): no second checker run to rebuild the report
    const post = seg.entries.filter((e) => e.fn === "checkPost");
    expect(post.length).toBe(1);
    expect(seg.entries.filter((e) => e.fn === "checkPre").length).toBe(0); // (6)
    const captured = post[0]?.result as { kind: "failed"; report: unknown };
    expect(captured.kind).toBe("failed");
    if (r.status !== "accepted" || r.nextState === undefined) {
      throw new Error("unreachable");
    }
    const t = r.nextState.terminal;
    expect(t?.kind).toBe("strategy-integrity-failure");
    if (t?.kind !== "strategy-integrity-failure") {
      throw new Error("unreachable");
    }
    expect(t.report).toBe(captured.report); // identity — verbatim consumption
    expect(t.report.phase).toBe("post");
    expect(t.report.failedAt).toBe("C");
    // no Maker reply was constructed (no advance to M1).
    expect(r.nextState.points.length).toBe(2);
    expect(r.events.length).toBe(1);
    expect(r.nextState.strategy?.nodeId).toBe("C");
    // Milestone: caseId recorded, nodeAfter = the classify node (control never
    // left), hash = the transient failure state WITHOUT the terminal.
    const ev = r.events[0];
    expect(ev?.caseId).toBe("t:any");
    expect(ev?.nodeAfter).toBe("C");
    const transient = post[0]?.state as GameState;
    expect(transient.terminal).toBe(null);
    expect(ev?.stateHash).toBe(stateHash(transient));
    expect(ev?.stateHash).not.toBe(stateHash(r.nextState));
    // The report's own stateHash is the transient state's hash too.
    expect(t.report.stateHash).toBe(stateHash(transient));
    evidence("lifecycle-failure", {
      checkerRuns: calls.count,
      verificationOrder: seg.entries.filter((e) => e.fn !== "classify:enter" && e.fn !== "classify:exit").map((e) => `${e.fn}:${e.nodeId}`),
      eventNodeAfter: ev?.nodeAfter,
      reportIdentical: t.report === captured.report,
    });
  });
});

describe("A. architecture facts (static)", () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
  it("strategy/ has no verification import and no checkPre/checkPost call; classify is the only router", () => {
    const dir = join(SRC, "strategy");
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".ts") ? [join(d, e.name)] : [],
      );
    for (const f of walk(dir)) {
      const text = readFileSync(f, "utf8");
      expect(text).not.toMatch(/checkPre|checkPost/);
      expect(text).not.toMatch(/from\s+["'][^"']*\/(verification|engine|session|ui|replay)\//);
    }
  });
  it("only engine/ calls checkPre/checkPost (init, orchestrator, describe)", () => {
    const hits: string[] = [];
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".ts") ? [join(d, e.name)] : [],
      );
    for (const f of walk(SRC)) {
      if (/(checkPre|checkPost)\(/.test(readFileSync(f, "utf8")) && !f.includes("verification")) {
        hits.push(f.slice(SRC.length + 1).replaceAll("\\", "/"));
      }
    }
    evidence("lifecycle-callsites", hits);
    expect(hits.sort()).toEqual(["engine/describe.ts", "engine/init.ts", "engine/orchestrator.ts"]);
  });
});

// ---- tiny parse helpers (replay JSON → engine inputs) --------------------
import { Rat } from "../../src/geometry/rat.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import type { StrategyStart, UserAction } from "../../src/game/types.ts";

function pj(v: unknown): Pt {
  const o = v as { x: string; y: string };
  return { x: Rat.fromString(o.x), y: Rat.fromString(o.y) };
}
function parseAction(a: unknown): UserAction {
  const o = a as { kind: string; owner?: "maker" | "breaker"; at: unknown; caseId?: string };
  return o.kind === "sample"
    ? ({ kind: "sample", caseId: o.caseId as string, at: pj(o.at) } as UserAction)
    : ({ kind: "place", owner: o.owner as "maker" | "breaker", at: pj(o.at) } as UserAction);
}
function parseStart(s: unknown): StrategyStart {
  const o = s as { kind: string; points: unknown[]; selectedHole: unknown[]; owners?: ("maker" | "breaker")[] };
  if (o.kind === "supplied") {
    return { kind: "supplied", points: o.points.map(pj), selectedHole: o.selectedHole.map(pj) } as StrategyStart;
  }
  return { kind: "continue", points: o.points.map(pj), owners: o.owners as ("maker" | "breaker")[], selectedHole: o.selectedHole.map(pj) } as StrategyStart;
}
