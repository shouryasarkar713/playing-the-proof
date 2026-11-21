// @vitest-environment jsdom
// tests/explain/about.test.ts — About page behavior (Phase 17): the entry
// screen links to About; About renders every section with the honesty
// statement, the k-strip disambiguation, and citations; Back returns to
// entry. Content strings are pinned in templates.test.ts goldens.
import { afterEach, describe, expect, it } from "vitest";
import { createShell } from "../../src/ui/app.ts";
import type { Shell } from "../../src/ui/app.ts";
import {
  classifiers,
  strategies,
} from "../../src/strategy/registry.ts";
import { checkers } from "../../src/verification/invariants.ts";
import { HONESTY_STATEMENT } from "../../src/explain/templates.ts";

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
  shell.showEntry();
  return { panels, shell };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("About page (Phase 17)", () => {
  it("entry links to About; About renders all sections; Back returns", () => {
    const { panels } = setup();
    const aboutBtn = [...panels.querySelectorAll("button")].find(
      (b) => b.textContent === "About",
    );
    expect(aboutBtn !== undefined).toBe(true);
    aboutBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const about = panels.querySelector("#about");
    expect(about !== null).toBe(true);
    const heads = [...(about?.querySelectorAll("h2") ?? [])].map((h) => h.textContent);
    expect(heads).toEqual([
      "What this is",
      "Sources",
      "Figure and data credits",
      "Honesty and validation scope",
      "Research modes",
      "Growth strips",
    ]);
    expect(about?.textContent).toContain(HONESTY_STATEMENT);
    expect(about?.textContent).toContain("Definition 2");
    expect(about?.textContent).toContain("10.57717/cgt.v5i2.73");
    const back = [...(about?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === "Back",
    );
    expect(back !== undefined).toBe(true);
    back?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(panels.querySelector("#about")).toBe(null);
    expect(panels.querySelector("#entry") !== null).toBe(true);
  });
});
