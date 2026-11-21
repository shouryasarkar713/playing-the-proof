// @vitest-environment jsdom
// tests/ui/kstrip.test.ts — the k-strip explorer mode: roles and labels,
// estimate before running, refusal / estimate-only text, running a verified
// configuration, the stepper (buttons, slider, chips, keyboard, play), ledger
// numbers equal to the kstrip ledger, cones and candidate pairs, Breaker
// reasons, recursion, Break the Proof, and experiment export/import.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lintSources } from "../../src/explain/claimlint.ts";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import { monoRounds, runKStrip, createStrategyAwarePolicy } from "../../src/kstrip/index.ts";
import { resumeSession } from "../../src/ui/replay-io.ts";
import { parseExperiment } from "../../src/ui/experiment-io.ts";
import { SUPPORTED, runExplorer, runBreak, buildSteps, reasonText } from "../../src/ui/kstrip-core.ts";
import { captureDownloads, click, setValue, setupShell, uiStrings, until } from "./modes-helpers.ts";

function openExplorer(): ReturnType<typeof setupShell> {
  const s = setupShell();
  s.shell.startKStrip();
  return s;
}

function form(
  panels: HTMLElement,
  v: { variant?: string; k?: number; t?: number; s?: string; policy?: string },
): void {
  const q = (id: string): Element | null => panels.querySelector(id);
  if (v.variant !== undefined) setValue(q("#kx-variant"), v.variant);
  if (v.k !== undefined) setValue(q("#kx-k"), String(v.k));
  if (v.t !== undefined) setValue(q("#kx-t"), String(v.t));
  if (v.s !== undefined) setValue(q("#kx-s"), v.s);
  if (v.policy !== undefined) setValue(q("#kx-policy"), v.policy);
}

async function runAndWait(panels: HTMLElement): Promise<void> {
  click(panels.querySelector("#kx-run"));
  await until(() => (panels.querySelector("#kx-run-status")?.textContent ?? "").startsWith("Completed"));
}

