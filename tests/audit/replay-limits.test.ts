// @vitest-environment jsdom
// tests/audit/replay-limits.test.ts — the 2 MB replay input limit (item E):
// every entry path, bytes vs UTF-16 chars, with 2 MB+1 payloads.
// Input-path inventory (src/): parseReplayFile (format.ts:858, the only
// JSON.parse of replay text), pickReplayFile (replay-io.ts:80), resumeSession
// (replay-io.ts:116), listAutosaves (replay-io.ts:279, a SECOND JSON.parse),
// readAutosave (replay-io.ts:316), saveAutosave (replay-io.ts:227),
// exportSession/forkSession. No paste or drag-drop handler exists in src/.
// "DEFECT/WEAKNESS-E*" tests assert current behaviour.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_REPLAY_CHARS, parseReplayFile } from "../../src/replay/format.ts";
import { withSeq } from "../../src/game/types.ts";
import type { ActionTransaction, MoveEvent } from "../../src/game/types.ts";
import { classifiers, strategies } from "../../src/strategy/registry.ts";
import { checkers } from "../../src/verification/invariants.ts";
import { createShell } from "../../src/ui/app.ts";
import type { Shell } from "../../src/ui/app.ts";
import {
  exportSession,
  listAutosaves,
  pickReplayFile,
  readAutosave,
  resumeSession,
  saveAutosave,
} from "../../src/ui/replay-io.ts";
import { ensureK5 } from "../strategies/k5driver.ts";
import { evidence, readReplayText, replayDoc } from "./audit-helpers.ts";

ensureK5();

const MB2 = 2 * 1024 * 1024;
const live = { strategies: strategies(), classifiers: classifiers(), checkers: checkers() };

function setup(): Shell {
  document.body.innerHTML = "";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const panels = document.createElement("aside");
  document.body.append(svg, panels);
  return createShell(svg, panels, { width: 800, height: 600, registries: live });
}

// A VALID replay (k5-safe) padded via meta.label to exactly `chars` UTF-16 units.
function paddedReplay(chars: number, unit = "x"): string {
  const d = replayDoc("k5-safe.replay.json");
  (d["meta"] as Record<string, unknown>)["label"] = "";
  const base = JSON.stringify(d).length;
  (d["meta"] as Record<string, unknown>)["label"] = unit.repeat(Math.max(0, chars - base));
  return JSON.stringify(d);
}

describe("E. parseReplayFile (resume-from-autosave, any in-memory string): limit counts UTF-16 chars", () => {
  it("2MB+1 chars -> too-large; exactly 2MB chars is accepted as VALID replay", () => {
    const over = paddedReplay(MB2 + 1);
    expect(over.length).toBe(MB2 + 1);
    const r = parseReplayFile(over);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.issues[0]?.code).toBe("too-large");
    const atCap = paddedReplay(MB2);
    expect(atCap.length).toBe(MB2);
    expect(parseReplayFile(atCap).ok).toBe(true);
  });

  it("WEAKNESS-E1 (format.ts:200,864): cap is chars not bytes — a valid replay of 6 MB UTF-8 (2M chars of '€') is accepted; 3 MB likewise", () => {
    const t6 = paddedReplay(MB2, "€");
    const bytes6 = Buffer.byteLength(t6, "utf8");
    const r6 = parseReplayFile(t6);
    const t3 = paddedReplay(1_000_000, "€");
    const bytes3 = Buffer.byteLength(t3, "utf8");
    const r3 = parseReplayFile(t3);
    evidence("limits-bytes-vs-chars", { chars6: t6.length, bytes6, ok6: r6.ok, chars3: t3.length, bytes3, ok3: r3.ok });
    expect(bytes6).toBeGreaterThan(5.9 * 1024 * 1024);
    // FIXED: the cap is BYTES (UTF-8), not UTF-16 characters.
    expect(r6.ok).toBe(false);
    expect(bytes3).toBeGreaterThan(MB2);
    expect(r3.ok).toBe(false);
  });
});

