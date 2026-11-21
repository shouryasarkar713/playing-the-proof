// @vitest-environment jsdom
// tests/ui/lab.test.ts — Parameter Lab mode: controls from availableControls(),
// the status badge exactly as classify() returns it, ledger content, links
// only where applicable, the bounded simulation as an observation, the
// discrepancy list, and experiment export/import.
import { afterEach, describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import {
  DISCREPANCIES,
  availableControls,
  classify,
  parseBias,
  runSimulation,
} from "../../src/lab/index.ts";
import type { LabConfig } from "../../src/lab/index.ts";
import { lintSources } from "../../src/explain/claimlint.ts";
import { STATUS_LABEL } from "../../src/ui/lab-core.ts";
import { resumeSession } from "../../src/ui/replay-io.ts";
import { experimentText, labExperimentOf, parseExperiment } from "../../src/ui/experiment-io.ts";
import { captureDownloads, click, setValue, setupShell, uiStrings, until } from "./modes-helpers.ts";

function openLab(): ReturnType<typeof setupShell> & { q: (sel: string) => HTMLElement } {
  const s = setupShell();
  s.shell.startLab();
  return { ...s, q: (sel) => s.panels.querySelector(sel) as HTMLElement };
}

function configure(
  panels: HTMLElement,
  v: { model?: string; rule?: string; k?: number; bias?: string; enc?: string; t?: number },
): void {
  const q = (id: string): Element | null => panels.querySelector(id);
  if (v.model !== undefined) setValue(q("#lab-model"), v.model);
  if (v.rule !== undefined) setValue(q("#lab-rule"), v.rule);
  if (v.k !== undefined) setValue(q("#lab-k"), String(v.k));
  if (v.bias !== undefined) setValue(q("#lab-bias"), v.bias);
  if (v.enc !== undefined) setValue(q("#lab-encoding"), v.enc);
  if (v.t !== undefined) setValue(q("#lab-structures"), String(v.t));
}

function cfgOf(model: string, rule: string, k: number, bias: string): LabConfig {
  return {
    model: model as LabConfig["model"],
    rule: rule as LabConfig["rule"],
    k,
    bias: parseBias(bias) as Rat,
    encodingId: null,
    structures: 1,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Parameter Lab: controls", () => {
  it("exposes exactly the controls availableControls() lists (no decorative ones)", () => {
    const { panels } = openLab();
    const listed = availableControls().filter((c) => c.kind !== "button");
    const ids = listed.map((c) => `lab-${c.id.replace(".", "-")}`);
    const present = [...panels.querySelectorAll("input, select")]
      .map((e) => e.id)
      .filter((id) => id.startsWith("lab-"));
    expect(present.sort()).toEqual([...ids].sort());
    // every control has a visible label bound to it
    for (const id of ids) {
      expect(panels.querySelector(`label[for="${id}"]`)?.textContent?.length ?? 0).toBeGreaterThan(2);
    }
    // the only action button of the controls is the simulation runner
    expect(panels.querySelector("#lab-sim-run")).not.toBeNull();
    // the k control honours its declared bounds
    const kc = availableControls().find((c) => c.id === "k");
    const kIn = panels.querySelector("#lab-k") as HTMLInputElement;
    expect(kIn.min).toBe(String(kc?.min));
    expect(kIn.max).toBe(String(kc?.max));
  });

  it("invalid input shows a message and no stale result", () => {
    const { panels } = openLab();
    configure(panels, { bias: "abc" });
    expect(panels.querySelector("#lab-param-msg")?.textContent).toContain("non-negative rational");
    expect(panels.querySelector("#lab-status")).toBeNull();
    configure(panels, { bias: "2", k: 99 });
    expect(panels.querySelector("#lab-param-msg")?.textContent).toContain("k must be an integer");
    configure(panels, { k: 5 });
    expect(panels.querySelector("#lab-param-msg")?.textContent).toBe("");
    expect(panels.querySelector("#lab-status")).not.toBeNull();
  });
});

describe("Parameter Lab: the status is exactly classify()'s", () => {
  it("badge data-status and label equal classify() over a parameter sweep", () => {
    const { panels } = openLab();
    const seen = new Set<string>();
    for (const model of ["online", "one-round"]) {
      for (const rule of ["monochromatic", "bichromatic"]) {
        for (const k of [3, 5, 7, 8, 10]) {
          for (const bias of ["0", "1", "3/2", "2", "6", "12", "17"]) {
            configure(panels, { model, rule, k, bias, enc: "" });
            const want = classify(cfgOf(model, rule, k, bias)).status;
            const badge = panels.querySelector("#lab-status") as HTMLElement;
            expect(badge.getAttribute("data-status"), `${model} ${rule} k=${k} ${bias}`).toBe(want);
            expect(badge.textContent).toBe(STATUS_LABEL[want]);
            seen.add(want);
          }
        }
      }
    }
    expect([...seen].sort()).toEqual(["EXPERIMENTAL", "NOT_COVERED", "THEOREM_BACKED"]);
    expect(STATUS_LABEL).toEqual({
      THEOREM_BACKED: "THEOREM-BACKED",
      EXPERIMENTAL: "EXPERIMENTAL",
      NOT_COVERED: "NOT COVERED",
    });
  }, 60000);

  it("the ledger shows citations with basis, verification, encoding, limitations, neighbours and reasons", () => {
    const { panels } = openLab();
    configure(panels, { model: "online", rule: "bichromatic", k: 5, bias: "2", enc: "" });
    const want = classify(cfgOf("online", "bichromatic", 5, "2"));
    expect(want.status).toBe("EXPERIMENTAL");
    const body = panels.querySelector("#lab-result-body")?.textContent ?? "";
    for (const lim of want.limitations) expect(body).toContain(lim);
    for (const r of want.reasons) expect(body).toContain(r);
    expect(body).toContain("Nearest theorem-backed neighbours");
    expect(panels.querySelectorAll(".lab-neigh li").length).toBe(want.neighbours.length);
    expect(body).toContain("None: no cited statement covers this configuration.");

    configure(panels, { model: "online", rule: "bichromatic", k: 5, bias: "1", enc: "" });
    const backed = classify(cfgOf("online", "bichromatic", 5, "1"));
    expect(backed.status).toBe("THEOREM_BACKED");
    const items = [...panels.querySelectorAll(".lab-cites li")];
    expect(items.length).toBe(backed.citations.length);
    backed.citations.forEach((c, i) => {
      expect(items[i]?.textContent).toContain(c.rowId);
      expect(items[i]?.textContent).toContain(`basis: ${c.basis}`);
    });
    expect(panels.querySelector("#lab-result-body")?.textContent).toContain(backed.verification);
  });

  it("an experimental configuration never reads as a guarantee", () => {
    const { panels } = openLab();
    configure(panels, { model: "online", rule: "bichromatic", k: 7, bias: "2", enc: "" });
    // every rendered string passes ClaimLint (the lab's own "never a guarantee"
    // sentence is allowed by exact match only)
    expect(lintSources(uiStrings(panels))).toEqual([]);
    const badge = panels.querySelector("#lab-status") as HTMLElement;
    expect(badge.getAttribute("data-status")).toBe("EXPERIMENTAL");
    // the strongest wording near an experimental result is "observation"
    expect(panels.querySelector("#lab-result-body")?.textContent).toContain("is an observation of one sampled play");
    // sweep: nothing rendered over many configurations trips the linter
    for (const [model, rule, k, bias, enc] of [
      ["online", "monochromatic", 5, "1", "esmb-k5"],
      ["online", "bichromatic", 8, "12", ""],
      ["one-round", "bichromatic", 6, "2", ""],
      ["online", "bichromatic", 11, "3/2", "kstrip-bichromatic"],
      ["online", "bichromatic", 3, "17", ""],
    ] as const) {
      configure(panels, { model, rule, k, bias, enc });
      expect(lintSources(uiStrings(panels)), `${model} ${rule} ${k} ${bias} ${enc}`).toEqual([]);
    }
  });

  it("the published round bound is shown for the monochromatic strategy (integer s)", () => {
    const { panels } = openLab();
    configure(panels, { model: "online", rule: "monochromatic", k: 5, bias: "1", t: 1 });
    expect(panels.querySelector(".lab-bound")?.textContent).toContain("at most 106 rounds");
    configure(panels, { bias: "3/2" });
    expect(panels.querySelector(".lab-bound")?.textContent).toContain("none:");
  });
});

describe("Parameter Lab: links appear only where applicable", () => {
  it("Proof mode link only when the encoding offers replay", () => {
    const { panels, shell } = openLab();
    configure(panels, { model: "online", rule: "monochromatic", k: 5, bias: "1", enc: "esmb-k5" });
    expect(classify({ ...cfgOf("online", "monochromatic", 5, "1"), encodingId: "esmb-k5" }).encoding.replayOffered).toBe(true);
    expect(panels.querySelector("#lab-open-proof")).not.toBeNull();
    expect(panels.querySelector("#lab-open-kstrip")).toBeNull();
    // a wrong k for that encoding: it does not apply, so no link
    configure(panels, { k: 6 });
    expect(panels.querySelector("#lab-open-proof")).toBeNull();
    // none selected: no links
    configure(panels, { enc: "", k: 5 });
    expect(panels.querySelector("#lab-open-proof")).toBeNull();
    expect(panels.querySelector("#lab-open-kstrip")).toBeNull();
    // the unverified wide variant exists but is not offered
    configure(panels, { k: 6, enc: "esmb-k6-wide" });
    expect(panels.querySelector("#lab-open-proof")).toBeNull();
    configure(panels, { k: 5, enc: "esmb-k5" });
    click(panels.querySelector("#lab-open-proof"));
    expect(shell.store.current().strategy?.strategyId).toBe("esmb-k5");
  });

  it("k-strip explorer link only for an applicable k-strip encoding, and it opens the explorer", () => {
    const { panels } = openLab();
    configure(panels, { model: "online", rule: "monochromatic", k: 5, bias: "1", enc: "kstrip-mono-1:1" });
    expect(panels.querySelector("#lab-open-proof")).toBeNull();
    expect(panels.querySelector("#lab-open-kstrip")).not.toBeNull();
    configure(panels, { bias: "3/2" });
    expect(panels.querySelector("#lab-open-kstrip")).toBeNull(); // the encoding does not apply at 1:3/2
    configure(panels, { bias: "1" });
    click(panels.querySelector("#lab-open-kstrip"));
    expect(panels.querySelector("#kx-config")).not.toBeNull();
    expect(panels.querySelector("#lab-params")).toBeNull();
  });
});

describe("Parameter Lab: simulation is an observation", () => {
  it("is disabled, with a visible reason, outside EXPERIMENTAL", () => {
    const { panels } = openLab();
    configure(panels, { model: "online", rule: "monochromatic", k: 5, bias: "1" });
    const run = panels.querySelector("#lab-sim-run") as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    expect(panels.querySelector("#lab-sim-why")?.textContent).toContain("EXPERIMENTAL configurations only");
    expect(run.getAttribute("aria-describedby")).toBe("lab-sim-why");
    configure(panels, { model: "online", rule: "bichromatic", k: 10, bias: "2" });
    expect(classify(cfgOf("online", "bichromatic", 10, "2")).status).toBe("NOT_COVERED");
    expect((panels.querySelector("#lab-sim-run") as HTMLButtonElement).disabled).toBe(true);
    expect(panels.querySelector("#lab-sim-why")?.textContent).toContain("No simulation");
  });

  it("completed and budget-exhausted runs are visibly distinct and carry the observation label", async () => {
    const { panels } = openLab();
    // a COMPLETED observation: find a seed where the lab's runner reports completion
    const k3 = cfgOf("online", "bichromatic", 3, "2");
    let seedDone = -1;
    for (let s = 1; s <= 60 && seedDone < 0; s += 1) {
      if (runSimulation(k3, { seed: s }).kind === "completed") seedDone = s;
    }
    expect(seedDone).toBeGreaterThan(0);
    configure(panels, { model: "online", rule: "bichromatic", k: 3, bias: "2" });
    setValue(panels.querySelector("#lab-simulate-seed"), String(seedDone));
    click(panels.querySelector("#lab-sim-run"));
    await until(() => panels.querySelector(".lab-obs") !== null);
    const done = panels.querySelector(".lab-obs-kind") as HTMLElement;
    expect(done.getAttribute("data-kind")).toBe("completed");
    expect(done.textContent).toContain("COMPLETED");
    expect(panels.querySelector(".lab-obs-label")?.textContent).toContain("Observation only");
    expect(panels.querySelector("#lab-sim-out")?.textContent).toContain("Observation (one sampled play)");

    // a BUDGET EXHAUSTED observation
    configure(panels, { model: "online", rule: "bichromatic", k: 7, bias: "2" });
    click(panels.querySelector("#lab-sim-run"));
    await until(() => panels.querySelector(".lab-obs-budgetExhausted") !== null);
    const cut = panels.querySelector(".lab-obs-kind") as HTMLElement;
    expect(cut.getAttribute("data-kind")).toBe("budgetExhausted");
    expect(cut.textContent).toContain("BUDGET EXHAUSTED");
    expect(cut.textContent).toContain("not a finished play");
    const outText = panels.querySelector("#lab-sim-out")?.textContent ?? "";
    expect(outText).not.toMatch(/guarantee|\bproves?\b|\balways\b/i);
    // the transcript is available but collapsed
    expect(panels.querySelectorAll(".lab-transcript li").length).toBeGreaterThan(0);
  }, 60000);

  it("Stop before the run starts records nothing", async () => {
    const { panels } = openLab();
    configure(panels, { model: "online", rule: "bichromatic", k: 7, bias: "2" });
    click(panels.querySelector("#lab-sim-run"));
    expect((panels.querySelector("#lab-sim-stop") as HTMLButtonElement).disabled).toBe(false);
    click(panels.querySelector("#lab-sim-stop"));
    expect(panels.querySelector("#lab-sim-out")?.textContent).toContain("no observation was recorded");
    await new Promise((r) => setTimeout(r, 50));
    expect(panels.querySelector(".lab-obs")).toBeNull();
  });
});

describe("Parameter Lab: discrepancy list", () => {
  it("lists D1–D12 and shows the 8-hole round-count discrepancy", () => {
    const { panels } = openLab();
    for (const d of DISCREPANCIES) {
      const det = panels.querySelector(`#lab-${d.id}`);
      expect(det, d.id).not.toBeNull();
      expect(det?.textContent).toContain(d.where);
    }
    expect(DISCREPANCIES.map((d) => d.id)).toEqual(["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "D11", "D12"]);
    expect(panels.querySelector("#lab-D1")?.textContent).toContain("round 13");
    const rows = [...panels.querySelectorAll("#lab-disc-body tbody tr")];
    const k8 = rows.find((r) => r.querySelector("td")?.textContent === "8");
    expect(k8?.textContent).toContain("no — see D1");
    expect(k8?.textContent).toContain("13");
  });
});

describe("Parameter Lab: experiments", () => {
  it("export downloads parameters + observation; importing the file restores them", async () => {
    const { panels, shell } = openLab();
    const dl = captureDownloads();
    try {
      configure(panels, { model: "online", rule: "bichromatic", k: 3, bias: "2" });
      click(panels.querySelector("#lab-sim-run"));
      await until(() => panels.querySelector(".lab-obs") !== null);
      click(panels.querySelector("#lab-export"));
      expect(dl.names.length).toBe(1);
      expect(dl.names[0]).toContain("lab-k3-bichromatic-online");
      const text = await dl.texts[0];
      const p = parseExperiment(text as string);
      expect(p.ok).toBe(true);
      // load it back through the entry path
      shell.startLab();
      const toasts: string[] = [];
      expect(resumeSession(shell, text as string, (m) => toasts.push(m))).toBe(true);
      expect((panels.querySelector("#lab-k") as HTMLInputElement).value).toBe("3");
      expect((panels.querySelector("#lab-rule") as HTMLSelectElement).value).toBe("bichromatic");
      expect(panels.querySelector(".lab-obs")).not.toBeNull();
    } finally {
      dl.restore();
    }
  }, 60000);

  it("a doctored file is rejected and nothing is mounted over the current screen", () => {
    const { panels, shell } = openLab();
    const cfg = cfgOf("online", "bichromatic", 3, "2");
    const result = runSimulation(cfg, { seed: 2 });
    const settings = { seed: 2, makerPolicy: "random-legal", breakerPolicy: "random-legal", maxRounds: 12, opsBudget: 3_000_000 } as const;
    const file = labExperimentOf(cfg, { settings, result });
    const doc = JSON.parse(experimentText(file)) as { lab: { status: string } };
    doc.lab.status = "THEOREM_BACKED";
    const toasts: string[] = [];
    expect(resumeSession(shell, JSON.stringify(doc), (m) => toasts.push(m))).toBe(false);
    expect(toasts.join(" ")).toContain("Experiment rejected");
    expect(panels.querySelector("#lab-params")).not.toBeNull();
    const bad = resumeSession(shell, '{"format":"playing-the-proof/experiment","version":7}', (m) => toasts.push(m));
    expect(bad).toBe(false);
    expect(toasts.join(" ")).toContain("bad-version");
  });
});

describe("Parameter Lab: keyboard and navigation", () => {
  it("Escape returns to the entry screen; the board shows a regime map built from classify()", () => {
    const { panels, svg } = openLab();
    const cells = svg.querySelectorAll("rect.lab-cell");
    expect(cells.length).toBe(10 * 10); // k 3..12 x 10 biases
    for (const c of cells) {
      const k = Number(c.getAttribute("data-k"));
      const b = c.getAttribute("data-bias") as string;
      const want = classify({ ...cfgOf("online", "monochromatic", k, b.includes("/") ? b : b) }).status;
      expect(c.getAttribute("data-status")).toBe(want);
    }
    // clicking a cell selects its parameters
    const cell = svg.querySelector('rect.lab-cell[data-k="7"][data-bias="12"]') as Element;
    cell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect((panels.querySelector("#lab-k") as HTMLInputElement).value).toBe("7");
    expect((panels.querySelector("#lab-bias") as HTMLInputElement).value).toBe("12");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(panels.querySelector("#entry")).not.toBeNull();
    expect(panels.querySelector("#lab-params")).toBeNull();
  });

  it("the entry screen offers both new modes", () => {
    const { panels, shell } = setupShell();
    shell.showEntry();
    const heads = [...panels.querySelectorAll(".mode-card h2")].map((h) => h.textContent);
    expect(heads).toContain("Parameter Lab");
    expect(heads).toContain("k-strip explorer");
    click(panels.querySelector('button[aria-label="Open the Parameter Lab"]'));
    expect(panels.querySelector("#lab-params")).not.toBeNull();
    expect(panels.querySelector("#entry")).toBeNull();
  });
});
