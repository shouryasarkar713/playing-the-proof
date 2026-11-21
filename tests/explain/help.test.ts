// @vitest-environment jsdom
// tests/explain/help.test.ts — Help page behavior + content pin (Phase 19):
// entry links to Help; all four sections render; Back returns; the text
// matches the golden; every string is ClaimLint-clean.
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createShell } from "../../src/ui/app.ts";
import type { Shell } from "../../src/ui/app.ts";
import {
  classifiers,
  strategies,
} from "../../src/strategy/registry.ts";
import { checkers } from "../../src/verification/invariants.ts";
import { HELP_SECTIONS, HELP_TITLE } from "../../src/explain/help.ts";
import { lintSources } from "../../src/explain/claimlint.ts";

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

function renderHelp(): string {
  return [
    HELP_TITLE,
    ...HELP_SECTIONS.flatMap((s) => [`## ${s.heading}`, ...s.body]),
  ].join("\n");
}

describe("Help page (Phase 19)", () => {
  it("entry links to Help; all sections render; Back returns", () => {
    const { panels } = setup();
    const helpBtn = [...panels.querySelectorAll("button")].find(
      (b) => b.textContent === "Help",
    );
    expect(helpBtn !== undefined).toBe(true);
    helpBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const help = panels.querySelector("#help");
    expect(help !== null).toBe(true);
    const heads = [...(help?.querySelectorAll("h2") ?? [])].map((h) => h.textContent);
    expect(heads).toEqual(["Rules", "Modes", "Legend", "Keyboard"]);
    const back = [...(help?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === "Back",
    );
    expect(back !== undefined).toBe(true);
    back?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(panels.querySelector("#help")).toBe(null);
    expect(panels.querySelector("#entry") !== null).toBe(true);
  });

  it("Help text is pinned + ClaimLint-clean", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "goldens");
    expect(renderHelp()).toBe(readFileSync(join(dir, "help.txt"), "utf8"));
    const sources = HELP_SECTIONS.flatMap((s) => [
      { text: s.heading },
      ...s.body.map((text) => ({ text })),
    ]);
    expect(lintSources(sources)).toEqual([]);
  });
});
