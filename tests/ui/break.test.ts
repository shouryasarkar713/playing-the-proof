// @vitest-environment jsdom
// tests/ui/break.test.ts — Break-the-Proof mode (§12) on esmb-k5: entry,
// threat preview, attack flow with chips/diff/log, blunder branch,
// keyboard, branching, uncovered panel (exact corners via dispatch).
import { afterEach, describe, expect, it } from "vitest";
import { createShell } from "../../src/ui/app.ts";
import type { Shell } from "../../src/ui/app.ts";
import type { ModeHandle } from "../../src/ui/app.ts";
import { mountBreak } from "../../src/ui/modes/break.ts";
import {
  classifiers,
  strategies,
} from "../../src/strategy/registry.ts";
import { checkers } from "../../src/verification/invariants.ts";
import { fixtureTriangle } from "../../src/strategy/strategies/fixtureTriangle.ts";
import { registerStrategy } from "../../src/strategy/registry.ts";
import { ensureK5 } from "../strategies/k5driver.ts";
import { ensureK6 } from "../strategies/k6driver.ts";
import { worldToScreen } from "../../src/viz/projection.ts";
import { pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { dispatch } from "../../src/ui/dispatch.ts";

if (!strategies().has(fixtureTriangle.id)) {
  registerStrategy(fixtureTriangle, "fixture");
}
ensureK5();
ensureK6();

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

function P(x: number, y: number): Pt {
  return pt(Rat.make(BigInt(x)), Rat.make(BigInt(y)));
}

function breakSession(): { svg: SVGSVGElement; panels: HTMLElement; shell: Shell } {
  const s = setup();
  handles.push(mountBreak(s.shell, s.panels, () => {}, "esmb-k5"));
  return s;
}

function clickAt(svg: SVGSVGElement, shell: Shell, at: Pt): void {
  const view = shell.view();
  const s = worldToScreen(at, view);
  svg.dispatchEvent(
    new MouseEvent("click", { clientX: s.x, clientY: s.y, bubbles: true }),
  );
}

function hoverAt(svg: SVGSVGElement, shell: Shell, at: Pt): void {
  const view = shell.view();
  const s = worldToScreen(at, view);
  svg.dispatchEvent(
    new MouseEvent("mousemove", { clientX: s.x, clientY: s.y, bubbles: true }),
  );
}

function threatLine(panels: HTMLElement): string {
  return panels.querySelector("#threat-line")?.textContent ?? "";
}

function logText(panels: HTMLElement): string {
  return panels.querySelector("#attack-log")?.textContent ?? "";
}

describe("break entry (§11.2/§12)", () => {
  it("Break card lists strategies and starts a break session", () => {
    const { panels, shell } = setup();
    shell.showEntry();
    const breakCard = [...panels.querySelectorAll(".mode-card")].find((c) =>
      c.textContent?.includes("Break the Proof"),
    );
    expect(breakCard !== undefined).toBe(true);
    expect(breakCard?.classList.contains("disabled")).toBe(false);
    const row = [...(breakCard?.querySelectorAll(".strategy-row") ?? [])].find((r) =>
      r.textContent?.includes("esmb-k5"),
    );
    expect(row !== undefined).toBe(true);
    expect(row?.querySelector(".status-badge")?.textContent).toBe("validated-randomized");
    row?.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(shell.store.current().strategy?.strategyId).toBe("esmb-k5");
    expect(shell.store.current().strategy?.nodeId).toBe("k5:await-b1");
    expect(panels.querySelector("#honesty-footer")?.textContent).toContain(
      "You are testing the encoded strategy.",
    );
  });
});

describe("break attack flow on k5", () => {
  it("B1 click → threat preview → B2 click → log, chip, outcome, summary", () => {
    const { svg, panels, shell } = breakSession();
    clickAt(svg, shell, P(10, 0));
    expect(shell.store.current().strategy?.nodeId).toBe("k5:r2:classify");
    // Threat preview on hover (no placement).
    hoverAt(svg, shell, P(10, 9));
    expect(threatLine(panels)).toBe(
      "Case k5:b2:one-interior → The co-shoulder trapezoid.",
    );
    // Wedge point previews the same case (unified reading).
    hoverAt(svg, shell, P(10, -10));
    expect(threatLine(panels)).toContain("Case k5:b2:one-interior");
    // Attack.
    clickAt(svg, shell, P(10, 9));
    const cur = shell.store.current();
    expect(cur.strategy?.nodeId).toBe("k5:r3:classify");
    expect(cur.strategy?.lastCase).toBe("k5:b2:one-interior");
    // Attack log: two entries with cases + diff claims.
    const log = logText(panels);
    expect(log).toContain("k5:any");
    expect(log).toContain("k5:b2:one-interior");
    expect(log).toContain("destroyed");
    expect(log).toContain("survived");
    // Board chip on the latest Breaker point.
    const chips = [...svg.querySelectorAll("text")].map((t) => t.textContent);
    expect(chips).toContain("k5:b2:one-interior");
    // Why panel carries the attack outcome (§12.3).
    const why = panels.querySelector("#panel-why")?.textContent ?? "";
    expect(why).toContain("Attack outcome");
    expect(why).toContain("classified k5:b2:one-interior");
    expect(why).toContain("Invariants after the reply:");
    // Summary line.
    const summary = panels.querySelector("#summary-line")?.textContent ?? "";
    expect(summary).toContain("Attacks: 2 classified");
  });

  it("B3 finishes the win card with honesty + summary", () => {
    const { svg, panels, shell } = breakSession();
    clickAt(svg, shell, P(10, 0));
    clickAt(svg, shell, P(10, 9));
    dispatch(shell.store, shell.ctx, { kind: "place", owner: "breaker", at: P(-30, -30) }, () => {});
    expect(shell.store.current().terminal?.kind).toBe("maker-won");
    const card = panels.querySelector(".terminal-card")?.textContent ?? "";
    expect(card).toContain("Maker wins");
    expect(card).toContain("does not by itself constitute the proof");
    const summary = panels.querySelector("#summary-line")?.textContent ?? "";
    expect(summary).toContain("wins 1");
  });

  it("blunder branch: convex B2 → round-3 win, log records it", () => {
    const { svg, panels, shell } = breakSession();
    clickAt(svg, shell, P(10, 0));
    clickAt(svg, shell, P(30, 5));
    const cur = shell.store.current();
    expect(cur.strategy?.lastCase).toBe("k5:b2:convex");
    expect(cur.terminal?.kind).toBe("maker-won");
    expect(cur.points.length).toBe(5);
    expect(logText(panels)).toContain("k5:b2:convex");
    const summary = panels.querySelector("#summary-line")?.textContent ?? "";
    expect(summary).toContain("wins 1");
  });

  it("keyboard: R restarts, C washes the case map", () => {
    const { svg, panels, shell } = breakSession();
    clickAt(svg, shell, P(10, 0));
    clickAt(svg, shell, P(10, 9));
    expect(shell.store.current().points.length).toBe(5);
    const before = svg.querySelectorAll("polygon").length;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }));
    const after = svg.querySelectorAll("polygon").length;
    expect(after).toBeGreaterThan(before);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "r" }));
    expect(shell.store.current().points.length).toBe(1);
    expect(logText(panels)).toContain("No attacks yet");
  });

  it("rewind + retry creates a branch variation with chips", () => {
    const { svg, panels, shell } = breakSession();
    clickAt(svg, shell, P(10, 0));
    expect(shell.store.tree().transactions.length).toBe(2);
    const t0row = [...panels.querySelectorAll("#timeline .txn")].find((r) =>
      r.textContent?.includes("t0"),
    );
    t0row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(shell.store.cursorTxnId()).toBe(0);
    clickAt(svg, shell, P(5, 7));
    expect(shell.store.tree().transactions.length).toBe(3);
    const chips = [...panels.querySelectorAll("#timeline .chip")];
    expect(chips.length).toBe(2);
    const summary = panels.querySelector("#summary-line")?.textContent ?? "";
    expect(summary).toContain("retries 1");
  });
});

