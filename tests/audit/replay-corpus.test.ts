// tests/audit/replay-corpus.test.ts — data/replays/*.json audit (item G).
// Hashes are recomputed with an INDEPENDENT FNV-1a-64 / canonical-string
// implementation written from the §15.4 algorithm in this file (not
// src/game/hash.ts), over the states the engine fold derives.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GameState } from "../../src/game/types.ts";
import { stateHash } from "../../src/game/hash.ts";
import { parseReplayFile } from "../../src/replay/format.ts";
import { validateReplay } from "../../src/replay/validate.ts";
import { registerStrategy, strategies } from "../../src/strategy/registry.ts";
import { esmbK5 } from "../../src/strategy/strategies/k5/def.ts";
import { Rat } from "../../src/geometry/rat.ts";
import { ensureK5 } from "../strategies/k5driver.ts";
import { ensureK6 } from "../strategies/k6driver.ts";
import { testCtx } from "../helpers.ts";
import { REPLAY_DIR, evidence, readReplayText } from "./audit-helpers.ts";

ensureK5(); // == main.ts production registrations (k5, k6, k6-wide, classifiers, checkers)
ensureK6();

// ---- independent hash (spec §15.4 shape: FNV-1a-64 over canonical string) ----
function fnv64(s: string): string {
  let h = 0xcbf29ce484222325n;
  for (const b of new TextEncoder().encode(s)) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}
type Bind = string | readonly string[] | Rat;
function bind(v: Bind): string {
  if (typeof v === "string") return `id:${v}`;
  if (Array.isArray(v)) return `[${(v as string[]).map((x) => `id:${x}`).join(",")}]`;
  return (v as Rat).toString();
}
function indepHash(s: GameState): string {
  const pts = s.points.map((p) => `${p.id}|${p.owner}|${p.pt.x.n}/${p.pt.x.d}|${p.pt.y.n}/${p.pt.y.d}|${p.move}`).join(";");
  const rt = s.strategy;
  const strat = rt === null ? "null" : [rt.strategyId, rt.version, rt.nodeId, Object.keys(rt.vars).sort().map((k) => `${k}=${bind(rt.vars[k] as Bind)}`).join(","), rt.lastCase ?? ""].join("|");
  let term = "null";
  const t = s.terminal;
  if (t !== null) {
    if (t.kind === "maker-won") {
      term = `maker-won|${t.k}|${t.witness.map((h) => h.verts.join(",")).join(";")}|${t.nodeId}`;
    } else if (t.kind === "strategy-integrity-failure") {
      const f = t.report.failed;
      const an = f.analysis === undefined ? "" : JSON.stringify(
        f.analysis.kind === "exhaustive" ? { kind: f.analysis.kind, k: f.analysis.k, holes: f.analysis.holes.map((h) => ({ k: h.k, verts: [...h.verts] })) }
        : f.analysis.kind === "witness-only" ? { kind: f.analysis.kind, k: f.analysis.k, witness: { k: f.analysis.witness.k, verts: [...f.analysis.witness.verts] }, stoppedBy: f.analysis.stoppedBy }
        : { kind: f.analysis.kind, k: f.analysis.k, searched: f.analysis.searched });
      term = `integrity|${t.report.failedAt}|${t.report.phase}|${f.id}|${f.kind}|${String(f.passed)}|${f.detail}|${an}|${t.report.stateHash}`;
    } else if (t.report.origin === "breaker-reply") {
      term = `uncovered|breaker|${t.report.reason}|${t.report.at.nodeId}|${t.report.at.breakerPoint}|${t.report.detail}`;
    } else {
      term = `uncovered|maker|${t.report.reason}|${t.report.at.nodeId}|${t.report.at.move.kind}|${t.report.detail}`;
    }
  }
  return fnv64([`seq:${s.seq}`, `k:${s.k}`, `mode:${s.mode}`, `points:${pts}`, `turn:${s.turn}`, `terminal:${term}`, `strategy:${strat}`].join("\n"));
}