const text = (panels: HTMLElement, sel: string): string => panels.querySelector(sel)?.textContent ?? "";
const caption = (panels: HTMLElement): string => text(panels, "#kx-caption");

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("explorer: structure, labels and refusal", () => {
  it("every field has a bound label; regions and live areas have roles", () => {
    const { panels } = openExplorer();
    for (const el of panels.querySelectorAll("input:not([type=checkbox]), select")) {
      const id = el.id;
      expect(id, "form control without an id").not.toBe("");
      expect(panels.querySelector(`label[for="${id}"]`), `label for ${id}`).not.toBeNull();
    }
    for (const b of panels.querySelectorAll("button")) {
      expect((b.textContent ?? "").trim().length + (b.getAttribute("aria-label") ?? "").length, "unnamed button").toBeGreaterThan(0);
    }
    for (const s of panels.querySelectorAll("section")) {
      expect(s.getAttribute("aria-labelledby")).not.toBeNull();
      expect(panels.querySelector(`#${s.getAttribute("aria-labelledby")}`)?.textContent?.length).toBeGreaterThan(2);
    }
    expect(panels.querySelector("#kx-caption")?.getAttribute("aria-live")).toBe("polite");
    expect(panels.querySelector("#kx-availability")?.getAttribute("role")).toBe("status");
    expect(panels.querySelector("#kx-run-status")?.getAttribute("role")).toBe("status");
    expect(panels.querySelector("#kx-chips, .kx-chips")?.getAttribute("role")).toBe("group");
    expect(panels.querySelector(".kx-chips")?.getAttribute("aria-label")).toContain("Phases");
    expect((panels.querySelector("#kx-slider") as HTMLInputElement).type).toBe("range");
  });

  it("shows the estimate BEFORE running, and it equals what the executor then does", async () => {
    const { panels } = openExplorer();
    form(panels, { variant: "mono-1:1", k: 4, t: 1 });
    const est = panels.querySelector("#kx-estimate")?.textContent ?? "";
    expect(est).toContain("Estimate (before running)");
    expect(est).toContain("52"); // points
    expect(panels.querySelector("#kx-run-status")?.textContent).toContain("No run yet");
    await runAndWait(panels);
    expect(text(panels, "#kx-run-facts")).toContain("52 points");
    expect(text(panels, "#kx-run-facts")).toContain("26 rounds");
    expect(panels.querySelectorAll("#kx-estimate tbody tr").length).toBe(3);
  });

  it("over-budget parameters: Run is disabled with the reason visible, and nothing runs", () => {
    const { panels } = openExplorer();
    form(panels, { variant: "mono-1:1", k: 6, t: 1 });
    const run = panels.querySelector("#kx-run") as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    expect(run.getAttribute("aria-describedby")).toBe("kx-availability");
    const why = text(panels, "#kx-availability");
    expect(why).toContain("Refused before execution");
    expect(why).toContain("points 852 > 400");
    expect(panels.querySelector("#kx-availability")?.className).toContain("kx-avail-refused");
    click(run);
    expect(text(panels, "#kx-run-status")).toContain("No run yet");
    // the estimate is still visible so the user sees what was asked for
    expect(text(panels, "#kx-estimate")).toContain("852");
  });

  it("unverified but affordable parameters are 'estimate only — not executed'", () => {
    const { panels } = openExplorer();
    form(panels, { variant: "mono-1:1", k: 3, t: 4 });
    expect((panels.querySelector("#kx-run") as HTMLButtonElement).disabled).toBe(true);
    expect(text(panels, "#kx-availability")).toContain("estimate only — not executed");
    expect(panels.querySelector("#kx-availability")?.className).toContain("kx-avail-estimate-only");
    form(panels, { variant: "bichromatic", s: "3/2", k: 3, t: 2 });
    expect(text(panels, "#kx-availability")).toContain("Refused before execution");
    form(panels, { variant: "bichromatic", s: "2", k: 3, t: 1 });
    expect(text(panels, "#kx-availability")).toMatch(/Invalid|s must|bichromatic Theorem 5 needs/);
    expect((panels.querySelector("#kx-run") as HTMLButtonElement).disabled).toBe(true);
  });

  it("the verified table lists every supported row and 'Use' fills the form", () => {
    const { panels } = openExplorer();
    const rows = panels.querySelectorAll("#kx-table tbody tr");
    expect(rows.length).toBe(SUPPORTED.reduce((n, r) => n + r.t.length, 0));
    const use = [...panels.querySelectorAll("#kx-table .kx-use")].find((b) =>
      (b.getAttribute("aria-label") ?? "").includes("bichromatic, k=3, t=1, s=3/2"),
    );
    expect(use).toBeDefined();
    click(use as Element);
    expect((panels.querySelector("#kx-variant") as HTMLSelectElement).value).toBe("bichromatic");
    expect((panels.querySelector("#kx-s") as HTMLInputElement).value).toBe("3/2");
    expect((panels.querySelector("#kx-run") as HTMLButtonElement).disabled).toBe(false);
  });

  it("states the claim tiers and the scope honestly, and never claims the general strategy", () => {
    const { panels } = openExplorer();
    const claims = text(panels, "#kx-claims");
    expect(claims).toContain("theorem");
    expect(claims).toContain("construction");
    expect(claims).toContain("exact check on this run");
    expect(claims).toContain("arbitrary k");
    expect(lintSources(uiStrings(panels))).toEqual([]);
  });
});

