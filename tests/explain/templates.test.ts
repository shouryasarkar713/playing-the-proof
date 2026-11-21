// tests/explain/templates.test.ts — string-level snapshots of every
// explanation template against golden files (Phase 17): uncovered cards
// (fully interpolated — no raw brackets), honesty sentences, the win
// card, the status badge, the About text, and two node explanations
// with live evidence. Any golden change is a deliberate diff.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import type { GameState } from "../../src/game/types.ts";
import {
  nodeExplanation,
  statusBadge,
  uncoveredCard,
  winCard,
} from "../../src/engine/describe.ts";
import {
  HONESTY_BUDGET_EXHAUSTED,
  HONESTY_STATEMENT,
  HONESTY_WITNESS_ONLY,
} from "../../src/explain/templates.ts";
import { ABOUT_SECTIONS, ABOUT_TITLE } from "../../src/explain/about.ts";
import { ensureK5 } from "../strategies/k5driver.ts";
import { P } from "../strategies/k6driver.ts";
import { testCtx } from "../helpers.ts";

ensureK5();

const GOLD = join(dirname(fileURLToPath(import.meta.url)), "goldens");

function golden(name: string): string {
  return readFileSync(join(GOLD, name), "utf8");
}

function drive(moves: readonly Pt[]): { store: Store; ctx: ReturnType<typeof testCtx> } {
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
    throw new Error("templates: k5 start rejected — test bug");
  }
  for (const at of moves) {
    const r = reduceTransaction(store.current(), { kind: "place", owner: "breaker", at }, ctx);
    if (r.status !== "accepted") {
      throw new Error("templates: placement rejected — test bug");
    }
    commit(r, { kind: "place", owner: "breaker", at }, store, ctx);
  }
  return { store, ctx };
}

function renderAbout(): string {
  return [
    ABOUT_TITLE,
    ...ABOUT_SECTIONS.flatMap((s) => [`## ${s.heading}`, ...s.body]),
  ].join("\n");
}

describe("explanation template goldens (Phase 17)", () => {
  it("uncovered cards interpolate every bracket", () => {
    const ctx = testCtx();
    const partial: Extract<GameState["terminal"], { kind: "uncovered" }> = {
      kind: "uncovered",
      report: {
        origin: "breaker-reply",
        reason: "partial-encoding",
        at: { nodeId: "k5:r3:classify", breakerPoint: "p6" },
        detail: "intended 4-hole blocked",
      },
    };
    const expdis: Extract<GameState["terminal"], { kind: "uncovered" }> = {
      kind: "uncovered",
      report: {
        origin: "breaker-reply",
        reason: "experimental-disabled",
        at: { nodeId: "k6:boot", breakerPoint: "p8" },
        detail: "ear zone",
      },
    };
    const winex: Extract<GameState["terminal"], { kind: "uncovered" }> = {
      kind: "uncovered",
      report: {
        origin: "maker-construction",
        reason: "window-exhausted",
        at: { nodeId: "k5:r4:extend", move: { kind: "extend-hole" } },
        detail: "no admissible placement inside the window",
      },
    };
    const cards = [
      uncoveredCard(partial, "esmb-k5", ctx),
      uncoveredCard(expdis, "esmb-k6-wide", ctx),
      uncoveredCard(winex, "esmb-k5", ctx),
    ];
    for (const card of cards) {
      expect(card).not.toContain("[");
    }
    expect(cards[0]).toBe(golden("uncovered.partialEncoding.txt"));
    expect(cards[1]).toBe(golden("uncovered.experimentalDisabled.txt"));
    expect(cards[2]).toBe(golden("uncovered.makerConstruction.windowExhausted.txt"));
  });

  it("honesty sentences are pinned", () => {
    expect(HONESTY_WITNESS_ONLY).toBe(golden("honesty.witnessOnly.txt"));
    expect(HONESTY_BUDGET_EXHAUSTED).toBe(golden("honesty.budgetExhausted.txt"));
    expect(HONESTY_STATEMENT).toBe(golden("honesty.statement.txt"));
  });

  it("win card + badge are pinned", () => {
    const { store } = drive([P(10, 0), P(30, 5)]);
    const card = winCard(store.current());
    expect(card !== null).toBe(true);
    expect(card).toEqual(JSON.parse(golden("wincard.k5-blunder.json")));
    const { store: live, ctx: liveCtx } = drive([P(10, 0)]);
    const badge = statusBadge(live.current(), liveCtx);
    expect(badge !== null).toBe(true);
    expect(`${badge?.text}\n${badge?.title}`).toBe(golden("badge.esmb-k5.txt"));
  });

  it("node explanations with live evidence are pinned", () => {
    const { store, ctx } = drive([P(10, 0), pt(Rat.make(10n), Rat.make(9n))]);
    expect(nodeExplanation(store.current(), ctx)).toEqual(
      JSON.parse(golden("explanation.k5-r3-classify.json")),
    );
    const won = drive([P(10, 0), P(30, 5)]);
    expect(nodeExplanation(won.store.current(), won.ctx)).toEqual(
      JSON.parse(golden("explanation.k5-win.json")),
    );
  });

  it("About text is pinned", () => {
    expect(renderAbout()).toBe(golden("about.txt"));
  });
});