function ensureMisplaced(): void {
  if (strategies().has("test:k5-misplace")) return;
  const nodes = { ...esmbK5.nodes };
  const co = esmbK5.nodes["k5:r3:co-shoulder"];
  if (co === undefined) throw new Error("test bug");
  nodes["k5:r3:co-shoulder"] = { ...co, move: { kind: "fixed", at: [{ kind: "const", x: Rat.make(11n), y: Rat.make(14n) }] } };
  registerStrategy({ ...esmbK5, id: "test:k5-misplace", nodes }, "experimental-extension");
}

const FILES = readdirSync(REPLAY_DIR).filter((f) => f.endsWith(".replay.json")).sort();

describe("G. data/replays corpus", () => {
  it("corpus is exactly the 8 known files", () => {
    expect(FILES).toEqual([
      "k5-blunder.replay.json",
      "k5-boundary-uncovered.replay.json",
      "k5-branch.replay.json",
      "k5-integrity.replay.json",
      "k5-safe.replay.json",
      "k6-immediate.replay.json",
      "k6-routeb.replay.json",
      "sandbox-placed.replay.json",
    ]);
  });

  it("k5-integrity.replay.json is deliberately NOT loadable in the production registry (strategy 'test:k5-misplace' is test-only)", () => {
    const p = parseReplayFile(readReplayText("k5-integrity.replay.json"));
    expect(p.ok).toBe(true);
    if (!p.ok) throw new Error("unreachable");
    expect(strategies().has("test:k5-misplace")).toBe(false);
    const v = validateReplay(p.file, testCtx());
    expect(v.ok).toBe(false);
    expect(v.ok ? "" : v.issues[0]?.message).toContain("unknown strategyId 'test:k5-misplace'");
    evidence("corpus-g1", { issue: v.ok ? null : v.issues[0] });
  });

  for (const f of FILES) {
    it(`independent hash chain: ${f}`, () => {
      if (f === "k5-integrity.replay.json") ensureMisplaced();
      const p = parseReplayFile(readReplayText(f));
      expect(p.ok).toBe(true);
      if (!p.ok) throw new Error("unreachable");
      const v = validateReplay(p.file, testCtx());
      expect(v.ok).toBe(true);
      if (!v.ok) throw new Error(JSON.stringify(v.issues));
      const rows: unknown[] = [];
      const byId = new Map(p.file.transactions.map((t) => [t.txnId, t]));
      for (const t of p.file.transactions) {
        const st = v.states.get(t.txnId) as GameState;
        const mine = indepHash(st);
        expect(mine).toBe(t.afterHash); // independent recomputation of the stored afterHash
        expect(stateHash(st)).toBe(mine); // src hash agrees with the independent one
        if (t.parentTxnId !== null) {
          expect(t.beforeHash).toBe((byId.get(t.parentTxnId) as { afterHash: string }).afterHash);
        }
        // committed txns: the last event's milestone state is the final state at
        // input seq � except k6, where computed-step nodes (no events) run after
        // the last Maker event and bind more vars before parking.
        if (t.result.kind === "committed" && t.events.length > 0 && !f.startsWith("k6-")) {
          const last = t.events[t.events.length - 1] as { stateHash: string };
          expect(last.stateHash).toBe(indepHash({ ...st, seq: t.parentTxnId as number }));
        }
        rows.push({ txn: t.txnId, parent: t.parentTxnId, afterHash: t.afterHash, indep: mine });
      }
      expect(v.states.has(v.cursor)).toBe(true);
      evidence(`corpus-chain-${f}`, rows);
    });
  }

  it("tests/replay/audit.test.ts (npm run audit:replays) is structural only: static facts", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "replay", "audit.test.ts"), "utf8");
    // hard-coded file list (a 9th file added to data/replays would not be audited)
    expect(src).toMatch(/for \(const name of \[\s*"k5-safe\.replay\.json"/);
    // never recomputes a hash / never runs the fold / never parses via the product parser
    expect(src).not.toMatch(/stateHash|validateReplay|parseReplayFile|initSession|reduceTransaction/);
    // afterHash of a leaf is only checked for non-empty
    expect(src).toMatch(/typeof t\.afterHash !== "string" \|\| t\.afterHash\.length === 0/);
    evidence("corpus-audit-static", { hardCodedList: true, recomputesHashes: false });
  });
});
