// @vitest-environment jsdom
// tests/ui/keyboard.test.ts — keyboard map walkthrough (Phase 19, DoD
// a11y pass): every bound key produces its documented effect in proof
// and break modes; typing suspends shortcuts; a full game runs with
// placements on the engine path and everything else on keys.
import { afterEach, describe, expect, it } from "vitest";
import { createShell } from "../../src/ui/app.ts";
import type { Shell } from "../../src/ui/app.ts";
import {
  classifiers,
  strategies,
} from "../../src/strategy/registry.ts";
import { checkers } from "../../src/verification/invariants.ts";
import { dispatch } from "../../src/ui/dispatch.ts";
import { ensureK5 } from "../strategies/k5driver.ts";
import { P } from "../strategies/k6driver.ts";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";

ensureK5();

const live = {
  strategies: strategies(),
  classifiers: classifiers(),
  checkers: checkers(),
};

function setup(): { panels: HTMLElement; shell: Shell } {
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
  return { panels, shell };
}

afterEach(() => {
  document.body.innerHTML = "";
});

function key(k: string, target?: Element): void {
  const el = target ?? document.body;
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
}

function noop(): void {}

describe("keyboard map (Phase 19)", () => {
  it("proof: overlays, restart, branch note, menu", () => {
    const { panels, shell } = setup();
    shell.startProof("esmb-k5");
    const before = shell.overlays();
    key("1");
    expect(shell.overlays().hull).toBe(!before.hull);
    key("c");
    expect(shell.overlays().casemap).toBe(true);
    dispatch(shell.store, shell.ctx, { kind: "place", owner: "breaker", at: P(10, 0) }, noop);
    expect(shell.store.current().points.length).toBe(3);
    key("r");
    expect(shell.store.current().points.length).toBe(1);
    key("b");
    expect(panels.querySelector("#toasts")?.textContent).toContain("Branched here");
    key("m");
    expect(panels.querySelector("#entry") !== null).toBe(true);
  });

  it("proof: Space/Escape/arrows act on timeline and menu", () => {
    const { panels, shell } = setup();
    shell.startProof("esmb-k5");
    dispatch(shell.store, shell.ctx, { kind: "place", owner: "breaker", at: P(10, 0) }, noop);
    key("ArrowLeft");
    expect(shell.store.cursorTxnId()).toBe(0);
    key("ArrowRight");
    expect(shell.store.cursorTxnId()).toBe(1);
    key(" ");
    key(" ");
    key("Escape");
    expect(panels.querySelector("#entry") !== null).toBe(true);
  });

  it("break: navigation and menu without autoplay", () => {
    const { panels, shell } = setup();
    shell.startBreak("esmb-k5");
    dispatch(shell.store, shell.ctx, { kind: "place", owner: "breaker", at: P(10, 0) }, noop);
    key("ArrowLeft");
    expect(shell.store.cursorTxnId()).toBe(0);
    key(" ");
    expect(shell.store.cursorTxnId()).toBe(0);
    key("m");
    expect(panels.querySelector("#entry") !== null).toBe(true);
  });

  it("typing suspends shortcuts", () => {
    const { panels, shell } = setup();
    shell.startProof("esmb-k5");
    const input = document.createElement("input");
    panels.appendChild(input);
    key("m", input);
    expect(panels.querySelector("#entry")).toBe(null);
    expect(panels.querySelector("#timeline") !== null).toBe(true);
  });

  it("full game by keys + engine placements, then menu", () => {
    const { panels, shell } = setup();
    shell.startProof("esmb-k5");
    dispatch(shell.store, shell.ctx, { kind: "place", owner: "breaker", at: P(10, 0) }, noop);
    dispatch(
      shell.store, shell.ctx,
      { kind: "place", owner: "breaker", at: pt(Rat.make(10n), Rat.make(9n)) },
      noop,
    );
    dispatch(shell.store, shell.ctx, { kind: "place", owner: "breaker", at: P(-30, -30) }, noop);
    expect(shell.store.current().terminal?.kind).toBe("maker-won");
    key("ArrowLeft");
    expect(shell.store.current().terminal).toBe(null);
    key("ArrowRight");
    expect(shell.store.current().terminal?.kind).toBe("maker-won");
    key("m");
    expect(panels.querySelector("#entry") !== null).toBe(true);
  });
});
