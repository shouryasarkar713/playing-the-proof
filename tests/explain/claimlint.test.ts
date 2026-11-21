// tests/explain/claimlint.test.ts — ClaimLint over shipped string sources
// (Phase-17 scope: templates + every registered def's why fields + About
// + badges + terminal cards) + bite control.
import { describe, expect, it } from "vitest";
import { lintSources, lintStrings } from "../../src/explain/claimlint.ts";
import {
  HONESTY_BUDGET_EXHAUSTED,
  HONESTY_STATEMENT,
  HONESTY_WITNESS_ONLY,
  UNCOVERED_TEMPLATES,
} from "../../src/explain/templates.ts";
import { ABOUT_SECTIONS } from "../../src/explain/about.ts";
import {
  nodeExplanation,
  statusBadge,
  uncoveredCard,
  winCard,
} from "../../src/engine/describe.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import type { GameState } from "../../src/game/types.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { strategies } from "../../src/strategy/registry.ts";
import { fixtureTriangle } from "../../src/strategy/strategies/fixtureTriangle.ts";
import { registerStrategy } from "../../src/strategy/registry.ts";
import { ensureK5 } from "../strategies/k5driver.ts";
import { P, ensureK6 } from "../strategies/k6driver.ts";
import { testCtx } from "../helpers.ts";

if (!strategies().has(fixtureTriangle.id)) {
  registerStrategy(fixtureTriangle, "fixture");
}
ensureK5();
ensureK6();

describe("ClaimLint (§13.1, §26F)", () => {
  it("passes templates + fixed sentences + every registered def's why fields", () => {
    const sources: Array<{ text: string; tier?: never; ref?: never }> = [
      { text: HONESTY_WITNESS_ONLY },
      { text: HONESTY_BUDGET_EXHAUSTED },
      { text: HONESTY_STATEMENT },
      ...UNCOVERED_TEMPLATES.map((t) => ({ text: t.text })),
    ];
    for (const rs of strategies().values()) {
      for (const node of Object.values(rs.def.nodes)) {
        sources.push({ text: node.why.headline });
        for (const claim of node.why.claims) {
          sources.push({ text: claim.text });
        }
        for (const claim of node.why.threats ?? []) {
          sources.push({ text: claim.text });
        }
        for (const note of node.why.invariantNotes ?? []) {
          sources.push({ text: note.text });
        }
      }
    }
    expect(lintSources(sources)).toEqual([]);
  });

  it("passes About + badges + terminal cards", () => {
    const sources: Array<{ text: string }> = [];
    for (const section of ABOUT_SECTIONS) {
      sources.push({ text: section.heading });
      for (const para of section.body) {
        sources.push({ text: para });
      }
    }
    // Live badge + win card + interpolated uncovered cards + a node
    // explanation with evidence (blunder win + parked classify).
    const store = new Store();
    const ctx = testCtx();
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
      throw new Error("claimlint: k5 start rejected — test bug");
    }
    const badgeLive = statusBadge(store.current(), ctx);
    if (badgeLive !== null) {
      sources.push({ text: badgeLive.text }, { text: badgeLive.title });
    }
    const drive = (at: Pt): void => {
      const r = reduceTransaction(store.current(), { kind: "place", owner: "breaker", at }, ctx);
      if (r.status !== "accepted") {
        throw new Error("claimlint: placement rejected — test bug");
      }
      commit(r, { kind: "place", owner: "breaker", at }, store, ctx);
    };
    drive(P(10, 0));
    const expl = nodeExplanation(store.current(), ctx);
    if (expl !== null) {
      sources.push({ text: expl.headline });
      for (const claim of [...expl.claims, ...expl.threats, ...expl.invariantNotes]) {
        sources.push({ text: claim.text });
      }
      for (const ev of expl.evidence) {
        sources.push({ text: `${ev.predicate}(${ev.operands}) → ${ev.result}` });
      }
    }
    drive(P(30, 5));
    const card = winCard(store.current());
    if (card !== null) {
      sources.push(
        { text: card.title },
        { text: card.stats },
        { text: card.honesty },
      );
      for (const w of card.witnesses) {
        sources.push({ text: w });
      }
    }
    const uncovered: Extract<GameState["terminal"], { kind: "uncovered" }> = {
      kind: "uncovered",
      report: {
        origin: "maker-construction",
        reason: "window-exhausted",
        at: { nodeId: "k5:r4:extend", move: { kind: "extend-hole" } },
        detail: "no admissible placement inside the window",
      },
    };
    sources.push({ text: uncoveredCard(uncovered, "esmb-k5", ctx) });
    expect(lintSources(sources)).toEqual([]);
  });

  it("structured theorem-cited claims with ref are whitelisted", () => {
    expect(
      lintSources([
        {
          text: "Das–Valla prove Maker wins for k ≤ 8.",
          tier: "theorem-cited",
          ref: "Das–Valla, Theorem 1",
        },
      ]),
    ).toEqual([]);
  });

  it("scoped exhaustive statements are whitelisted; bare ones fail", () => {
    expect(
      lintStrings(["3 5-holes, exhaustive over 29 points"]),
    ).toEqual([]);
    const hits = lintStrings(["this proves the exhaustive list"]);
    expect(hits.length).toBeGreaterThan(0);
  });

  it("bites on forbidden words (negative control)", () => {
    const hits = lintStrings(["Maker guarantees victory always"]);
    expect(hits.map((h) => h.word).sort()).toEqual(["always", "guarantees"]);
  });
});