describe("E. file picker path", () => {
  let realClick: (() => void) | undefined;
  beforeEach(() => {
    realClick = HTMLInputElement.prototype.click as () => void;
  });
  afterEach(() => {
    if (realClick !== undefined) {
      HTMLInputElement.prototype.click = realClick;
    }
  });
  function pickWith(file: File, toast: (m: string) => void): Promise<string | null> {
    HTMLInputElement.prototype.click = function (this: HTMLInputElement) {
      Object.defineProperty(this, "files", { value: [file], configurable: true });
      this.dispatchEvent(new Event("change"));
    } as () => void;
    return pickReplayFile(toast);
  }

  it("2MB+1 BYTES is rejected before reading (size in bytes) and toasts; exactly 2MB bytes is read", async () => {
    const toasts: string[] = [];
    const over = new File([new Uint8Array(MB2 + 1).fill(120)], "big.json");
    expect(await pickWith(over, (m) => toasts.push(m))).toBe(null);
    expect(toasts.length).toBe(1);
    expect(toasts[0]).toContain("2 MB cap");
    const ok = new File([new Uint8Array(MB2).fill(120)], "edge.json");
    const text = await pickWith(ok, (m) => toasts.push(m));
    expect(text?.length).toBe(MB2);
  });

  it("picker is BYTE-strict while parseReplayFile is char-lenient: a 3 MB-UTF-8 valid replay is refused by the picker but accepted by the parser (inconsistent paths)", async () => {
    const t3 = paddedReplay(1_000_000, "€");
    const toasts: string[] = [];
    const picked = await pickWith(new File([t3], "euro.json"), (m) => toasts.push(m));
    evidence("limits-picker-vs-parser", { bytes: Buffer.byteLength(t3), picked: picked !== null, toast: toasts[0] ?? null, parserOk: parseReplayFile(t3).ok });
    // FIXED: picker and parser now agree (both byte-strict).
    expect(picked).toBe(null);
    expect(parseReplayFile(t3).ok).toBe(false);
  });
});

describe("E. autosave read path (localStorage -> listAutosaves/readAutosave/resumeSession)", () => {
  beforeEach(() => localStorage.clear());

  it("resume of a 2MB+1 autosave is refused by the parser cap with a typed toast", () => {
    const shell = setup();
    shell.startSandbox();
    localStorage.setItem("pp.autosave.v2.sandbox.sandbox", paddedReplay(MB2 + 1));
    const raw = readAutosave("pp.autosave.v2.sandbox.sandbox");
    expect(raw?.length).toBe(MB2 + 1);
    const toasts: string[] = [];
    expect(resumeSession(shell, raw as string, (m) => toasts.push(m))).toBe(false);
    expect(toasts[0]).toContain("too-large");
  });

  it("WEAKNESS-E2 (replay-io.ts:295): listAutosaves JSON.parses every autosave with NO size gate and puts the (attacker-controlled) label into the entry list", () => {
    localStorage.setItem("pp.autosave.v2.sandbox.sandbox", paddedReplay(MB2 + 1));
    const t0 = performance.now();
    const list = listAutosaves();
    const ms = performance.now() - t0;
    evidence("limits-listAutosaves", { entries: list.length, labelChars: list[0]?.label.length ?? 0, ms: Math.round(ms) });
    expect(list.length).toBe(1);
    expect(list[0]?.label.length).toBeGreaterThan(MB2 - 5000);
  });
});

