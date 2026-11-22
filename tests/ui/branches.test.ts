// @vitest-environment jsdom
// tests/ui/branches.test.ts — the verification class of every reply class is shown
// BEFORE a branch is entered (Proof chips, Proof/Break panel), as text, with a legend.
import { afterEach, describe, expect, it } from "vitest";
import { createShell } from "../../src/ui/app.ts";
import type { Shell } from "../../src/ui/app.ts";
import { classifiers, strategies } from "../../src/strategy/registry.ts";
import { checkers } from "../../src/verification/invariants.ts";
import { branchInteractions } from "../../src/engine/describe.ts";
import { esmbK7 } from "../../src/strategy/strategies/k7/def.ts";
import { esmbK8 } from "../../src/strategy/strategies/k8/def.ts";
import { lintStrings } from "../../src/explain/claimlint.ts";
import { BRANCH_LABEL, BRANCH_MEANING } from "../../src/ui/panels/branches.ts";
import { dispatch } from "../../src/ui/dispatch.ts";
import { pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";
import { ensureK5 } from "../strategies/k5driver.ts";
import { ensureK7 } from "../strategies/k7driver.ts";
import { ensureK8 } from "../strategies/k8driver.ts";

ensureK5();
ensureK7();
ensureK8();

const live = { strategies: strategies(), classifiers: classifiers(), checkers: checkers() };

function setup(): { panels: HTMLElement; shell: Shell } {
  document.body.innerHTML = "";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("id", "board");
  const panels = document.createElement("aside");
  panels.setAttribute("id", "panels");
  document.body.append(svg, panels);
  const shell = createShell(svg, panels, { width: 800, height: 600, registries: live });
  return { panels, shell };
}

afterEach(() => {
  document.body.innerHTML = "";
});

const chips = (panels: HTMLElement): HTMLButtonElement[] =>
  [...panels.querySelectorAll("#sample-row button")] as HTMLButtonElement[];

describe("interaction labels (k=8)", () => {
  it("Proof: the first reply classes are listed with Interactive / Guided / Not encoded before any is entered", () => {
    const { panels, shell } = setup();
    shell.startProof("esmb-k8");
    const section = panels.querySelector("#panel-branches") as HTMLElement;
    expect(section.hidden).toBe(false);
    const items = [...section.querySelectorAll("li")].map((li) => li.textContent ?? "");
    expect(items).toEqual([
      "Interactive k8:b0:outside-heptagon",
      "Guided k8:b0:inside-pair",
      "Not encoded k8:b0:inside-no-pair",
    ]);
    expect(section.querySelector(".branch-legend")?.textContent).toContain("Not encoded");
    for (const li of section.querySelectorAll("li")) {
      expect(li.getAttribute("aria-label")).toMatch(/Interactive|Guided|Not encoded/);
    }
  }, 120000);

  it("Proof sample chips carry the class in their text and accessible name", () => {
    const { panels, shell } = setup();
    shell.startProof("esmb-k8");
    const labels = chips(panels).map((b) => b.textContent ?? "");
    expect(labels.some((t) => t === "Play k8:b0:outside-heptagon (Interactive)")).toBe(true);
    expect(labels.some((t) => t === "Play k8:b0:inside-pair (Guided)")).toBe(true);
    const guided = chips(panels).find((b) => b.textContent === "Play k8:b0:inside-pair (Guided)");
    expect(guided?.getAttribute("aria-label")).toBe("Play k8:b0:inside-pair, Guided");
  }, 120000);

  it("after entering the guided branch the next classify node lists its own classes", () => {
    const { panels, shell } = setup();
    shell.startProof("esmb-k8");
    // B0 = centroid of A, C, E, F of the preset heptagon (inside, with a chord-half pair)
    dispatch(
      shell.store,
      shell.ctx,
      { kind: "place", owner: "breaker", at: pt(Rat.make(12n), Rat.make(33n, 2n)) },
      () => undefined,
    );
    const items = [...panels.querySelectorAll("#panel-branches li")].map((li) => li.textContent ?? "");
    expect(items).toEqual([
      "Guided k8:b1:inside-shared-triangle",
      "Not encoded k8:b1:elsewhere",
    ]);
  }, 120000);

  it("Break mode shows the same panel", () => {
    const { panels, shell } = setup();
    shell.startBreak("esmb-k8");
    const items = [...panels.querySelectorAll("#panel-branches li")].map((li) => li.textContent ?? "");
    expect(items.length).toBe(3);
    expect(items[0]).toBe("Interactive k8:b0:outside-heptagon");
  }, 120000);
});

describe("interaction labels (k=7 and others)", () => {
  it("k=7: every reply class is Interactive", () => {
    const { panels, shell } = setup();
    shell.startProof("esmb-k7");
    const items = [...panels.querySelectorAll("#panel-branches li")].map((li) => li.textContent ?? "");
    expect(items.length).toBe(9);
    expect(items.every((t) => t.startsWith("Interactive "))).toBe(true);
    const labelled = chips(panels).filter((b) => (b.textContent ?? "").endsWith("(Interactive)"));
    expect(labelled.length).toBeGreaterThan(0);
  }, 120000);

  it("strategies that declare no classes (k=5) show no panel and unchanged chips", () => {
    const { panels, shell } = setup();
    shell.startProof("esmb-k5");
    expect((panels.querySelector("#panel-branches") as HTMLElement).hidden).toBe(true);
    expect(chips(panels).every((b) => !/\((Interactive|Guided|Not encoded)\)/.test(b.textContent ?? ""))).toBe(true);
  }, 120000);

  it("branchInteractions is null for a terminal or an unparked state and every k7/k8 route declares a class", () => {
    for (const def of [esmbK7, esmbK8]) {
      for (const n of Object.values(def.nodes)) {
        for (const r of n.routes ?? []) {
          expect(r.interaction, `${def.id} ${r.case}`).toBeDefined();
        }
      }
    }
    expect(branchInteractions({ strategy: null, terminal: null } as never, { strategies: strategies() } as never)).toBeNull();
  }, 120000);

  it("legend and meaning strings are ClaimLint-clean", () => {
    expect(lintStrings([...Object.values(BRANCH_LABEL), ...Object.values(BRANCH_MEANING)])).toEqual([]);
  }, 120000);
});
