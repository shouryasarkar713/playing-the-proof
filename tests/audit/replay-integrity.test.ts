// @vitest-environment jsdom
// tests/audit/replay-integrity.test.ts — independent replay audit (item D):
// rational wire form, tamper detection, forged-but-chain-consistent files,
// resume/fork round trips. "DEFECT-Dn" tests assert the CURRENT behaviour of a
// confirmed defect (green reproducer; flip when fixed).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { stateHash } from "../../src/game/hash.ts";
import { withSeq } from "../../src/game/types.ts";
import type { GameState } from "../../src/game/types.ts";
import { parseReplayFile, serializeReplay } from "../../src/replay/format.ts";
import { validateReplay } from "../../src/replay/validate.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import { classifiers, strategies } from "../../src/strategy/registry.ts";
import { checkers } from "../../src/verification/invariants.ts";
import { createShell } from "../../src/ui/app.ts";
import type { Shell } from "../../src/ui/app.ts";
import { dispatch } from "../../src/ui/dispatch.ts";
import { exportSession, forkSession, resumeSession } from "../../src/ui/replay-io.ts";
import { ensureK5 } from "../strategies/k5driver.ts";
import { ensureK6 } from "../strategies/k6driver.ts";
import { testCtx } from "../helpers.ts";
import {
  P,
  evidence,
  exportText,
  guidedRequest,
  newSession,
  readReplayText,
  replayDoc,
  sandboxRequest,
  step,
  txnsOf,
} from "./audit-helpers.ts";

ensureK5();
ensureK6();

type Doc = Record<string, unknown>;
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// verdict: where (if anywhere) a mutated file is rejected; never lets a throw escape.
function verdict(doc: Doc | string): string {
  const text = typeof doc === "string" ? doc : JSON.stringify(doc);
  const parsed = parseReplayFile(text);
  if (!parsed.ok) {
    return `parse:${parsed.issues[0]?.code}@${parsed.issues[0]?.path}`;
  }
  try {
    const v = validateReplay(parsed.file, testCtx());
    return v.ok ? "ACCEPTED" : `validate:${v.issues[0]?.code}@${v.issues[0]?.path}`;
  } catch (e) {
    return `THREW:${String(e).slice(0, 80)}`;
  }
}

const SAMPLES = ["k5-safe", "k6-routeb", "sandbox-placed"] as const;
function doc(name: string): Doc {
  return replayDoc(`${name}.replay.json`);
}

describe("D. rational wire form: every non-canonical spelling is rejected at parse, on every rational path", () => {
  const BAD = [
    "2/4", "+1/2", "-0/1", "1/-2", "01/2", "1/02", " 1/2", "1/2 ", "1", "5", "0/2", "-1/-2",
    "1/0", "1e3/1", "0x10/1", "1_0/1", "1/1/1", "--1/1", "", "1/", "/1", "NaN", "Infinity",
    "−1/2", // unicode minus: Rat.fromString accepts it, canonical-compare must reject
    "٣/1", "１/2", "1.5/1", "1/2.0",
  ];
  const paths: Record<string, (d: Doc, v: unknown) => void> = {
    "action.at.x": (d, v) => { (txnsOf(d)[1] as Any).action.at.x = v; },
    "event.at.y": (d, v) => { (txnsOf(d)[1] as Any).events[0].at.y = v; },
    "config.window.xMin": (d, v) => { (d["config"] as Any).window.xMin = v; },
    "strategyStart.points[0].x": (d, v) => { (d["strategyStart"] as Any).points[0].x = v; },
  };
  it("matrix", () => {
    const rows: Record<string, string> = {};
    let accepted = 0;
    for (const [pname, set] of Object.entries(paths)) {
      const sample = pname.startsWith("strategyStart") ? "k6-routeb" : "k5-safe";
      for (const bad of BAD) {
        const d = doc(sample);
        set(d, bad);
        const r = parseReplayFile(JSON.stringify(d));
        rows[`${pname} <- ${JSON.stringify(bad)}`] = r.ok ? "ACCEPTED" : (r.issues[0]?.code ?? "?");
        if (r.ok) {
          accepted += 1;
        } else {
          expect(["bad-rational", "wrong-type"]).toContain(r.issues[0]?.code);
        }
      }
      // non-string types
      for (const bad of [1, null, 0.5, [], {}, true]) {
        const d = doc(sample);
        set(d, bad);
        expect(parseReplayFile(JSON.stringify(d)).ok).toBe(false);
      }
    }
    evidence("replay-rational-matrix", { accepted, rows });
    expect(accepted).toBe(0);
  });
  it("control: the canonical spelling of the same values parses and validates", () => {
    expect(verdict(doc("k5-safe"))).toBe("ACCEPTED");
    expect(Rat.fromString("2/4").toString()).toBe("1/2"); // why the spelling check matters
  });
});