describe("explorer: running and stepping", () => {
  it("runs a verified configuration and steps through the whole log", async () => {
    const { panels, svg } = openExplorer();
    form(panels, { variant: "mono-1:1", k: 3, t: 1, policy: "strategy-aware" });
    await runAndWait(panels);
    const ref = runExplorer({ variant: "mono-1:1", k: 3, t: 1, s: null, policy: "strategy-aware", seed: 1 });
    const steps = buildSteps(ref);
    expect(text(panels, "#kx-run-status")).toContain("Completed");
    expect(caption(panels)).toBe(`Step 1 of ${steps.length}: ${steps[0]?.title}`);
    const slider = panels.querySelector("#kx-slider") as HTMLInputElement;
    expect(slider.max).toBe(String(steps.length - 1));
    // next / back buttons
    click(panels.querySelector("#kx-next"));
    expect(caption(panels)).toContain("Step 2 of");
    click(panels.querySelector("#kx-prev"));
    expect(caption(panels)).toContain("Step 1 of");
    expect((panels.querySelector("#kx-prev") as HTMLButtonElement).disabled).toBe(true);
    // slider
    setValue(slider, String(steps.length - 1));
    expect(caption(panels)).toContain(`Step ${steps.length} of ${steps.length}: Result: completed`);
    expect((panels.querySelector("#kx-next") as HTMLButtonElement).disabled).toBe(true);
    // points on the board at the end = every logged point
    expect(svg.querySelectorAll("circle.pt-maker").length + svg.querySelectorAll("polygon.pt-breaker").length).toBe(ref.log.length);
    // restart
    click(panels.querySelector("#kx-first"));
    expect(caption(panels)).toContain("Step 1 of");
    expect(svg.querySelectorAll("circle.pt-maker").length).toBe(0);
  });

  it("phase chips jump to phases; keyboard arrows, R and Space work; typing in a field does not", async () => {
    const { panels } = openExplorer();
    form(panels, { variant: "mono-1:1", k: 4, t: 1 });
    await runAndWait(panels);
    const chips = [...panels.querySelectorAll(".kx-chip")];
    expect(chips.map((c) => c.textContent)).toEqual(["L2 base points", "L3 pairing", "L4 pairing"]);
    click(chips[2] as Element);
    expect(caption(panels)).toContain("Level 4: pairing — start");
    expect(panels.querySelectorAll(".kx-chip")[2]?.getAttribute("aria-pressed")).toBe("true");
    const key = (k: string, target: EventTarget = document): void => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    };
    const before = caption(panels);
    key("ArrowRight");
    expect(caption(panels)).not.toBe(before);
    key("ArrowLeft");
    expect(caption(panels)).toBe(before);
    key("r");
    expect(caption(panels)).toContain("Step 1 of");
    // typing in a field suspends shortcuts
    key("ArrowRight", panels.querySelector("#kx-k") as Element);
    expect(caption(panels)).toContain("Step 1 of");
  });

  it("play advances on a timer, pause stops it, and play restarts at the end", async () => {
    const { panels } = openExplorer();
    form(panels, { variant: "mono-1:1", k: 3, t: 1 });
    await runAndWait(panels);
    vi.useFakeTimers();
    setValue(panels.querySelector("#kx-speed"), "80");
    click(panels.querySelector("#kx-play"));
    expect(panels.querySelector("#kx-play")?.getAttribute("aria-pressed")).toBe("true");
    expect(panels.querySelector("#kx-play")?.textContent).toContain("Pause");
    vi.advanceTimersByTime(400);
    const mid = caption(panels);
    expect(mid).not.toContain("Step 1 of");
    click(panels.querySelector("#kx-play"));
    expect(panels.querySelector("#kx-play")?.getAttribute("aria-pressed")).toBe("false");
    vi.advanceTimersByTime(2000);
    expect(caption(panels)).toBe(mid); // paused
    click(panels.querySelector("#kx-play"));
    vi.advanceTimersByTime(20000);
    expect(caption(panels)).toContain("Result: completed");
    expect(panels.querySelector("#kx-play")?.getAttribute("aria-pressed")).toBe("false"); // stopped at the end
    vi.useRealTimers();
  });

  it("the ledger displays exactly the kstrip ledger numbers, with the Proposition 1 arithmetic", async () => {
    const { panels } = openExplorer();
    form(panels, { variant: "mono-1:1", k: 3, t: 1 });
    await runAndWait(panels);
    const direct = runKStrip(3, 1, createStrategyAwarePolicy());
    const rep = direct.levels.find((l) => l.level === 3);
    expect(rep).toBeDefined();
    click([...panels.querySelectorAll(".kx-chip")].find((c) => c.textContent === "L3 pairing") as Element);
    // go to the harvest step
    const slider = panels.querySelector("#kx-slider") as HTMLInputElement;
    for (let i = Number(slider.value); i <= Number(slider.max); i += 1) {
      setValue(slider, String(i));
      if (caption(panels).includes("harvest")) break;
    }
    expect(caption(panels)).toContain("Level 3: pairing — harvest");
    const led = text(panels, "#kx-ledger-body");
    expect(led).toContain(`Strips required (t)${rep?.required}`);
    expect(led).toContain(`Units U (pairs or groups)${rep?.units}`);
    expect(led).toContain(`= ${rep?.guaranteedAtEnd}`); // units − dead − kills = bound
    expect(led).toContain(`${rep?.breakerMoves} used of ${rep?.breakerMoves}`);
    expect(led).toContain("⌊B/2⌋");
    expect(led).toContain(rep?.proposition1Holds === true ? "within the bound" : "violated");
    expect(led).toContain(`${rep?.survivors} strip(s) harvested of ${rep?.required} required`);
    // the per-unit table has one row per unit
    expect(panels.querySelectorAll("#kx-ledger-body tbody tr").length).toBe(rep?.units);
    // and the survivor bound the UI shows is a lower bound on the harvested count
    expect(rep?.guaranteedAtEnd ?? 0).toBeLessThanOrEqual(rep?.survivors ?? 0);
  });

  it("a Breaker move step shows the policy's reason in words and its ledger classification", async () => {
    const { panels } = openExplorer();
    form(panels, { variant: "mono-1:1", k: 3, t: 1, policy: "strategy-aware" });
    await runAndWait(panels);
    const ref = runExplorer({ variant: "mono-1:1", k: 3, t: 1, s: null, policy: "strategy-aware", seed: 1 });
    const steps = buildSteps(ref);
    const slider = panels.querySelector("#kx-slider") as HTMLInputElement;
    // first Breaker move inside a pairing phase
    const idx = steps.findIndex((s) => s.kind === "move" && s.phase === "pairing" && ref.log[s.moveIdx ?? 0]?.player === "breaker");
    expect(idx).toBeGreaterThan(0);
    setValue(slider, String(idx));
    const entry = ref.log[steps[idx]?.moveIdx ?? 0];
    const reason = text(panels, "#kx-reason-body");
    expect(reason).toContain(entry?.reason?.policy ?? "?");
    expect(reason).toContain(reasonText(entry?.reason ?? null));
    expect(reason).toContain("Ledger classification of this point:");
    expect(text(panels, "#kx-explain")).toContain("What Breaker can do");
    // a Maker step says it is not a Breaker move
    setValue(slider, "0");
    expect(text(panels, "#kx-reason-body")).toContain("not a Breaker move");
  });

  it("selecting a strip draws its extension cones; selecting a pair shows the shared halfline", async () => {
    const { panels, svg } = openExplorer();
    form(panels, { variant: "mono-1:1", k: 3, t: 1 });
    await runAndWait(panels);
    click([...panels.querySelectorAll(".kx-chip")].find((c) => c.textContent === "L3 pairing") as Element);
    expect(svg.querySelectorAll(".kx-cone").length).toBe(0);
    const strip = panels.querySelector("#kx-strip-sel") as HTMLSelectElement;
    expect(strip.options.length).toBeGreaterThan(2);
    setValue(strip, "0");
    expect(svg.querySelectorAll(".kx-cone").length).toBeGreaterThanOrEqual(1);
    expect(text(panels, "#kx-inspect-info")).toContain("Cone C");
    // toggle a cone off
    const plus = panels.querySelector("#kx-cone-plus") as HTMLInputElement;
    const minus = panels.querySelector("#kx-cone-minus") as HTMLInputElement;
    const both = svg.querySelectorAll(".kx-cone").length;
    plus.checked = false;
    plus.dispatchEvent(new Event("change", { bubbles: true }));
    expect(svg.querySelectorAll(".kx-cone").length).toBeLessThan(both);
    minus.checked = false;
    minus.dispatchEvent(new Event("change", { bubbles: true }));
    expect(svg.querySelectorAll(".kx-cone").length).toBe(0);
    // a pair at its start step: planned halfline
    const unit = panels.querySelector("#kx-unit-sel") as HTMLSelectElement;
    setValue(unit, "1");
    expect(svg.querySelectorAll(".kx-halfline").length).toBe(1);
    expect(text(panels, "#kx-inspect-info")).toContain("Unit 1 plan");
    // after the apex and the Breaker reply, the two candidates meet in a halfline
    const slider = panels.querySelector("#kx-slider") as HTMLInputElement;
    const startAt = Number(slider.value);
    setValue(slider, String(startAt + 2));
    setValue(unit, "1");
    expect(text(panels, "#kx-inspect-info")).toMatch(/meet exactly in the halfline below/);
    // the unbounded regions are labelled as clipped
    expect(svg.textContent).toContain("Clipped for display (illustrative); the exact region is unbounded.");
    expect(text(panels, "#kx-inspect")).toContain("Clipped for display (illustrative); the exact region is unbounded.");
  });

  it("shows the boundary-adoption event when it happens (a Breaker point on an end halfline)", async () => {
    const { panels } = openExplorer();
    form(panels, { variant: "mono-1:1", k: 3, t: 1 });
    click(panels.querySelector("#kx-break-start"));
    expect(text(panels, "#kx-break-info")).toContain("Level 3 pairing");
    // Maker's apex p_1 is the last move so far; a Breaker point straight below it is on the
    // boundary halfline, so the adoption rule absorbs it
    const probe = runBreak(
      { variant: "mono-1:1", k: 3, t: 1, s: null, policy: "strategy-aware", seed: 1 },
      { level: 3, points: [] },
    );
    const apex = probe.run.log[probe.run.log.length - 1]?.pt;
    expect(apex).toBeDefined();
    const x = apex?.x.toString().replace(/\/1$/, "") ?? "0";
    const y = apex?.y.sub(Rat.make(7n)).toString().replace(/\/1$/, "") ?? "0";
    setValue(panels.querySelector("#kx-break-x"), x);
    setValue(panels.querySelector("#kx-break-y"), y);
    expect(text(panels, "#kx-break-preview")).toContain("absorbed by the adoption rule");
    click(panels.querySelector("#kx-break-place"));
    expect(text(panels, "#kx-break-list")).toContain("absorbed by adoption");
    const ledger = text(panels, "#kx-ledger-body");
    expect(ledger).toContain("Boundary adoption");
    expect(ledger).toContain("is replaced by the Breaker point");
    expect(ledger).toContain("The region only shrinks.");
    // the ledger classification agrees with the kstrip ledger
    const after = runBreak(
      { variant: "mono-1:1", k: 3, t: 1, s: null, policy: "strategy-aware", seed: 1 },
      { level: 3, points: [apex === undefined ? pt(Rat.ZERO, Rat.ZERO) : pt(apex.x, apex.y.sub(Rat.make(7n)))] },
    );
    const last = [...after.run.trace].reverse().find((e) => e.kind === "ledger" && e.level === 3);
    expect(last?.kind === "ledger" ? last.ledger.placements[0]?.category : "").toBe("absorbed");
    expect(last?.kind === "ledger" ? last.ledger.adoptions.length : 0).toBeGreaterThan(0);
  });

  it("recursion panel: exact fractions, closed form, growth note and the next level", async () => {
    const { panels } = openExplorer();
    form(panels, { variant: "mono-1:1", k: 5, t: 1 });
    const rec = text(panels, "#kx-recursion");
    expect(rec).toContain(`r(5,1) = r(4,4) + 2·1`);
    expect(rec).toContain(String(monoRounds(5, 1n).n)); // 106
    expect(rec).toContain("(5/3·4^(k−2) − 2/3)·t");
    expect(rec).toContain("tends to 4");
    expect(rec).toContain("next recursive level");
    const rows = [...panels.querySelectorAll("#kx-recursion tbody tr")];
    expect(rows.map((r) => r.querySelectorAll("td")[0]?.textContent)).toEqual(["2", "3", "4", "5", "6"]);
    expect(rows[4]?.className).toContain("kx-next");
    // a fractional value is shown as an exact fraction
    form(panels, { variant: "mono-1:s", k: 3, t: 1, s: "2" });
    expect(text(panels, "#kx-recursion")).toMatch(/\d+\/\d+/);
    form(panels, { variant: "bichromatic", s: "1" });
    expect(text(panels, "#kx-recursion")).toContain("Theorem 5");
  });

  it("bichromatic runs show ownership: Breaker points are blockers only", async () => {
    const { panels } = openExplorer();
    form(panels, { variant: "bichromatic", k: 3, t: 1, s: "1" });
    await runAndWait(panels);
    click([...panels.querySelectorAll(".kx-chip")].find((c) => /pairing \(bichromatic\)/.test(c.textContent ?? "")) as Element);
    const slider = panels.querySelector("#kx-slider") as HTMLInputElement;
    setValue(slider, String(Number(slider.value) + 3));
    expect(text(panels, "#kx-ledger-body")).toContain("Ownership (bichromatic)");
    expect(text(panels, "#kx-ledger-body")).toContain("never adopted");
  });

  it("every rendered string passes ClaimLint (all three variants, several steps)", async () => {
    for (const cfg of [
      { variant: "mono-1:1", k: 3, t: 1 },
      { variant: "mono-1:s", k: 3, t: 1, s: "2" },
      { variant: "bichromatic", k: 3, t: 1, s: "1" },
    ]) {
      const { panels } = openExplorer();
      form(panels, cfg);
      await runAndWait(panels);
      const slider = panels.querySelector("#kx-slider") as HTMLInputElement;
      for (let i = 0; i <= Number(slider.max); i += Math.max(1, Math.floor(Number(slider.max) / 6))) {
        setValue(slider, String(i));
        expect(lintSources(uiStrings(panels)), `${cfg.variant} step ${i}`).toEqual([]);
      }
      setValue(slider, slider.max);
      expect(lintSources(uiStrings(panels))).toEqual([]);
    }
  }, 60000);
});

