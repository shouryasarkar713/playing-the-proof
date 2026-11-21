// @vitest-environment jsdom
// tests/audit/lifecycle-typed.test.ts — typed-failure audit (item C).
// Passing tests pin VERIFIED behaviour. Tests whose title starts with
// "DEFECT-" assert the CURRENT (defective) behaviour so the reproducer is a
// green, runnable artifact; flip the assertion when the defect is fixed.
import { describe, expect, it } from "vitest";
import { findKHoles } from "../../src/geometry/holes.ts";
import { evalRegion } from "../../src/strategy/eval.ts";
import { initSession } from "../../src/engine/init.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import { registerStrategy, strategies, classifiers } from "../../src/strategy/registry.ts";
import type { StrategyDef } from "../../src/strategy/types.ts";
import { checkers } from "../../src/verification/invariants.ts";
import { createShell } from "../../src/ui/app.ts";
import { dispatch } from "../../src/ui/dispatch.ts";
import { ensureK5 } from "../strategies/k5driver.ts";
import { ensureK6, playK6Game } from "../strategies/k6driver.ts";
import { mulberry32, testCtx, withIds } from "../helpers.ts";
import { P, evidence, guidedRequest, lcg, newSession, sandboxRequest, step } from "./audit-helpers.ts";

ensureK5();
ensureK6();

describe("C. starved budgets surface as typed integrity failures carrying the analysis", () => {
  it("k5: budgets 0/1/5/50 never yield uncovered/empty/maker-won; failure carries budget-exhausted analysis", () => {
    const rows: unknown[] = [];
    for (const budget of [0, 1, 5, 50]) {
      const ctx = testCtx(budget);
      const { store } = newSession(guidedRequest(ctx, "esmb-k5"), ctx);
      for (const at of [P(10, 0), P(7, 9), P(-30, -30)]) {
        if (store.current().terminal !== null) {
          break;
        }
        step(store, ctx, { kind: "place", owner: "breaker", at });
      }
      const t = store.current().terminal;
      expect(t?.kind).toBe("strategy-integrity-failure");
      if (t?.kind !== "strategy-integrity-failure") {
        throw new Error("unreachable");
      }
      expect(t.report.failed.passed).toBe(false);
      expect(t.report.failed.analysis?.kind).toBe("budget-exhausted");
      rows.push({ budget, id: t.report.failed.id, phase: t.report.phase, at: t.report.failedAt });
    }
    evidence("typed-k5-starved", rows);
  });

  it("k6: starved budgets never produce uncovered; any terminal is integrity/maker-won (verified witness) — evidence only for init rejections", () => {
    const rows: unknown[] = [];
    for (const budget of [0, 10, 1000]) {
      for (let g = 0; g < 4; g += 1) {
        const ctx = testCtx(budget);
        try {
          const res = playK6GameWith(ctx, mulberry32(90 + g));
          rows.push({ budget, game: g, ...res });
          expect(res.terminalKind).not.toBe("uncovered");
        } catch (e) {
          rows.push({ budget, game: g, threw: String(e).slice(0, 120) });
        }
      }
    }
    evidence("typed-k6-starved", rows);
    expect(rows.some((r) => (r as { threw?: string }).threw !== undefined)).toBe(false);
  });

  it("rejection vs integrity vs uncovered vs implementation-error stay distinct", () => {
    const ctx = testCtx();
    const { store } = newSession(guidedRequest(ctx, "esmb-k5"), ctx);
    // rejection: coincident point -> status rejected, no events, no state
    const rej = reduceTransaction(store.current(), { kind: "place", owner: "breaker", at: P(0, 0) }, ctx);
    expect(rej.status).toBe("rejected");
    expect(rej.events.length).toBe(0);
    expect(rej.nextState).toBeUndefined();
    expect(rej.diagnostics[0]?.kind).toBe("rejection");
    // FIXED: a placement on a terminal state is a typed REJECTION
    // ("wrong-turn"/game-over) — it used to throw from placePoint.
    const s = newSession(guidedRequest(ctx, "esmb-k5"), ctx);
    for (const at of [P(10, 0), P(10, 9), P(-30, -30)]) {
      step(s.store, ctx, { kind: "place", owner: "breaker", at });
    }
    expect(s.store.current().terminal).not.toBe(null);
    const afterTerminal = reduceTransaction(s.store.current(), { kind: "place", owner: "breaker", at: P(100, 1) }, ctx);
    expect(afterTerminal.status).toBe("rejected");
    expect(afterTerminal.events.length).toBe(0);
    const rejection = afterTerminal.diagnostics[0];
    expect(rejection?.kind).toBe("rejection");
    if (rejection?.kind === "rejection") {
      expect(rejection.rejection.reason).toBe("wrong-turn");
    }
  });

  it("partial results never leak: budget-exhausted analysis has no holes/witness; incomplete region has no region", () => {
    const pts = withIds([P(0, 0), P(10, 1), P(3, 12), P(-7, 5), P(9, -8), P(4, 4), P(-3, -9)]);
    const a = findKHoles(pts, 5, { mode: "exhaustive", budget: 1 });
    expect(a.kind).toBe("budget-exhausted");
    expect("holes" in a).toBe(false);
    expect("witness" in a).toBe(false);
    const ctx = testCtx(1);
    const { store } = newSession(sandboxRequest(ctx, 5), ctx);
    for (const [i, at] of [P(0, 0), P(10, 1), P(3, 12), P(-7, 5), P(9, -8), P(4, 4)].entries()) {
      step(store, ctx, { kind: "place", owner: i % 2 === 0 ? "maker" : "breaker", at });
    }
    const r = evalRegion({ kind: "holes", k: 5 } as never, { state: store.current(), config: ctx.config, channel: "correctness" });
    expect(r.kind).toBe("incomplete");
    expect("region" in r).toBe(false);
  });
});

