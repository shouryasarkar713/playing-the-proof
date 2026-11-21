// @vitest-environment jsdom
// tests/ui/hud.test.ts — ?debug HUD (§10.7, Phase 19): query-gated mount,
// read-only stats, no session interference.
import { afterEach, describe, expect, it } from "vitest";
import { createShell } from "../../src/ui/app.ts";
import { formatHud, hudEnabled, mountHud } from "../../src/ui/hud.ts";

describe("hudEnabled + formatHud", () => {
  it("gates on the debug query", () => {
    expect(hudEnabled("?debug")).toBe(true);
    expect(hudEnabled("?x=1&debug")).toBe(true);
    expect(hudEnabled("")).toBe(false);
    expect(hudEnabled("?node=x")).toBe(false);
  });

  it("formats every stat field", () => {
    const text = formatHud({
      mode: "break",
      node: "k5:r3:classify",
      points: 5,
      hash: "abc123",
      renderMs: 2.34,
      maxBits: 61,
    });
    expect(text).toContain("break");
    expect(text).toContain("k5:r3:classify");
    expect(text).toContain("5 pts");
    expect(text).toContain("abc123");
    expect(text).toContain("61 bits");
  });

  it("mountHud updates text through the reader", () => {
    document.body.innerHTML = "";
    const host = document.createElement("div");
    document.body.appendChild(host);
    const hud = mountHud(host, () => ({
      mode: "sandbox",
      node: "—",
      points: 0,
      hash: "h",
      renderMs: 0,
      maxBits: 1,
    }));
    hud.update();
    expect(host.querySelector("#hud")?.textContent).toContain("mode sandbox");
    document.body.innerHTML = "";
  });
});

describe("shell HUD wiring", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    window.history.replaceState({}, "", "/");
  });

  function setup(): { panels: HTMLElement } {
    document.body.innerHTML = "";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const panels = document.createElement("aside");
    document.body.append(svg, panels);
    return { panels };
  }

  it("mounts under ?debug, stays absent otherwise", () => {
    const { panels } = setup();
    const svg = document.querySelector("svg") as SVGSVGElement;
    const shell = createShell(svg, panels, { width: 800, height: 600 });
    shell.startSandbox();
    expect(panels.querySelector("#hud")).toBe(null);
    window.history.replaceState({}, "", "/?debug");
    shell.render();
    const hud = panels.querySelector("#hud");
    expect(hud !== null).toBe(true);
    expect(hud?.textContent).toContain("mode sandbox");
    expect(hud?.textContent).toContain("0 pts");
  });
});