describe("D. tamper battery: every semantic mutation is rejected (parse or fold), never accepted, never thrown", () => {
  const muts: Record<string, (d: Doc) => void> = {
    "action coordinate": (d) => { (txnsOf(d)[1] as Any).action.at.x = "9999/1"; },
    "event coordinate (Maker reply)": (d) => { (txnsOf(d)[1] as Any).events[1].at.y = "123/1"; },
    "event owner": (d) => { const e = (txnsOf(d)[1] as Any).events[0]; e.owner = e.owner === "maker" ? "breaker" : "maker"; },
    "nodeAfter id": (d) => { (txnsOf(d)[1] as Any).events[0].nodeAfter = "k5:nope"; },
    "caseId": (d) => { (txnsOf(d)[1] as Any).events[0].caseId = "k5:forged"; },
    "event order (swap)": (d) => { const e = (txnsOf(d)[1] as Any).events; [e[0], e[1]] = [e[1], e[0]]; },
    "drop an event": (d) => { (txnsOf(d)[1] as Any).events.pop(); },
    "duplicate an event": (d) => { const e = (txnsOf(d)[1] as Any).events; e.push({ ...e[e.length - 1] }); },
    "event stateHash char": (d) => { const e = (txnsOf(d)[1] as Any).events[0]; e.stateHash = e.stateHash.slice(0, -1) + (e.stateHash.endsWith("a") ? "b" : "a"); },
    "txn afterHash char (leaf)": (d) => { const t = txnsOf(d).at(-1) as Any; t.afterHash = t.afterHash.slice(0, -1) + (t.afterHash.endsWith("a") ? "b" : "a"); },
    "txn beforeHash char": (d) => { const t = txnsOf(d)[1] as Any; t.beforeHash = t.beforeHash.slice(0, -1) + (t.beforeHash.endsWith("a") ? "b" : "a"); },
    "version": (d) => { d["version"] = 1; },
    "format": (d) => { d["format"] = "esmb-replay-x"; },
    "config.k": (d) => { (d["config"] as Any).k = 7; },
    "strategy.id": (d) => { (d["strategy"] as Any).id = "no-such-strategy"; },
    "strategyVersion": (d) => { d["strategyVersion"] = "9.9.9"; },
    "drop a whole txn": (d) => { txnsOf(d).splice(1, 1); },
    "duplicate txnId": (d) => { const t = txnsOf(d); t.push({ ...(t[1] as object) }); },
    "txn parent rewired": (d) => { const t = txnsOf(d); (t[t.length - 1] as Any).parentTxnId = 0; },
    "renumber txn ids": (d) => { const ts = txnsOf(d) as Any[]; for (const t of ts.slice(1)) { const o = t.txnId; t.txnId = o + 10; for (const e of t.events) e.txnId = o + 10; for (const u of ts) if (u.parentTxnId === o) u.parentTxnId = o + 10; } if (d["cursorTxnId"] !== undefined) d["cursorTxnId"] = (d["cursorTxnId"] as number) + 10; },
    "window shrunk": (d) => { (d["config"] as Any).window = { xMin: "-1/1", yMin: "-1/1", xMax: "1/1", yMax: "1/1" }; },
  };
  for (const sample of SAMPLES) {
    it(`${sample}`, () => {
      const rows: Record<string, string> = {};
      for (const [name, mut] of Object.entries(muts)) {
        const d = doc(sample);
        try {
          mut(d);
        } catch {
          rows[name] = "n/a";
          continue;
        }
        const v = verdict(d);
        rows[name] = v;
        if (sample === "sandbox-placed" && ["event owner", "caseId", "strategy.id", "strategyVersion", "nodeAfter id"].includes(name)) {
          continue; // sandbox shapes differ (see DEFECT/WEAKNESS tests below)
        }
        expect(v === "ACCEPTED" || v.startsWith("THREW")).toBe(false);
      }
      evidence(`replay-tamper-${sample}`, rows);
    });
  }

  it("fully hash-consistent forgery of the Maker reply (all hashes recomputed) is STILL rejected: validation re-runs the engine", () => {
    const text = readReplayText("k5-safe.replay.json");
    const parsed = parseReplayFile(text);
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    const ctx = testCtx();
    const v = validateReplay(parsed.file, ctx);
    if (!v.ok) {
      throw new Error("unreachable");
    }
    const s1 = v.states.get(1) as GameState;
    const doctored: GameState = {
      ...s1,
      points: s1.points.map((p, i) => (i === 2 ? { ...p, pt: { x: Rat.fromString("21/1"), y: p.pt.y } } : p)),
    };
    const d = doc("k5-safe");
    d["transactions"] = txnsOf(d).slice(0, 2);
    d["cursorTxnId"] = 1;
    const t1 = txnsOf(d)[1] as Any;
    t1.events[1].at.x = "21/1";
    t1.events[1].stateHash = stateHash(withSeq(doctored, 0));
    t1.afterHash = stateHash(withSeq(doctored, 1));
    const res = verdict(d);
    evidence("replay-resealed-forgery", { res });
    expect(res).toBe("validate:hash-mismatch@transactions[1].afterHash");
  });
});

