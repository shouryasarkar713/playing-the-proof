// @vitest-environment jsdom
// Closure-pass UI items: typed-form feedback, input clearing, replay-rejection
// toast lists the problems, focus restored after closing a dialog with Escape.
import { describe, expect, it } from "vitest";
import { createShell } from "../../src/ui/app.ts";
import { classifiers, strategies } from "../../src/strategy/registry.ts";
import { checkers } from "../../src/verification/invariants.ts";
import { resumeSession } from "../../src/ui/replay-io.ts";
import { dispatch } from "../../src/ui/dispatch.ts";
import { pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";
import { mulberry32 } from "../helpers.ts";
import { ensureK5 } from "../strategies/k5driver.ts";
import { ensureK6 } from "../strategies/k6driver.ts";

ensureK5();
ensureK6();
const live = { strategies: strategies(), classifiers: classifiers(), checkers: checkers() };

function setup() {
  document.body.innerHTML = "";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("id", "board");
  const panels = document.createElement("aside");
  panels.setAttribute("id", "panels");
  document.body.append(svg, panels);
  const shell = createShell(svg, panels, { width: 800, height: 600, registries: live });
  return { shell, panels };
}

describe("closure UI items", () => {
  it("Break typed form: clears after a successful placement, keeps input on rejection, explains a zero denominator", () => {
    const { shell } = setup();
    shell.startBreak("esmb-k5");
    const x = document.getElementById("break-x") as HTMLInputElement;
    const y = document.getElementById("break-y") as HTMLInputElement;
    const form = document.getElementById("break-place") as HTMLFormElement;
    const toasts = (): string => [...document.querySelectorAll(".toast")].map((t) => t.textContent).join("|");
    x.value = "1/0";
    y.value = "2";
    form.requestSubmit();
    expect(toasts()).toContain("denominator must not be zero");
    expect(x.value).toBe("1/0"); // rejected: input kept
    x.value = "10";
    y.value = "0";
    form.requestSubmit();
    expect(x.value).toBe("");
    expect(y.value).toBe("");
    expect(shell.store.current().points.length).toBeGreaterThan(1); // B1 + Maker reply
  });

  it("a rejected replay lists the problems itself (no 'see details')", () => {
    const { shell } = setup();
    const toasts: string[] = [];
    expect(resumeSession(shell, "{not json", (m) => toasts.push(m))).toBe(false);
    expect(toasts[0]).toMatch(/^Replay rejected: 1 replay problem: not-json/);
    expect(toasts[0]).not.toContain("see details");
  });

  it("closing About with Escape restores focus to the About button on the entry screen", async () => {
    const { shell } = setup();
    shell.showEntry();
    const about = [...document.querySelectorAll<HTMLButtonElement>("#entry .entry-actions button")].find(
      (b) => b.textContent?.trim() === "About",
    ) as HTMLButtonElement;
    about.click();
    expect(document.querySelector("[role=dialog]")).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(document.activeElement?.textContent?.trim()).toBe("About");
  });

  it("Break mode: Grow-to-6 is enabled on an odd-count win (and starts k=6), disabled WITH visible text on a Breaker-completed (even) win", () => {
    const rand = mulberry32(3);
    const seen = { odd: false, even: false };
    for (let g = 0; g < 80 && !(seen.odd && seen.even); g += 1) {
      const { shell } = setup();
      shell.startBreak("esmb-k5");
      const at = (): ReturnType<typeof pt> =>
        pt(Rat.make(BigInt(Math.floor(rand() * 81) - 40)), Rat.make(BigInt(Math.floor(rand() * 81) - 40)));
      for (let i = 0; i < 40 && shell.store.current().terminal === null; i += 1) {
        dispatch(shell.store, shell.ctx, { kind: "place", owner: "breaker", at: at() }, () => {});
      }
      const st = shell.store.current();
      if (st.terminal?.kind !== "maker-won") continue;
      const grow = [...document.querySelectorAll<HTMLButtonElement>("#terminal-host button")].find((b) => b.textContent === "Grow to 6");
      expect(grow).toBeDefined();
      const even = st.points.length % 2 === 0;
      if (even && !seen.even) {
        seen.even = true;
        expect(grow?.disabled).toBe(true);
        expect(document.getElementById("terminal-host")?.textContent).toContain("Maker's turn");
      } else if (!even && !seen.odd) {
        seen.odd = true;
        expect(grow?.disabled).toBe(false);
        grow?.click();
        expect(shell.store.current().k).toBe(6);
        expect(shell.store.current().strategy?.nodeId).toBe("k6:boot");
      }
    }
    expect(seen).toEqual({ odd: true, even: true });
  }, 120000);
});
