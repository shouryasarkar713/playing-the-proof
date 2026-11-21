// @vitest-environment jsdom
// tests/ui/proof.test.ts — Proof mode on the fixture: entry picker, sampled
// stepping to a win, win card, branch variations, keyboard, ARIA, badge.
import { afterEach, describe, expect, it } from "vitest";
import { createShell } from "../../src/ui/app.ts";
import type { Shell } from "../../src/ui/app.ts";
import { mountProof } from "../../src/ui/modes/proof.ts";
import type { ModeHandle } from "../../src/ui/app.ts";
import {
  classifiers,
  registerStrategy,
  strategies,
} from "../../src/strategy/registry.ts";
import { checkers } from "../../src/verification/invariants.ts";
import { fixtureTriangle } from "../../src/strategy/strategies/fixtureTriangle.ts";
import { worldToScreen } from "../../src/viz/projection.ts";
import { pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";

if (!strategies().has(fixtureTriangle.id)) {
  registerStrategy(fixtureTriangle, "fixture");
}

const live = {
  strategies: strategies(),
  classifiers: classifiers(),
  checkers: checkers(),
};

const handles: ModeHandle[] = [];
afterEach(() => {
  while (handles.length > 0) {
    handles.pop()?.destroy();
  }
});

function setup(): { svg: SVGSVGElement; panels: HTMLElement; shell: Shell } {
  document.body.innerHTML = "";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("id", "board");
  const panels = document.createElement("aside");
  panels.setAttribute("id", "panels");
  document.body.append(svg, panels);
  const shell = createShell(svg, panels, {
    width: 800,
    height: 600,
    registries: live,
  });
  return { svg, panels, shell };
}

function textOf(el: HTMLElement | null, selector: string): string | null {
  const found = el?.querySelector(selector);
  return found?.textContent ?? null;
}

function click(el: Element | null | undefined): void {
  el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function sampleButtons(panels: HTMLElement): HTMLButtonElement[] {
  return [...panels.querySelectorAll("#sample-row button")] as HTMLButtonElement[];
}

describe("entry screen (§11.2)", () => {
  it("lists modes, enables Break with a picker, and badges the fixture strategy", () => {
    const { panels, shell } = setup();
    shell.showEntry();
    expect(panels.textContent).toContain("Proof mode");
    expect(panels.textContent).toContain("Break the Proof");
    expect(panels.textContent).toContain("Sandbox");
    const cards = [...panels.querySelectorAll(".mode-card")];
    expect(cards.length).toBe(5);
    expect(cards.every((c) => !c.classList.contains("disabled"))).toBe(true);
    const breakCard = cards.find((c) =>
      c.textContent?.includes("Break the Proof"),
    );
    const breakRow = [...(breakCard?.querySelectorAll(".strategy-row") ?? [])].find((r) =>
      r.textContent?.includes("fixture-triangle"),
    );
    expect(breakRow !== undefined).toBe(true);
    const row = [...panels.querySelectorAll(".strategy-row")].find((r) =>
      r.textContent?.includes("fixture-triangle"),
    );
    expect(row !== undefined).toBe(true);
    expect(row?.querySelector(".status-badge")?.textContent).toBe("fixture");
  });

  it("starting Proof boots the guided session with a sample chip", () => {
    const { panels, shell } = setup();
    shell.showEntry();
    const row = [...panels.querySelectorAll(".strategy-row")].find((r) =>
      r.textContent?.includes("fixture-triangle"),
    );
    const start = row?.querySelector("button");
    expect(start !== undefined).toBe(true);
    click(start ?? null);
    expect(shell.store.current().strategy?.nodeId).toBe("await-b1");
    const chips = sampleButtons(panels);
    expect(chips.length).toBe(2);
    expect(chips[1]?.textContent).toBe("Play fx:any");
  });
});

describe("proof stepping on the fixture", () => {
  function proofSession(): { svg: SVGSVGElement; panels: HTMLElement; shell: Shell } {
    const { svg, panels, shell } = setup();
    handles.push(
      // mountProof returns its handle for teardown.
      mountProof(shell, panels, () => {}, "fixture-triangle"),
    );
    return { svg, panels, shell };
  }

  it("Next samples B1 at the window representative, then wins", () => {
    const { panels, shell } = proofSession();
    const chips = sampleButtons(panels);
    expect(chips.length).toBe(2);
    click(chips[0]); // ⟳ Next = first case sample
    const cur = shell.store.current();
    expect(cur.points.length).toBe(3);
    const b1 = cur.points[1];
    expect(b1?.owner).toBe("breaker");
    expect(b1?.pt.x.toString()).toBe("1000000/3");
    expect(b1?.pt.y.toString()).toBe("-1000000/3");
    expect(cur.terminal?.kind).toBe("maker-won");
    // Win card with honesty + witness.
    const card = panels.querySelector(".win-card");
    expect(card !== null).toBe(true);
    expect(card?.textContent).toContain("Maker wins");
    expect(card?.textContent).toContain("does not by itself constitute the proof");
    expect(card?.textContent).toContain("p1");
    // ARIA live headline + strategy badge from effectiveStatus.
    const why = panels.querySelector("#panel-why");
    expect(why?.getAttribute("aria-live")).toBe("polite");
    expect(textOf(panels, "#panel-why h3")).toBe("3-hole achieved: game over.");
    expect(textOf(panels, "#panel-strategy .status-badge")).toBe("Status: fixture");
    // Timeline: t0 + t1 rows.
    const rows = [...panels.querySelectorAll("#timeline .txn")];
    expect(rows.length).toBe(2);
  });

  it("branching creates a variation with chips", () => {
    const { svg, panels, shell } = proofSession();
    click(sampleButtons(panels)[0]);
    expect(shell.store.tree().transactions.length).toBe(2);
    // Back to t0, place elsewhere → sibling txn.
    const t0row = [...panels.querySelectorAll("#timeline .txn")].find((r) =>
      r.textContent?.includes("t0"),
    );
    click(t0row ?? null);
    expect(shell.store.cursorTxnId()).toBe(0);
    const view = shell.view();
    const s = worldToScreen(pt(Rat.make(100n), Rat.make(100n)), view);
    svg.dispatchEvent(
      new MouseEvent("click", { clientX: s.x, clientY: s.y, bubbles: true }),
    );
    const tree = shell.store.tree();
    expect(tree.transactions.length).toBe(3);
    const chips = [...panels.querySelectorAll("#timeline .chip")];
    expect(chips.length).toBe(2);
  });

  it("keyboard: R restarts, arrows step, C toggles the case map", () => {
    const { svg, panels, shell } = proofSession();
    click(sampleButtons(panels)[0]);
    expect(shell.store.current().points.length).toBe(3);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(shell.store.cursorTxnId()).toBe(0);
    expect(svg.querySelectorAll("circle").length).toBe(1);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(shell.store.cursorTxnId()).toBe(1);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }));
    expect(svg.querySelectorAll("polygon").length).toBeGreaterThan(0);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "r" }));
    expect(shell.store.current().points.length).toBe(1);
    expect(panels.querySelector(".win-card")).toBe(null);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
  });
});