describe("C. defects in incomplete-vs-empty handling", () => {
  it("DEFECT-C1 (init.ts:152-158): declared-win witness search that hits the budget is reported as 'declared win without a k-hole' (no analysis attached), unlike orchestrator.ts:589", () => {
    const base = { show: [], why: { headline: "t", claims: [], sourceRef: "t" }, sourceRef: "t" } as const;
    const fx = (id: string, next: string, x: number, y: number): StrategyDef["nodes"][string] => ({
      id,
      role: "maker-move",
      next,
      move: { kind: "fixed", at: [{ kind: "const", x: P(x, y).x, y: P(x, y).y }] },
      ...base,
    });
    const d: StrategyDef = {
      id: "audit-declared-win",
      k: 5,
      version: "0.0.0",
      source: { paper: "t", stepMap: {} },
      entry: "m1",
      nodes: {
        m1: fx("m1", "m2", 0, 0),
        m2: fx("m2", "m3", 30, 0),
        m3: fx("m3", "m4", 0, 30),
        m4: fx("m4", "m5", 31, 29),
        m5: fx("m5", "T", 15, 12), // interior point: 5 points, NOT a 5-hole
        T: { id: "T", role: "terminal", ...base },
      },
    };
    if (!strategies().has(d.id)) {
      registerStrategy(d, "experimental-extension");
    }
    const run = (budget: number) => {
      const ctx = testCtx(budget);
      const r = initSession({ kind: "guided", config: { mode: "break", window: ctx.config.window }, strategyId: d.id, mode: "break" }, ctx);
      expect(r.status).toBe("accepted");
      const t = r.state?.terminal;
      if (t?.kind !== "strategy-integrity-failure") {
        throw new Error(`unexpected terminal ${String(t?.kind)}`);
      }
      return t.report.failed;
    };
    const full = run(20000000);
    const starved = run(0);
    evidence("typed-declared-win", { full, starved });
    expect(full.detail).toBe("declared win without a k-hole");
    // Defect: the starved (undecidable) case is indistinguishable from the decided one.
    expect(starved.detail).toBe("declared win without a k-hole");
    expect(starved.analysis).toBeUndefined();
  });

  it("DEFECT-C2 (pipeline.ts:44 + orchestrator.ts:524): sandbox win-check 'incomplete' is silently dropped — no diagnostic, same output as 'no hole'", () => {
    const run = (budget: number) => {
      const ctx = testCtx(budget);
      const { store } = newSession(sandboxRequest(ctx, 5), ctx);
      const rnd = lcg(5);
      const notes: string[][] = [];
      for (let i = 0; i < 8; i += 1) {
        const at = P(Math.floor(rnd() * 400) - 200, Math.floor(rnd() * 400) - 200);
        const r = step(store, ctx, { kind: "place", owner: i % 2 === 0 ? "maker" : "breaker", at });
        notes.push(r.diagnostics.map((x) => x.kind));
      }
      return notes;
    };
    const full = run(20000000);
    const starved = run(1);
    evidence("typed-sandbox-incomplete", { full, starved });
    expect(full.flat()).toContain("analysis-note");
    expect(starved.flat()).toEqual([]); // no "analysis incomplete" diagnostic exists at all
  });

  it("FIXED C3: with the holes overlay OFF the analysis is still the real one", () => {
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
    const rnd = lcg(11);
    for (let i = 0; i < 12; i += 1) {
      dispatch(
        shell.store,
        shell.ctx,
        { kind: "place", owner: i % 2 === 0 ? "maker" : "breaker", at: P(Math.floor(rnd() * 400) - 200, Math.floor(rnd() * 400) - 200) },
        () => {},
      );
    }
    const diag = (): string => panels.textContent?.match(/points: \d+ · turn[^·]*· k=\d · [^·]*/)?.[0] ?? "";
    const on = shell.holes();
    expect(on.kind).toBe("exhaustive");
    const nOn = on.kind === "exhaustive" ? on.holes.length : -1;
    expect(nOn).toBeGreaterThan(0);
    const diagOn = diag();
    shell.toggleOverlay("holes");
    const off = shell.holes();
    const diagOff = diag();
    evidence("typed-overlay-off", { nOn, offKind: off.kind, offHoles: off.kind === "exhaustive" ? off.holes.length : null, diagOn, diagOff });
    // FIXED: the overlay toggle only gates DRAWING — the analysis the
    // diagnostics read is the real one, never a fabricated empty result.
    expect(off.kind).toBe("exhaustive");
    expect(off.kind === "exhaustive" ? off.holes.length : -1).toBe(nOn);
    expect(diagOff).toContain(`${nOn} 5-hole(s), exhaustive over 12 points`);
    expect(diagOn).toContain(`${nOn} 5-hole(s), exhaustive over 12 points`);
  });
});

// k6 driver variant taking an explicit ctx (budget).
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { suppliedFive } from "../strategies/k6driver.ts";
import type { RuntimeCtx } from "../../src/engine/orchestrator.ts";

function playK6GameWith(ctx: RuntimeCtx, rand: () => number): { terminalKind: string | null; points: number } {
  void playK6Game;
  const store = new Store();
  const boot = suppliedFive(rand);
  const started = startSession(
    { kind: "guided", config: { mode: "break", window: ctx.config.window }, strategyId: "esmb-k6", mode: "break", strategyStart: boot },
    ctx,
    store,
  );
  if (started.status !== "accepted") {
    return { terminalKind: `init-rejected:${started.error?.code ?? "?"}`, points: 0 };
  }
  for (let i = 0; i < 6 && store.current().terminal === null; i += 1) {
    const at = P(Math.floor(rand() * 200) - 100, Math.floor(rand() * 200) - 100);
    const r = reduceTransaction(store.current(), { kind: "place", owner: "breaker", at }, ctx);
    if (r.status === "accepted") {
      commit(r, { kind: "place", owner: "breaker", at }, store, ctx);
    }
  }
  const t = store.current().terminal;
  return { terminalKind: t?.kind ?? null, points: store.current().points.length };
}