describe("D. malformed input never throws out of parseReplayFile", () => {
  it("junk corpus", () => {
    const deep = "[".repeat(200000);
    const inputs = ["", " ", "null", "[]", "{}", '{"format":"esmb-replay"}', "\u0000", "{", "}{", deep, '{"a":' + deep, "\ud800", "x".repeat(5000), '{"transactions":[]}', JSON.stringify({ format: "esmb-replay", version: 2, transactions: [null] })];
    const rows: string[] = [];
    for (const i of inputs) {
      const r = parseReplayFile(i);
      expect(r.ok).toBe(false);
      rows.push(r.ok ? "ok" : (r.issues[0]?.code ?? "?"));
    }
    evidence("replay-junk", rows);
  });
});

describe("D. confirmed defects / weaknesses: mutations that survive validation", () => {
  it("DEFECT-D1 (validate.ts:124-134 + game/hash.ts:42): stored MoveSpec of an uncovered maker-construction terminal is never re-derived — tamper preserves hash chain", () => {
    const d = doc("k5-boundary-uncovered");
    const t = txnsOf(d).at(-1) as Any;
    const mv = t.result.terminal.report.at.move;
    expect(mv.kind).toBe("extend");
    mv.prefer = "nearest"; // originally "farthest-clearance"
    mv.hole.k = 3; // originally 4
    expect(verdict(d)).toBe("ACCEPTED");
    // the validator compares this move by kind only, but the doctored
    // MoveSpec NEVER reaches the live session: resume rebuilds each stored
    // outcome from the re-derived state.
    const { shell } = setup();
    expect(resumeSession(shell, JSON.stringify(d), () => {})).toBe(true);
    const tree = shell.store.tree();
    const last = tree.transactions[tree.transactions.length - 1] as Any;
    expect(last.result.terminal.report.at.move.prefer).not.toBe("nearest");
  });

  it("FIXED D2: a `sample` action's caseId must equal the re-derived case — doctored labels are rejected", () => {
    const d = doc("k5-safe");
    const t1 = txnsOf(d)[1] as Any;
    t1.action = { kind: "sample", caseId: "TOTALLY-BOGUS-CASE", at: t1.action.at };
    expect(verdict(d)).toMatch(/semantic-divergence@.*action\.caseId/);
    // the TRUE label is accepted
    const ok = doc("k5-safe");
    (txnsOf(ok)[1] as Any).action = { kind: "sample", caseId: "k5:any", at: (txnsOf(ok)[1] as Any).action.at };
    expect(verdict(ok)).toBe("ACCEPTED");
  });

  it("WEAKNESS-D3: unknown/extra fields, duplicate keys and __proto__ keys are silently accepted ('closed type' not enforced)", () => {
    const base = JSON.stringify(doc("k5-safe"));
    const withExtra = base.replace('{"format"', '{"__proto__":{"polluted":1},"extra":[1,2],"format"');
    expect(verdict(withExtra)).toBe("ACCEPTED");
    expect(({} as Any).polluted).toBeUndefined(); // no prototype pollution
    const dup = base.replace('"version":2', '"version":3,"version":2');
    expect(verdict(dup)).toBe("ACCEPTED"); // last key wins, no duplicate-key detection
    const unknownTxnField = JSON.parse(base) as Doc;
    (txnsOf(unknownTxnField)[1] as Any).sneaky = { a: 1 };
    expect(verdict(unknownTxnField)).toBe("ACCEPTED");
  });

  it("WEAKNESS-D4: event ordinals (i/parent), meta, engineVersion, cursor are not bound to any hash — consistent shifts/edits survive", () => {
    const d = doc("k5-safe");
    const shift = 1000;
    for (const t of txnsOf(d).slice(1) as Any[]) {
      for (const e of t.events) {
        e.i += shift;
        if (e.parent !== null) {
          e.parent += shift;
        }
      }
    }
    // first event of txn1 has parent null (txn0 has no events) -> stays null; later txns link to shifted ids
    expect(verdict(d)).toBe("ACCEPTED");
    const d2 = doc("k5-safe");
    d2["engineVersion"] = "evil-9.9";
    (d2["meta"] as Any).label = "tampered";
    (d2["meta"] as Any).createdAt = "1999-01-01T00:00:00.000Z";
    d2["cursorTxnId"] = 0;
    expect(verdict(d2)).toBe("ACCEPTED");
  });

  it("DEFECT-D5 (engine/init.ts:431): classify-entry (k6) bootstrap hardcodes mode 'break' — config.mode 'proof' is ignored and not bound by any hash", () => {
    const d = doc("k6-routeb");
    expect((d["config"] as Any).mode).toBe("break");
    (d["config"] as Any).mode = "proof";
    expect(verdict(d)).toBe("ACCEPTED");
    const ctx = testCtx();
    const s = newSession({ ...guidedRequest(ctx, "esmb-k6"), mode: "proof", config: { mode: "proof", window: ctx.config.window }, strategyStart: { kind: "supplied", points: [P(0, 0), P(10, 1), P(12, 9), P(3, 14), P(-4, 7)], selectedHole: [P(0, 0), P(10, 1), P(12, 9), P(3, 14), P(-4, 7)] } } as never, ctx);
    expect(s.store.current().mode).toBe("break"); // asked for proof
  });

  it("DEFECT-D6 (replay/validate.ts:351, game/place.ts:36): a txn whose parent is TERMINAL makes validateReplay THROW (typed-issue contract broken); resumeSession propagates the exception", () => {
    const d = doc("k5-safe");
    const txns = txnsOf(d);
    const last = txns[txns.length - 1] as Any;
    const lastEv = last.events[last.events.length - 1];
    txns.push({
      txnId: last.txnId + 1,
      parentTxnId: last.txnId,
      action: { kind: "place", owner: "breaker", at: { x: "777/1", y: "5/1" } },
      events: [{ i: lastEv.i + 1, txnId: last.txnId + 1, indexInTxn: 1, parent: lastEv.i, owner: "breaker", at: { x: "777/1", y: "5/1" }, appliedPoint: "p99", nodeAfter: null, stateHash: "0000000000000000" }],
      beforeHash: last.afterHash,
      afterHash: "0000000000000000",
      result: last.result,
    });
    const v = verdict(d);
    evidence("replay-throw-after-terminal", { v });
    // FIXED: a typed issue (the engine rejects placements on terminal
    // states), never an exception; the UI resume path returns false + toast.
    expect(v).toMatch(/^validate:semantic-divergence@/);
    const { shell } = setup();
    expect(resumeSession(shell, JSON.stringify(d), () => {})).toBe(false);
  });

  it("DEFECT-D7 (engine/actions.ts:27, orchestrator.ts:529): engine never checks action.owner against whose turn it is — a Maker-owned user action is committed in a guided session as a 1-event txn that the exporter's own parser then rejects", () => {
    const ctx = testCtx();
    const { store } = newSession(guidedRequest(ctx, "esmb-k5"), ctx);
    expect(store.current().turn).toBe("breaker");
    const r = step(store, ctx, { kind: "place", owner: "maker", at: P(33, 7) });
    // FIXED: guided sessions reject non-Breaker owners ("wrong-turn").
    expect(r.status).toBe("rejected");
    expect(r.events.length).toBe(0);
    expect(store.current().points.length).toBe(1); // only the engine's A1
    expect(store.current().strategy?.nodeId).toBe("k5:await-b1");
  });

  it("DEFECT-D8 (spec §30; format.ts:257-288): no cap on rational size — a 1.2M-digit denominator parses (spec: reject |n|,|d| > 10^100)", () => {
    const d = doc("sandbox-placed");
    const big = "9".repeat(1_200_000);
    (txnsOf(d)[1] as Any).action.at.x = `1/${big}`;
    const text = JSON.stringify(d);
    expect(text.length).toBeLessThan(2 * 1024 * 1024);
    const t0 = performance.now();
    const r = parseReplayFile(text);
    const ms = performance.now() - t0;
    evidence("replay-huge-rational-parse", { digits: big.length, parseOk: r.ok, parseMs: Math.round(ms) });
    // FIXED: §30 cap — rejected as a typed issue, and fast (the cap is
    // checked on the string before any BigInt parsing).
    expect(r.ok).toBe(false);
    expect(ms).toBeLessThan(2000);
  }, 120000);
});