describe("E. autosave WRITE + export paths (no cap)", () => {
  beforeEach(() => localStorage.clear());

  function forge(shell: Shell, nEvents: number): void {
    const store = shell.store;
    const st0 = store.stateAtTxn(0);
    const at = { x: Rat0(1), y: Rat0(2) };
    const evs: MoveEvent[] = [];
    for (let i = 0; i < nEvents; i += 1) {
      evs.push({ i: i + 1, txnId: 1, indexInTxn: i + 1, parent: i === 0 ? null : i, owner: "maker", at, appliedPoint: "p1", nodeAfter: null, stateHash: "0123456789abcdef" });
    }
    const txn: ActionTransaction = {
      txnId: 1,
      parentTxnId: 0,
      action: { kind: "place", owner: "maker", at },
      events: evs,
      beforeHash: store.afterHashOf(0),
      afterHash: "0123456789abcdef",
      result: { kind: "committed" },
    };
    store.append(txn, withSeq(st0, 1));
  }

  it("DEFECT-E3 (replay-io.ts:259): saveAutosave has no size cap — it writes a >2MB autosave that can never be resumed (Resume row fails every time); exportSession likewise produces a file the app refuses to import", () => {
    const shell = setup();
    shell.startSandbox();
    forge(shell, 16000);
    const toasts: string[] = [];
    saveAutosave(shell.store, shell.ctx, (m) => toasts.push(m));
    const key = "pp.autosave.v2.sandbox.sandbox";
    const raw = localStorage.getItem(key);
    // FIXED: an over-cap autosave is never written (one notice instead).
    expect(raw).toBe(null);
    expect(toasts.length).toBe(1);
    expect(toasts[0]).toContain("2 MB");
    const toasts2: string[] = [];
    const exported = exportSession(shell, "big");
    const p = parseReplayFile(exported);
    evidence("limits-write-asymmetry", { autosaveChars: 0, resumeToast: toasts2[0], exportChars: exported.length, parseCode: p.ok ? "ok" : p.issues[0]?.code });
    expect(p.ok).toBe(false);
    expect(p.ok ? "" : p.issues[0]?.code).toBe("too-large");
  });

  it("DEFECT-E4 (replay-io.ts:224,264): after ONE storage failure autosaveAlive is set false for the rest of the page's life (no retry) — later small saves are silently skipped", () => {
    const shell = setup();
    shell.startSandbox();
    const realSet = Storage.prototype.setItem;
    let calls = 0;
    Storage.prototype.setItem = function (this: Storage, k: string, v: string) {
      calls += 1;
      if (calls === 1) {
        throw new DOMException("quota", "QuotaExceededError");
      }
      return realSet.call(this, k, v);
    };
    try {
      const toasts: string[] = [];
      saveAutosave(shell.store, shell.ctx, (m) => toasts.push(m));
      expect(toasts).toEqual(["Autosave disabled: storage unavailable."]);
      saveAutosave(shell.store, shell.ctx, (m) => toasts.push(m));
      saveAutosave(shell.store, shell.ctx, (m) => toasts.push(m));
      expect(calls).toBe(1); // storage healthy again, but never retried
      expect(localStorage.getItem("pp.autosave.v2.sandbox.sandbox")).toBe(null);
    } finally {
      Storage.prototype.setItem = realSet;
    }
  });
});

describe("E. no other entry paths exist (static)", () => {
  it("JSON.parse sites and paste/drop handlers in src/", () => {
    const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".ts") ? [join(d, e.name)] : [],
      );
    const parses: string[] = [];
    const handlers: string[] = [];
    for (const f of walk(SRC)) {
      const t = readFileSync(f, "utf8").replace(/\/\/.*$/gm, "");
      const rel = f.slice(SRC.length + 1).replaceAll("\\", "/");
      if (/JSON\.parse\(/.test(t)) parses.push(rel);
      if (/"paste"|"drop"|"dragover"|clipboard\./.test(t)) handlers.push(rel);
    }
    evidence("limits-entry-paths", { parses, handlers });
    // replay/experiment.ts: the experiment-file (k-strip / lab) entry path; it
    // applies its own 2 MB cap BEFORE JSON.parse (asserted below).
    expect(parses.sort()).toEqual(["replay/experiment.ts", "replay/format.ts", "ui/replay-io.ts"]);
    const exp = readFileSync(join(SRC, "replay", "experiment.ts"), "utf8");
    expect(exp.indexOf("EXPERIMENT_MAX_CHARS")).toBeGreaterThan(0);
    expect(exp.indexOf("exceeds the 2 MB cap")).toBeLessThan(exp.indexOf("JSON.parse("));
    expect(handlers).toEqual([]);
    expect(readReplayText("k5-safe.replay.json").length).toBeLessThan(MAX_REPLAY_CHARS);
  });
});

import { Rat } from "../../src/geometry/rat.ts";
function Rat0(n: number): Rat {
  return Rat.make(BigInt(n));
}
