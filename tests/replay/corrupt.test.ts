// tests/replay/corrupt.test.ts — structured rejection battery (§15.2,
// §27): every corruption class yields precise ValidationIssues with JSON
// paths — never a throw, never a console crash. Mutations start from the
// shipped k5-safe / k6-routeb samples so every fixture is a near-miss of a
// valid file.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { navigate } from "../../src/session/navigate.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import { stateHash } from "../../src/game/hash.ts";
import { P } from "../strategy/scaffolding.ts";
import { ensureK5 } from "../strategies/k5driver.ts";
import { ensureK6 } from "../strategies/k6driver.ts";
import { testCtx } from "../helpers.ts";
import { parseReplayFile, MAX_REPLAY_CHARS } from "../../src/replay/format.ts";
import { validateReplay } from "../../src/replay/validate.ts";

ensureK5();
ensureK6();

const DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "data",
  "replays",
);

function readSample(name: string): string {
  return readFileSync(join(DIR, name), "utf8");
}

function asObj(text: string): Record<string, unknown> {
  return JSON.parse(text) as Record<string, unknown>;
}

function txnsOf(doc: Record<string, unknown>): Record<string, unknown>[] {
  return doc["transactions"] as Record<string, unknown>[];
}

describe("corrupt files: parse-level rejections", () => {
  it("truncated JSON → not-json at root", () => {
    const text = readSample("k5-safe.replay.json").slice(0, 120);
    const r = parseReplayFile(text);
    expect(r.ok).toBe(false);
    if (r.ok) {
      throw new Error("unreachable");
    }
    expect(r.issues[0]?.code).toBe("not-json");
    expect(r.issues[0]?.path).toBe("");
  });

  it("payload over the 2 MB cap → too-large before any parse work (§30)", () => {
    // One char over the cap: rejected up front, with the typed issue —
    // never an exception, never a full JSON.parse of a hostile payload.
    const big = "x".repeat(MAX_REPLAY_CHARS + 1);
    const r = parseReplayFile(big);
    expect(r.ok).toBe(false);
    if (r.ok) {
      throw new Error("unreachable");
    }
    expect(r.issues.length).toBe(1);
    expect(r.issues[0]?.code).toBe("too-large");
    expect(r.issues[0]?.actual).toBe(`${MAX_REPLAY_CHARS + 1} characters`);
  });

  it("exactly at the 2 MB cap is NOT too-large (inclusive boundary)", () => {
    // At the cap the size gate passes and the payload proceeds to the
    // normal parse path (here: not-json) — the cap rejects only strictly
    // larger payloads.
    const atCap = "x".repeat(MAX_REPLAY_CHARS);
    const r = parseReplayFile(atCap);
    expect(r.ok).toBe(false);
    if (r.ok) {
      throw new Error("unreachable");
    }
    expect(r.issues[0]?.code).toBe("not-json");
  });

  it("wrong version → bad-version with operands", () => {
    const doc = asObj(readSample("k5-safe.replay.json"));
    doc["version"] = 5;
    const r = parseReplayFile(JSON.stringify(doc));
    expect(r.ok).toBe(false);
    if (r.ok) {
      throw new Error("unreachable");
    }
    const hit = r.issues.find((i) => i.code === "bad-version");
    expect(hit?.path).toBe("version");
    expect(hit?.expected).toBe("2 | 3 | 4");
  });

  it("non-canonical rational → bad-rational with a JSON path", () => {
    // "20/1" (the stored Maker response's x) rewritten non-canonically:
    // still parses numerically, but the canonical spelling check fails.
    const text = readSample("k5-safe.replay.json").replaceAll(
      '"20/1"',
      '"20/2"',
    );
    const r = parseReplayFile(text);
    expect(r.ok).toBe(false);
    if (r.ok) {
      throw new Error("unreachable");
    }
    const hit = r.issues.find((i) => i.code === "bad-rational");
    expect(hit?.path).toBe("transactions[1].events[1].at.x");
    expect(hit?.expected).toBe("10/1");
    expect(hit?.actual).toBe("20/2");
  });

  it("oversized bootstrap → bootstrap-too-large (§15.2 invariant-5 mirror)", () => {
    const doc = asObj(readSample("k6-routeb.replay.json"));
    const start = doc["strategyStart"] as Record<string, unknown>;
    const pts = start["points"] as unknown[];
    while (pts.length < 13) {
      pts.push({ x: `${100 + pts.length}/1`, y: `${200 + pts.length}/1` });
    }
    const r = parseReplayFile(JSON.stringify(doc));
    expect(r.ok).toBe(false);
    if (r.ok) {
      throw new Error("unreachable");
    }
    const hit = r.issues.find((i) => i.code === "bootstrap-too-large");
    expect(hit?.path).toBe("strategyStart.points");
  });

  it("child-before-parent order → bad-tree-shape", () => {
    const doc = asObj(readSample("k5-safe.replay.json"));
    const txns = txnsOf(doc);
    // Swap txn 1 and txn 2: txn 2's parent (txn 1) no longer precedes it.
    const tmp = txns[1];
    txns[1] = txns[2] as Record<string, unknown>;
    txns[2] = tmp as Record<string, unknown>;
    const r = parseReplayFile(JSON.stringify(doc));
    expect(r.ok).toBe(false);
    if (r.ok) {
      throw new Error("unreachable");
    }
    const hit = r.issues.find((i) => i.code === "bad-tree-shape");
    expect(hit?.path).toBe("transactions[1].parentTxnId");
  });

  it("cursor pointing at an uncommitted txn → bad-tree-shape", () => {
    const doc = asObj(readSample("k5-safe.replay.json"));
    doc["cursorTxnId"] = 99;
    const r = parseReplayFile(JSON.stringify(doc));
    expect(r.ok).toBe(false);
    if (r.ok) {
      throw new Error("unreachable");
    }
    const hit = r.issues.find((i) => i.code === "bad-tree-shape");
    expect(hit?.path).toBe("cursorTxnId");
  });

  it("strategy version drift → version-mismatch (§26D, no reinterpretation)", () => {
    const doc = asObj(readSample("k5-safe.replay.json"));
    doc["strategyVersion"] = "9.9.9";
    const parsed = parseReplayFile(JSON.stringify(doc));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    const v = validateReplay(parsed.file, testCtx());
    expect(v.ok).toBe(false);
    if (v.ok) {
      throw new Error("unreachable");
    }
    expect(v.issues[0]?.code).toBe("version-mismatch");
    expect(v.issues[0]?.path).toBe("strategyVersion");
  });

  it("strategy/mode/k/start coupling violations → bad-strategy-coupling", () => {
    // strategy null with a guided mode.
    const a = asObj(readSample("k5-safe.replay.json"));
    a["strategy"] = null;
    const ra = parseReplayFile(JSON.stringify(a));
    expect(ra.ok).toBe(true);
    if (!ra.ok) {
      throw new Error("unreachable");
    }
    const va = validateReplay(ra.file, testCtx());
    expect(va.ok).toBe(false);
    if (va.ok) {
      throw new Error("unreachable");
    }
    expect(va.issues[0]?.code).toBe("bad-strategy-coupling");
    // config.k divorced from the def.
    const b = asObj(readSample("k5-safe.replay.json"));
    (b["config"] as Record<string, unknown>)["k"] = 6;
    const rb = parseReplayFile(JSON.stringify(b));
    expect(rb.ok).toBe(true);
    if (!rb.ok) {
      throw new Error("unreachable");
    }
    const vb = validateReplay(rb.file, testCtx());
    expect(vb.ok).toBe(false);
    if (vb.ok) {
      throw new Error("unreachable");
    }
    expect(vb.issues[0]?.code).toBe("bad-strategy-coupling");
    expect(vb.issues[0]?.path).toBe("config.k");
    // strategyStart injected on a maker-move entry def.
    const c = asObj(readSample("k5-safe.replay.json"));
    c["strategyStart"] = {
      kind: "supplied",
      points: [{ x: "0/1", y: "0/1" }],
      selectedHole: [{ x: "0/1", y: "0/1" }],
    };
    const rc = parseReplayFile(JSON.stringify(c));
    expect(rc.ok).toBe(true);
    if (!rc.ok) {
      throw new Error("unreachable");
    }
    const vc = validateReplay(rc.file, testCtx());
    expect(vc.ok).toBe(false);
    if (vc.ok) {
      throw new Error("unreachable");
    }
    expect(vc.issues[0]?.code).toBe("bad-strategy-coupling");
    // strategyStart dropped on a classify-breaker entry def.
    const d = asObj(readSample("k6-routeb.replay.json"));
    d["strategyStart"] = null;
    const rd = parseReplayFile(JSON.stringify(d));
    expect(rd.ok).toBe(true);
    if (!rd.ok) {
      throw new Error("unreachable");
    }
    const vd = validateReplay(rd.file, testCtx());
    expect(vd.ok).toBe(false);
    if (vd.ok) {
      throw new Error("unreachable");
    }
    expect(vd.issues[0]?.code).toBe("bad-strategy-coupling");
  });
});