describe("explorer: Break the Proof", () => {
  it("is refused with a visible reason where it does not apply", () => {
    const { panels } = openExplorer();
    form(panels, { variant: "mono-1:1", k: 5, t: 1 });
    const start = panels.querySelector("#kx-break-start") as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(text(panels, "#kx-break-why")).toContain("at most 120 points");
    expect(start.getAttribute("aria-describedby")).toBe("kx-break-why");
    form(panels, { variant: "mono-1:1", k: 2, t: 1 });
    expect(text(panels, "#kx-break-why")).toContain("no pairing phase");
  });

  it("classifies each placed point with the ledger, rejects illegal points, and ends with the exact re-check", async () => {
    const { panels, svg } = openExplorer();
    form(panels, { variant: "mono-1:1", k: 3, t: 1, policy: "strategy-aware" });
    click(panels.querySelector("#kx-break-start"));
    expect(text(panels, "#kx-break-info")).toContain("Level 3 pairing, Maker round 1");
    expect(text(panels, "#kx-run-status")).toContain("Waiting for your next Breaker point");
    // an illegal point (duplicate of Maker's first point) is explained and cannot be placed
    const x = panels.querySelector("#kx-break-x") as HTMLInputElement;
    const y = panels.querySelector("#kx-break-y") as HTMLInputElement;
    const ref = runExplorer({ variant: "mono-1:1", k: 3, t: 1, s: null, policy: "strategy-aware", seed: 1 });
    const first = ref.log[0];
    setValue(x, first?.pt.x.toString().replace("/1", "") ?? "0");
    setValue(y, first?.pt.y.toString().replace("/1", "") ?? "0");
    expect(text(panels, "#kx-break-preview")).toContain("Illegal");
    expect((panels.querySelector("#kx-break-place") as HTMLButtonElement).disabled).toBe(true);
    // legal points: place until the phase is spent
    let guard = 0;
    while (panels.querySelector("#kx-break-place") !== null && !text(panels, "#kx-break-info").includes("budget for this phase is spent") && guard < 12) {
      guard += 1;
      let placed = false;
      for (let i = 0; i < 80 && !placed; i += 1) {
        setValue(x, `${2 * i + 1}/2`);
        setValue(y, `${-3 * i - 1}`);
        const preview = text(panels, "#kx-break-preview");
        if (!preview.startsWith("Illegal") && preview !== "") {
          expect(preview).toMatch(/Blocks the interior|Lands inside|absorbed|Useless|boundary/);
          click(panels.querySelector("#kx-break-place"));
          placed = true;
        }
      }
      expect(placed).toBe(true);
    }
    expect(text(panels, "#kx-break-info")).toContain("budget for this phase is spent");
    expect(text(panels, "#kx-run-status")).toContain("Completed");
    const items = [...panels.querySelectorAll("#kx-break-list li")];
    expect(items.length).toBeGreaterThan(0);
    for (const li of items) {
      expect(li.textContent).toMatch(/blocks the interior|absorbed by adoption|not absorbed|useless/);
    }
    expect(text(panels, "#kx-break-info")).toContain("survivor lower bound");
    // undo returns to a pending state; restart clears everything
    click(panels.querySelector("#kx-break-undo"));
    expect(text(panels, "#kx-break-info")).toContain("remain to be placed");
    click(panels.querySelector("#kx-break-restart"));
    expect(panels.querySelectorAll("#kx-break-list li").length).toBe(0);
    // a board click proposes the clicked point
    const before = (panels.querySelector("#kx-break-x") as HTMLInputElement).value;
    svg.dispatchEvent(new MouseEvent("click", { clientX: 300, clientY: 200, bubbles: true }));
    expect((panels.querySelector("#kx-break-x") as HTMLInputElement).value).not.toBe(before);
    expect(text(panels, "#kx-break-preview").length).toBeGreaterThan(5);
  }, 60000);
});

