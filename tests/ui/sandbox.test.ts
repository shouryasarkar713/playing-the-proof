// @vitest-environment jsdom
// tests/ui/sandbox.test.ts — sandbox v0 by hand: place both colors, see
// hull + hole analysis, illegal-click honesty, undo/reset.
import { describe, expect, it } from "vitest";
import { createShell } from "../../src/ui/app.ts";
import type { Shell } from "../../src/ui/app.ts";
import {
  classifiers,
  strategies,
} from "../../src/strategy/registry.ts";
import { checkers } from "../../src/verification/invariants.ts";
import { ensureK5 } from "../strategies/k5driver.ts";
import { ensureK6 } from "../strategies/k6driver.ts";
import { worldToScreen } from "../../src/viz/projection.ts";
import { pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";

ensureK5();
ensureK6();

function setup(): {
  svg: SVGSVGElement;
  panels: HTMLElement;
  shell: Shell;
  byText: (tag: string, text: string) => HTMLElement | null;
} {
  document.body.innerHTML = "";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("id", "board");
  const panels = document.createElement("aside");
  panels.setAttribute("id", "panels");
  document.body.append(svg, panels);
  const shell = createShell(svg, panels, {
    width: 800,
    height: 600,
    registries: { strategies: strategies(), classifiers: classifiers(), checkers: checkers() },
  });
  shell.startSandbox();
  const byText = (tag: string, text: string): HTMLElement | null => {
    for (const el of panels.getElementsByTagName(tag)) {
      if (el.textContent === text) {
        return el as HTMLElement;
      }
    }
    return null;
  };
  return { svg, panels, shell, byText };
}

function click(svg: SVGSVGElement, clientX: number, clientY: number): void {
  svg.dispatchEvent(
    new MouseEvent("click", { clientX, clientY, bubbles: true }),
  );
}

function circles(svg: SVGSVGElement): number {
  return svg.querySelectorAll("circle").length;
}

function polygons(svg: SVGSVGElement): number {
  return svg.querySelectorAll("polygon").length;
}

describe("sandbox v0", () => {
  it("mounts an empty board (window rect only)", () => {
    const { svg } = setup();
    expect(svg.querySelectorAll("rect").length).toBe(1);
    expect(circles(svg)).toBe(0);
  });

  it("click places a Maker disc; diagnostics count it", () => {
    const { svg, panels } = setup();
    click(svg, 400, 300);
    expect(circles(svg)).toBe(1);
    const diag = panels.querySelector("#sandbox-diagnostics");
    expect(diag?.textContent).toContain("points: 1");
  });

  it("breaker toggle places a diamond; re-click is an honest rejection", () => {
    const { svg, panels, shell, byText } = setup();
    click(svg, 400, 300);
    byText("button", "Breaker")?.click();
    click(svg, 500, 300);
    expect(polygons(svg)).toBe(1); // the diamond quad
    expect(circles(svg)).toBe(1);
    // Click the first point's CURRENT screen position: auto-fit re-zoomed,
    // so project the world point instead of reusing pixels.
    const p1 = pt(Rat.make(0n), Rat.make(0n));
    const s = worldToScreen(p1, shell.view());
    click(svg, s.x, s.y);
    expect(circles(svg)).toBe(1);
    expect(polygons(svg)).toBe(1);
    const toasts = panels.querySelector("#toasts");
    expect(toasts?.childElementCount).toBe(1);
    expect(toasts?.textContent).toContain("Mathematical rule");
  });

  it("undo removes the last placement; reset clears the board", () => {
    const { svg, byText } = setup();
    click(svg, 400, 300);
    click(svg, 500, 300);
    expect(circles(svg)).toBe(2);
    byText("button", "Undo")?.click();
    expect(circles(svg)).toBe(1);
    byText("button", "Reset")?.click();
    expect(circles(svg)).toBe(0);
    expect(svg.querySelectorAll("rect").length).toBe(1);
  });
});

function setInput(panels: HTMLElement, id: string, value: string): void {
  const el = panels.querySelector(`#${id}`) as HTMLInputElement | null;
  expect(el !== null).toBe(true);
  if (el !== null) {
    el.value = value;
  }
}

function diagText(panels: HTMLElement): string {
  return panels.querySelector("#sandbox-diagnostics")?.textContent ?? "";
}

describe("sandbox k-selector", () => {
  it("switching k restarts the session at the new k", () => {
    const { svg, panels, shell, byText } = setup();
    click(svg, 400, 300);
    expect(circles(svg)).toBe(1);
    const kRow = panels.querySelector("#sandbox-k");
    const six = [...(kRow?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === "6",
    );
    expect(six !== undefined).toBe(true);
    six?.click();
    expect(shell.store.current().k).toBe(6);
    expect(shell.store.current().points.length).toBe(0);
    expect(diagText(panels)).toContain("k=6");
    expect(byText("button", "Maker") !== null).toBe(true);
  });
});

describe("sandbox seeded generation", () => {
  function generate(panels: HTMLElement, seed: string, size: string): void {
    setInput(panels, "gen-seed", seed);
    setInput(panels, "gen-size", size);
    const genBox = panels.querySelector("#sandbox-generate");
    const btn = [...(genBox?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === "Generate",
    );
    btn?.click();
  }

  it("same seed+size ⇒ identical point set (deterministic)", () => {
    const a = setup();
    generate(a.panels, "7", "12");
    expect(a.shell.store.current().points.length).toBe(12);
    const b = setup();
    generate(b.panels, "7", "12");
    expect(b.shell.store.current().points.length).toBe(12);
    const ha = a.shell.store.current().points.map((p) => `${p.pt.x.toString()},${p.pt.y.toString()}`).join(";");
    const hb = b.shell.store.current().points.map((p) => `${p.pt.x.toString()},${p.pt.y.toString()}`).join(";");
    expect(ha).toBe(hb);
    expect(a.panels.querySelector("#gen-note")?.textContent).toContain("seeded set: seed 7, 12 points");
    expect(diagText(a.panels)).toContain("general position: yes");
  });

  it("sizes above 24 warn; 32-point k=5 analysis caps with honesty labels", () => {
    const { panels, shell } = setup();
    generate(panels, "7", "32");
    expect(shell.store.current().points.length).toBe(32);
    expect(panels.querySelector("#gen-note")?.textContent).toContain("may cap analysis");
    expect(diagText(panels)).toContain("NOT an exhaustive count");
    // Guard sized for instrumented coverage runs.
  }, 360000);

  it("bad seed/size toast without touching the board", () => {
    const { panels, shell } = setup();
    generate(panels, "abc", "12");
    expect(shell.store.current().points.length).toBe(0);
    expect(panels.querySelector("#toasts")?.childElementCount).toBe(1);
    generate(panels, "7", "2");
    expect(shell.store.current().points.length).toBe(0);
  });
});

describe("sandbox typed placement (a11y)", () => {
  it("exact rationals place; garbage toasts without committing", () => {
    const { panels, shell } = setup();
    setInput(panels, "place-x", "5/2");
    setInput(panels, "place-y", "-3/4");
    const box = panels.querySelector("#sandbox-place");
    const btn = [...(box?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === "Place",
    );
    btn?.click();
    expect(shell.store.current().points.length).toBe(1);
    const p = shell.store.current().points[0];
    expect(p?.pt.x.toString()).toBe("5/2");
    expect(p?.pt.y.toString()).toBe("-3/4");
    setInput(panels, "place-x", "abc");
    btn?.click();
    expect(shell.store.current().points.length).toBe(1);
    expect(panels.querySelector("#toasts")?.textContent).toContain("rationals");
  });

  it("unreasonably large rationals are rejected at parse", () => {
    const { panels, shell } = setup();
    setInput(panels, "place-x", `1${"0".repeat(101)}`);
    setInput(panels, "place-y", "0");
    const box = panels.querySelector("#sandbox-place");
    const btn = [...(box?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === "Place",
    );
    btn?.click();
    expect(shell.store.current().points.length).toBe(0);
    expect(panels.querySelector("#toasts")?.textContent).toContain("10^100");
  });
});

describe("sandbox hole browsing", () => {
  function typed(panels: HTMLElement, x: string, y: string): void {
    setInput(panels, "place-x", x);
    setInput(panels, "place-y", y);
    const box = panels.querySelector("#sandbox-place");
    [...(box?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === "Place",
    )?.click();
  }

  it("pentagon browses 1 of 1 with highlight; prev/next cycle", () => {
    const { svg, panels, shell } = setup();
    for (const [x, y] of [["0", "0"], ["10", "0"], ["10", "10"], ["0", "10"], ["5", "15"]] as [string, string][]) {
      typed(panels, x, y);
    }
    expect(shell.store.current().points.length).toBe(5);
    const cap = panels.querySelector("#hole-caption")?.textContent ?? "";
    expect(cap).toContain("5-hole 1 of 1");
    const hl = [...svg.querySelectorAll("polygon")].filter(
      (el) => el.getAttribute("stroke") === "#38A169",
    );
    expect(hl.length).toBe(1);
    const box = panels.querySelector("#sandbox-holes");
    [...(box?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === "hole ▶",
    )?.click();
    expect(panels.querySelector("#hole-caption")?.textContent).toContain("5-hole 1 of 1");
  });

  it("Count all k renders per-k kinds", () => {
    const { panels } = setup();
    for (const [x, y] of [["0", "0"], ["10", "0"], ["10", "10"], ["0", "10"], ["5", "15"]] as [string, string][]) {
      typed(panels, x, y);
    }
    const box = panels.querySelector("#sandbox-holes");
    [...(box?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === "Count all k",
    )?.click();
    const out = panels.querySelector("#allk-counts")?.textContent ?? "";
    expect(out).toContain("k=5: 1 hole(s), exhaustive over 5 points");
    expect(out).toContain("k=3:");
  });
});

describe("sandbox Overmars-29 preset + demo", () => {
  function loadPreset(panels: HTMLElement): void {
    const box = panels.querySelector("#sandbox-preset");
    [...(box?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === "Load Overmars-29",
    )?.click();
  }

  it("loads 29 points with pre-verified fixture facts", () => {
    const { svg, panels, shell } = setup();
    loadPreset(panels);
    expect(shell.store.current().points.length).toBe(29);
    expect(shell.store.current().k).toBe(6);
    expect(circles(svg) + svg.querySelectorAll("polygon").length).toBeGreaterThanOrEqual(29);
    const banner = panels.querySelector("#preset-banner")?.textContent ?? "";
    expect(banner).toContain("0 empty hexagons");
    expect(banner).toContain("3,4,7,7,7,1");
    expect(banner).toContain("151 empty pentagons");
    expect(diagText(panels)).toContain("0 6-hole(s), exhaustive over 29 points");
    // Guard sized for instrumented coverage runs.
  }, 180000);

  it("30th point finds the guaranteed hexagon (first-witness, labeled)", () => {
    const { panels, shell } = setup();
    loadPreset(panels);
    setInput(panels, "place-x", "999999");
    setInput(panels, "place-y", "-999999");
    const box = panels.querySelector("#sandbox-place");
    [...(box?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === "Place",
    )?.click();
    expect(shell.store.current().points.length).toBe(30);
    const banner = panels.querySelector("#preset-banner")?.textContent ?? "";
    expect(banner).toContain("empty hexagon");
    expect(banner).toContain("not an exhaustive count");
    // Guard sized for instrumented coverage runs.
  }, 360000);

  it("re-verify starts, progresses, and cancels", () => {
    const { panels } = setup();
    loadPreset(panels);
    const box = panels.querySelector("#sandbox-preset");
    [...(box?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === "Re-verify full sweep",
    )?.click();
    return new Promise<void>((resolve, reject) => {
      const t0 = Date.now();
      const poll = (): void => {
        const bar = panels.querySelector("#verify-progress")?.textContent ?? "";
        if (bar !== "" && bar !== "re-verify: 0%") {
          [...(box?.querySelectorAll("button") ?? [])].find(
            (b) => b.textContent === "Cancel",
          )?.click();
          // Cancellation lands on the next slice boundary (~1s).
          const t1 = Date.now();
          const poll2 = (): void => {
            const bar2 = panels.querySelector("#verify-progress")?.textContent ?? "";
            if (bar2.includes("cancelled")) {
              resolve();
              return;
            }
            if (Date.now() - t1 > 30000) {
              reject(new Error("cancel never landed"));
              return;
            }
            setTimeout(poll2, 200);
          };
          poll2();
          return;
        }
        if (Date.now() - t0 > 60000) {
          reject(new Error("re-verify never progressed"));
          return;
        }
        setTimeout(poll, 200);
      };
      poll();
    });
  }, 120000);
});

describe("sandbox passive strategy overlay", () => {
  it("live regions render; var-bound regions list as needing a session", () => {
    const { panels } = setup();
    const sel = panels.querySelector("#overlay-strategy") as HTMLSelectElement | null;
    expect(sel !== null).toBe(true);
    if (sel === null) {
      return;
    }
    sel.value = "esmb-k5";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(panels.querySelector("#overlay-list")?.textContent).toContain("(live)");
    sel.value = "esmb-k6";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(panels.querySelector("#overlay-list")?.textContent).toContain(
      "needs a live guided session",
    );
  });
});

describe("sandbox honesty footer", () => {
  it("states the §14.2 non-guarantees in-mode", () => {
    const { panels } = setup();
    expect(panels.querySelector("#sandbox-honesty")?.textContent).toContain(
      "no win/lose beyond that",
    );
  });
});

