// @vitest-environment jsdom
// tests/audit/replay-perf.test.ts — performance of replay validation and UI
// resume (item F). Timings are written to AUDIT_EVIDENCE_DIR/replay-perf.json;
// assertions are structural (render counts) plus very generous time ceilings.
import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import { parseReplayFile } from "../../src/replay/format.ts";
import { validateReplay } from "../../src/replay/validate.ts";
import { classifiers, strategies } from "../../src/strategy/registry.ts";
import { checkers } from "../../src/verification/invariants.ts";
import { createShell } from "../../src/ui/app.ts";
import { resumeSession } from "../../src/ui/replay-io.ts";
import { ensureK5 } from "../strategies/k5driver.ts";
import { ensureK6 } from "../strategies/k6driver.ts";
import { testCtx } from "../helpers.ts";
import {
  P,
  REPLAY_DIR,
  evidence,
  exportText,
  lcg,
  newSession,
  readReplayText,
  sandboxRequest,
  step,
} from "./audit-helpers.ts";
import type { Store } from "../../src/session/store.ts";
import type { RuntimeCtx } from "../../src/engine/orchestrator.ts";

ensureK5();
ensureK6();

const out: Record<string, unknown> = {};
// Default sizes keep the suite fast; AUDIT_PERF_SIZES="30,60" etc. for the long run.
const SIZES = (process.env["AUDIT_PERF_SIZES"] ?? "10,20").split(",").map(Number);
const UI_SIZES = (process.env["AUDIT_PERF_UI_SIZES"] ?? "8,12,16").split(",").map(Number);
const ms = (t0: number): number => Math.round((performance.now() - t0) * 10) / 10;

function best(n: number, f: () => void): number {
  let b = Infinity;
  for (let i = 0; i < n; i += 1) {
    const t0 = performance.now();
    f();
    b = Math.min(b, performance.now() - t0);
  }
  return Math.round(b * 10) / 10;
}

function buildSandbox(n: number, seed: number): { text: string; store: Store; ctx: RuntimeCtx; buildMs: number } {
  const ctx = testCtx();
  const { store } = newSession(sandboxRequest(ctx, 5), ctx);
  const rnd = lcg(seed);
  const t0 = performance.now();
  let placed = 0;
  let guard = 0;
  while (placed < n && guard < n * 20) {
    guard += 1;
    const at = P(Math.floor(rnd() * 20000) - 10000, Math.floor(rnd() * 20000) - 10000);
    const r = step(store, ctx, { kind: "place", owner: placed % 2 === 0 ? "maker" : "breaker", at });
    if (r.status === "accepted") {
      placed += 1;
    }
  }
  const buildMs = ms(t0);
  return { text: exportText(store, ctx), store, ctx, buildMs };
}

describe("F. validation time", () => {
  it("every shipped replay: parse + validate (best of 5)", () => {
    const rows: Record<string, unknown> = {};
    for (const f of readdirSync(REPLAY_DIR).filter((x) => x.endsWith(".replay.json"))) {
      if (f === "k5-integrity.replay.json") {
        continue; // needs the test-only def
      }
      const text = readReplayText(f);
      const t = best(5, () => {
        const p = parseReplayFile(text);
        if (!p.ok) throw new Error("parse");
        const v = validateReplay(p.file, testCtx());
        if (!v.ok) throw new Error("validate");
      });
      rows[f] = { bytes: text.length, ms: t };
      expect(t).toBeLessThan(5000);
    }
    out["shipped"] = rows;
    evidence("replay-perf", out);
  });

  it("synthetic sandbox replays of 15/30/60/120 placed points: engine build, export, parse, validate", () => {
    const rows: Record<string, unknown> = {};
    for (const n of SIZES) {
      const b = buildSandbox(n, 7);
      const tp0 = performance.now();
      const p = parseReplayFile(b.text);
      const parseMs = ms(tp0);
      if (!p.ok) throw new Error("parse failed");
      const tv0 = performance.now();
      const v = validateReplay(p.file, testCtx());
      const validateMs = ms(tv0);
      expect(v.ok).toBe(true);
      // FIXED: sandbox replay validation skips the per-placement
      // exhaustive sweep (was 0.3–0.8 s/txn at 30–40 points).
      expect(validateMs / n).toBeLessThan(100);
      rows[String(n)] = { bytes: b.text.length, buildMs: b.buildMs, parseMs, validateMs, perTxnValidateMs: Math.round((validateMs / n) * 100) / 100 };
      out["synthetic"] = rows;
      evidence("replay-perf", out);
    }
    out["synthetic"] = rows;
    evidence("replay-perf", out);
    const r = rows as Record<string, { validateMs: number }>;
    expect(Object.keys(r).length).toBe(SIZES.length);
  }, 600000);

  it("rational magnitude: a >10^100 coordinate is rejected at parse (spec §30 cap, FIXED) — never validated", () => {
    const rows: Record<string, unknown> = {};
    for (const digits of [1000, 10000, 40000]) {
      const D = BigInt("1" + "0".repeat(digits - 1)) + 7n;
      const ctx = testCtx();
      const { store } = newSession(sandboxRequest(ctx, 5), ctx);
      const tb0 = performance.now();
      step(store, ctx, { kind: "place", owner: "maker", at: P(0, 0) });
      step(store, ctx, { kind: "place", owner: "breaker", at: pt(Rat.make(1n), Rat.make(1n, D)) });
      step(store, ctx, { kind: "place", owner: "maker", at: pt(Rat.make(2n), Rat.make(5n, D)) });
      const buildMs = ms(tb0);
      const text = exportText(store, ctx);
      const tp0 = performance.now();
      const p = parseReplayFile(text);
      const parseMs = ms(tp0);
      expect(p.ok).toBe(false); // over the 10^100 cap
      rows[String(digits)] = { bytes: text.length, buildMs, parseMs, parseOk: p.ok };
    }
    out["bigRationals"] = rows;
    evidence("replay-perf", out);
  }, 600000);
});

describe("F. UI resume", () => {
  it("FIXED: resumeSession publishes ONCE for the whole load — render count is O(1), independent of N", () => {
    const rows: Record<string, unknown> = {};
    for (const n of UI_SIZES) {
      const b = buildSandbox(n, 11);
      document.body.innerHTML = "";
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const panels = document.createElement("aside");
      document.body.append(svg, panels);
      const shell = createShell(svg, panels, {
        width: 800,
        height: 600,
        registries: { strategies: strategies(), classifiers: classifiers(), checkers: checkers() },
      });
      shell.startSandbox();
      let renders = 0;
      const orig = shell.render;
      shell.render = (): void => {
        renders += 1;
        orig();
      };
      const t0 = performance.now();
      const okResume = resumeSession(shell, b.text, () => {});
      const total = ms(t0);
      expect(okResume).toBe(true);
      rows[String(n)] = { txns: n + 1, renders, totalMs: total, perRenderMs: Math.round((total / renders) * 100) / 100 };
      // N+1 appends (txn0..txnN) -> N+1 publish->render, + startSandbox render(s) inside, + setCursor + explicit render
      expect(renders).toBeLessThanOrEqual(6);
    }
    out["uiResume"] = rows;
    evidence("replay-perf", out);
    const r = rows as Record<string, { renders: number; totalMs: number }>;
    // linear render count: renders(n2) - renders(n1) == n2 - n1
    const [a, b] = [UI_SIZES[0] as number, UI_SIZES[UI_SIZES.length - 1] as number];
    expect((r[String(b)] as { renders: number }).renders).toBe((r[String(a)] as { renders: number }).renders);
  }, 600000);
});