// ---------------- UI-level: resume, window, fork, branch round trip -------------
const live = { strategies: strategies(), classifiers: classifiers(), checkers: checkers() };
function setup(): { shell: Shell; panels: HTMLElement } {
  document.body.innerHTML = "";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const panels = document.createElement("aside");
  document.body.append(svg, panels);
  const shell = createShell(svg, panels, { width: 800, height: 600, registries: live });
  return { shell, panels };
}

describe("D. resume / window / branching round trips", () => {
  let blobs: Blob[] = [];
  let realCreate: typeof URL.createObjectURL | undefined;
  let realClick: (() => void) | undefined;
  beforeEach(() => {
    localStorage.clear();
    blobs = [];
    realCreate = URL.createObjectURL;
    realClick = HTMLAnchorElement.prototype.click as () => void;
    URL.createObjectURL = ((b: Blob) => { blobs.push(b); return "blob:mock"; }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
    HTMLAnchorElement.prototype.click = (() => {}) as () => void;
  });
  afterEach(() => {
    if (realCreate !== undefined) URL.createObjectURL = realCreate;
    if (realClick !== undefined) HTMLAnchorElement.prototype.click = realClick;
    document.body.innerHTML = "";
  });

  it("k5-branch: resume -> export reproduces transactions/cursor exactly; stored events == re-derived semantics; counters continue past loaded ordinals", () => {
    const text = readReplayText("k5-branch.replay.json");
    const { shell } = setup();
    expect(resumeSession(shell, text, () => {})).toBe(true);
    const out = JSON.parse(exportSession(shell, "x")) as Doc;
    const orig = JSON.parse(text) as Doc;
    expect(out["transactions"]).toEqual(orig["transactions"]);
    expect(out["cursorTxnId"]).toEqual(orig["cursorTxnId"]);
    expect(out["strategyStart"]).toEqual(orig["strategyStart"]);
    // new move on the resumed branch gets fresh ids
    const before = shell.store.tree();
    const maxI = Math.max(...before.events.map((e) => e.i));
    dispatch(shell.store, shell.ctx, { kind: "place", owner: "breaker", at: P(-50, 41) }, () => {});
    const after = shell.store.tree();
    expect(after.transactions.length).toBe(before.transactions.length + 1);
    expect(Math.min(...after.events.slice(before.events.length).map((e) => e.i))).toBe(maxI + 1);
    const again = parseReplayFile(exportSession(shell, "y"));
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(validateReplay(again.file, testCtx()).ok).toBe(true);
    }
  });

  it("fork at EVERY txn of the branching sample yields a valid, minimal prefix chain", async () => {
    const text = readReplayText("k5-branch.replay.json");
    const { shell } = setup();
    expect(resumeSession(shell, text, () => {})).toBe(true);
    const ids = shell.store.tree().transactions.map((t) => t.txnId);
    const rows: unknown[] = [];
    for (const id of ids) {
      shell.store.setCursor(id);
      blobs.length = 0;
      forkSession(shell, () => {});
      const ft = await (blobs[0] as Blob).text();
      const p = parseReplayFile(ft);
      expect(p.ok).toBe(true);
      if (!p.ok) throw new Error("unreachable");
      expect(validateReplay(p.file, testCtx()).ok).toBe(true);
      expect(p.file.cursorTxnId).toBe(id);
      rows.push({ cursor: id, txns: p.file.transactions.map((t) => t.txnId) });
    }
    evidence("replay-fork-prefixes", rows);
  });

  it("DEFECT-D9 (ui/replay-io.ts:136-165,227-250): resume validates under the FILE's window but the live shell keeps its default window; re-export then writes the default window and the file no longer validates", () => {
    // Build a sandbox session under a WIDE window and place a point outside the default window.
    const wideCtx = testCtx();
    wideCtx.config.window = { xMin: Rat.make(-100000000n), yMin: Rat.make(-100000000n), xMax: Rat.make(100000000n), yMax: Rat.make(100000000n) };
    const { store } = newSession(sandboxRequest(wideCtx), wideCtx);
    step(store, wideCtx, { kind: "place", owner: "maker", at: P(5_000_000, 1) });
    step(store, wideCtx, { kind: "place", owner: "breaker", at: P(3, 7) });
    const text = exportText(store, wideCtx);
    const p = parseReplayFile(text);
    expect(p.ok).toBe(true);
    if (!p.ok) throw new Error("unreachable");
    expect(validateReplay(p.file, testCtx()).ok).toBe(true); // valid: validator uses the file's window
    const { shell } = setup();
    expect(resumeSession(shell, text, () => {})).toBe(true);
    // FIXED: the live shell adopts the FILE's window on resume.
    expect(shell.ctx.config.window.xMax.toString()).toBe("100000000/1");
    const re = exportSession(shell, "re-export");
    const p2 = parseReplayFile(re);
    expect(p2.ok).toBe(true);
    if (!p2.ok) throw new Error("unreachable");
    const v2 = validateReplay(p2.file, testCtx());
    evidence("replay-window-roundtrip", { reExportValid: v2.ok, issue: v2.ok ? null : v2.issues[0] });
    expect(v2.ok).toBe(true); // round trip preserves the window
  });

  it("serializeReplay(parse(x)) is canonical for all shipped files and parse∘serialize is idempotent", () => {
    for (const n of ["k5-safe", "k5-branch", "k6-routeb", "k6-immediate", "sandbox-placed", "k5-blunder", "k5-boundary-uncovered", "k5-integrity"]) {
      const t = readReplayText(`${n}.replay.json`);
      const p = parseReplayFile(t);
      expect(p.ok).toBe(true);
      if (p.ok) {
        expect(serializeReplay(p.file)).toBe(t);
      }
    }
    void reduceTransaction;
  });
});