describe("explorer: experiments and navigation", () => {
  it("export -> import through the entry path reproduces the run; a doctored move is rejected", async () => {
    const { panels, shell } = openExplorer();
    const dl = captureDownloads();
    try {
      form(panels, { variant: "mono-1:s", k: 3, t: 1, s: "2", policy: "greedy-blocking" });
      await runAndWait(panels);
      const facts = text(panels, "#kx-run-facts");
      click(panels.querySelector("#kx-export"));
      expect(dl.names[0]).toBe("playing-the-proof-kstrip-mono-1-s-k3-t1.experiment.json");
      const body = (await dl.texts[0]) as string;
      expect(parseExperiment(body).ok).toBe(true);
      shell.startKStrip();
      const toasts: string[] = [];
      expect(resumeSession(shell, body, (m) => toasts.push(m))).toBe(true);
      expect((panels.querySelector("#kx-variant") as HTMLSelectElement).value).toBe("mono-1:s");
      expect((panels.querySelector("#kx-policy") as HTMLSelectElement).value).toBe("greedy-blocking");
      expect(text(panels, "#kx-run-facts").replace(/run time \d+ ms/, "")).toBe(facts.replace(/run time \d+ ms/, ""));
      // doctored
      const doc = JSON.parse(body) as { kstrip: { moves: { pt: string[] }[] } };
      (doc.kstrip.moves[5] as { pt: string[] }).pt = ["123/1", "456/1"];
      const bad = resumeSession(shell, JSON.stringify(doc), (m) => toasts.push(m));
      expect(bad).toBe(false);
      expect(toasts.join(" ")).toContain("Experiment rejected");
    } finally {
      dl.restore();
    }
  }, 60000);

  it("a Break the Proof session round-trips with its scripted points", async () => {
    const { panels, shell } = openExplorer();
    const dl = captureDownloads();
    try {
      form(panels, { variant: "mono-1:1", k: 3, t: 1 });
      click(panels.querySelector("#kx-break-start"));
      const x = panels.querySelector("#kx-break-x") as HTMLInputElement;
      const y = panels.querySelector("#kx-break-y") as HTMLInputElement;
      setValue(x, "9/2");
      setValue(y, "-40");
      if ((panels.querySelector("#kx-break-place") as HTMLButtonElement).disabled) {
        setValue(x, "13/2");
      }
      click(panels.querySelector("#kx-break-place"));
      click(panels.querySelector("#kx-export"));
      const body = (await dl.texts[0]) as string;
      const parsed = parseExperiment(body);
      expect(parsed.ok && parsed.file.kind === "kstrip" ? parsed.file.kstrip.script?.points.length : -1).toBe(1);
      shell.startKStrip();
      expect(resumeSession(shell, body, () => undefined)).toBe(true);
      expect(panels.querySelectorAll("#kx-break-list li").length).toBe(1);
      expect(text(panels, "#kx-break-info")).toContain("remain to be placed");
    } finally {
      dl.restore();
    }
  });

  it("Escape returns to the entry screen and the page tidies up", async () => {
    const { panels, svg } = openExplorer();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(panels.querySelector("#entry")).not.toBeNull();
    expect(panels.querySelector("#kx-config")).toBeNull();
    expect(svg.getAttribute("aria-label")).toContain("Point plane");
  });

  it("Menu button and the entry card open the explorer", () => {
    const { panels, shell } = setupShell();
    shell.showEntry();
    click(panels.querySelector('button[aria-label="Open the k-strip explorer"]'));
    expect(panels.querySelector("#kx-config")).not.toBeNull();
    click(panels.querySelector("#kx-menu"));
    expect(panels.querySelector("#entry")).not.toBeNull();
  });
});