describe("break uncovered panel (boundary quad)", () => {
  it("exact-corner attack renders the window-exhausted panel + log", () => {
    const { panels, shell } = setup();
    shell.ctx.config.window = {
      xMin: Rat.make(0n),
      yMin: Rat.make(0n),
      xMax: Rat.make(20n),
      yMax: Rat.make(28n),
    };
    handles.push(mountBreak(shell, panels, () => {}, "esmb-k5"));
    dispatch(shell.store, shell.ctx, { kind: "place", owner: "breaker", at: P(0, 28) }, () => {});
    dispatch(shell.store, shell.ctx, { kind: "place", owner: "breaker", at: P(20, 0) }, () => {});
    expect(shell.store.current().terminal?.kind).toBe("uncovered");
    const card = panels.querySelector(".terminal-card")?.textContent ?? "";
    expect(card).toContain("Outside the encoding's coverage");
    expect(card).toContain("every admissible placement falls outside");
    const summary = panels.querySelector("#summary-line")?.textContent ?? "";
    expect(summary).toContain("uncovered 1");
    expect(logText(panels)).toContain("k5:b2:convex");
  });
});

describe("break k6 entry + promotion (§24.0b, §11.7)", () => {
  it("entry lists esmb-k6 (validated-randomized); Start boots the preset at k6:boot", () => {
    const { panels, shell } = setup();
    shell.showEntry();
    const breakCard = [...panels.querySelectorAll(".mode-card")].find((c) =>
      c.textContent?.includes("Break the Proof"),
    );
    const row = [...(breakCard?.querySelectorAll(".strategy-row") ?? [])].find((r) =>
      r.textContent?.includes("esmb-k6"),
    );
    expect(row !== undefined).toBe(true);
    expect(row?.querySelector(".status-badge")?.textContent).toBe("validated-randomized");
    row?.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const cur = shell.store.current();
    expect(cur.strategy?.strategyId).toBe("esmb-k6");
    expect(cur.strategy?.nodeId).toBe("k6:boot");
    expect(cur.points.length).toBe(5);
    expect(cur.turn).toBe("breaker");
  });

  it("experimental k6-wide hides behind the toggle", () => {
    const { panels, shell } = setup();
    shell.showEntry();
    const breakCard = [...panels.querySelectorAll(".mode-card")].find((c) =>
      c.textContent?.includes("Break the Proof"),
    );
    const rows = [...(breakCard?.querySelectorAll(".strategy-row") ?? [])].map(
      (r) => r.textContent ?? "",
    );
    expect(rows.some((t) => t.includes("esmb-k6-wide"))).toBe(false);
    const toggle = breakCard?.querySelector("input[type=checkbox]") as HTMLInputElement | null;
    expect(toggle !== null).toBe(true);
    if (toggle !== null) {
      toggle.checked = true;
      toggle.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const rows2 = [...(breakCard?.querySelectorAll(".strategy-row") ?? [])].map(
      (r) => r.textContent ?? "",
    );
    const wideRow = rows2.find((t) => t.includes("esmb-k6-wide"));
    expect(wideRow !== undefined).toBe(true);
    expect(wideRow).toContain("experimental-extension");
  });

  it("k5 win card offers Grow to 6; promotion parks a 7-point k6 boot", () => {
    const { svg, panels, shell } = breakSession();
    clickAt(svg, shell, P(10, 0));
    clickAt(svg, shell, P(10, 9));
    dispatch(shell.store, shell.ctx, { kind: "place", owner: "breaker", at: P(-30, -30) }, () => {});
    expect(shell.store.current().terminal?.kind).toBe("maker-won");
    const grow = [...panels.querySelectorAll(".terminal-card button")].find(
      (b) => b.textContent === "Grow to 6",
    );
    expect(grow !== undefined).toBe(true);
    grow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const cur = shell.store.current();
    expect(cur.strategy?.strategyId).toBe("esmb-k6");
    expect(cur.strategy?.nodeId).toBe("k6:boot");
    expect(cur.points.length).toBe(7);
    expect(cur.terminal).toBe(null);
    expect((cur.strategy?.vars["P5"] as string[]).length).toBe(5);
  });
});