describe("corrupt files: fold-level rejections", () => {
  it("illegal move → semantic-divergence (re-reduction rejects)", () => {
    const doc = asObj(readSample("k5-safe.replay.json"));
    // B1 onto A1's coordinates: coincides — the reducer rejects.
    (
      (txnsOf(doc)[1] as Record<string, unknown>)["action"] as Record<
        string,
        unknown
      >
    )["at"] = {
      x: "0/1",
      y: "0/1",
    };
    const parsed = parseReplayFile(JSON.stringify(doc));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    const v = validateReplay(parsed.file, testCtx());
    expect(v.ok).toBe(false);
    if (v.ok) {
      throw new Error("unreachable");
    }
    expect(v.issues[0]?.code).toBe("semantic-divergence");
    expect(v.issues[0]?.path).toBe("transactions[1]");
  });

  it("hash mismatch on the terminal txn → hash-mismatch", () => {
    const doc = asObj(readSample("k5-safe.replay.json"));
    const txns = txnsOf(doc);
    const last = txns[txns.length - 1] as Record<string, unknown>;
    const h = last["afterHash"] as string;
    last["afterHash"] = `${h.slice(0, -1)}${h.endsWith("0") ? "1" : "0"}`;
    const parsed = parseReplayFile(JSON.stringify(doc));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    const v = validateReplay(parsed.file, testCtx());
    expect(v.ok).toBe(false);
    if (v.ok) {
      throw new Error("unreachable");
    }
    expect(v.issues[0]?.code).toBe("hash-mismatch");
    expect(v.issues[0]?.path).toBe(
      `transactions[${txns.length - 1}].afterHash`,
    );
  });

  it("doctored automatic-Maker event → semantic-divergence (double-application guard)", () => {
    const doc = asObj(readSample("k5-safe.replay.json"));
    // The stored Maker response (A2) is moved; the Breaker action is
    // untouched, so the fold regenerates the true A2 and the comparison —
    // never a re-application — rejects the file.
    const evs = (txnsOf(doc)[1] as Record<string, unknown>)["events"] as Record<
      string,
      unknown
    >[];
    ((evs[1] as Record<string, unknown>)["at"] as Record<string, unknown>)[
      "x"
    ] = "21/1";
    const parsed = parseReplayFile(JSON.stringify(doc));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    const v = validateReplay(parsed.file, testCtx());
    expect(v.ok).toBe(false);
    if (v.ok) {
      throw new Error("unreachable");
    }
    expect(v.issues[0]?.code).toBe("semantic-divergence");
    expect(v.issues[0]?.path).toBe("transactions[1].events[1]");
  });

  it("unfinalized afterHash → hash-mismatch (proves §5.5 re-finalization)", () => {
    // Re-drive the final transaction live and keep the UNFINALIZED state
    // (seq = parent id): its hash can only match the stored one if the
    // fold skipped withSeq — it must not.
    const ctx = testCtx();
    const store = new Store();
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
    if (started.status !== "accepted") {
      throw new Error("unreachable");
    }
    const ats = [P(10, 0), pt(Rat.make(10n), Rat.make(9n)), P(-30, -30)];
    let lastUnfinalized = "";
    for (const at of ats) {
      const r = reduceTransaction(
        store.current(),
        { kind: "place", owner: "breaker", at },
        ctx,
      );
      if (r.status !== "accepted" || r.nextState === undefined) {
        throw new Error("unreachable");
      }
      lastUnfinalized = stateHash(r.nextState);
      commit(r, { kind: "place", owner: "breaker", at }, store, ctx);
    }
    const doc = asObj(readSample("k5-safe.replay.json"));
    const txns = txnsOf(doc);
    (txns[txns.length - 1] as Record<string, unknown>)["afterHash"] =
      lastUnfinalized;
    const parsed = parseReplayFile(JSON.stringify(doc));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    const v = validateReplay(parsed.file, testCtx());
    expect(v.ok).toBe(false);
    if (v.ok) {
      throw new Error("unreachable");
    }
    expect(v.issues[0]?.code).toBe("hash-mismatch");
    expect(v.issues[0]?.path).toBe(
      `transactions[${txns.length - 1}].afterHash`,
    );
  });
});

describe("navigation emits no events", () => {
  it("goto/undo/branch move only the cursor", () => {
    const ctx = testCtx();
    const store = new Store();
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
    if (started.status !== "accepted") {
      throw new Error("unreachable");
    }
    for (const at of [P(10, 0), P(30, 5)]) {
      const r = reduceTransaction(
        store.current(),
        { kind: "place", owner: "breaker", at },
        ctx,
      );
      if (r.status !== "accepted") {
        throw new Error("unreachable");
      }
      commit(r, { kind: "place", owner: "breaker", at }, store, ctx);
    }
    const before = store.tree();
    navigate(store, { kind: "goto", txnId: 0 });
    navigate(store, { kind: "goto", txnId: 1 });
    navigate(store, { kind: "undo" });
    navigate(store, { kind: "branch", atTxnId: 1 });
    const after = store.tree();
    expect(after.events).toEqual(before.events);
    expect(after.transactions).toEqual(before.transactions);
  });
});
