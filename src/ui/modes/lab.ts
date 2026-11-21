// ui/modes/lab.ts — the Parameter Lab (Mode): choose a game configuration,
// read its epistemic status exactly as lab/classify.ts reports it, and (for
// EXPERIMENTAL configurations only) run a bounded, interruptible simulation
// whose output is labelled as an observation. Statuses are never re-derived
// in UI code; the board shows a map of classify() verdicts.
import { Rat } from "../../geometry/rat.ts";
import {
  DISCREPANCIES,
  SIM_DEFAULT_OPS_BUDGET,
  SIM_DEFAULT_ROUNDS,
  availableControls,
  classify,
  constructionArithmetic,
  formatBias,
  monoRoundBound,
  sourceRow,
} from "../../lab/index.ts";
import type { LabConfig, LabResult, LabStatus, SimResult } from "../../lab/index.ts";
import { downloadReplay, pickReplayFile } from "../replay-io.ts";
import { h, section, svgEl } from "../dom.ts";
import { decodeWire, encodeWire } from "../wire.ts";
import {
  STATUS_LABEL,
  STATUS_MEANING,
  STOP_TEXT,
  configFromInputs,
  runLabSimAsync,
  simKindText,
} from "../lab-core.ts";
import type { SimHandle } from "../lab-core.ts";
import {
  experimentFilename,
  experimentText,
  labExperimentOf,
  looksLikeExperiment,
  parseExperiment,
  replayLabExperiment,
} from "../experiment-io.ts";
import type { LabSimSettings } from "../experiment-io.ts";
import type { ExperimentFile } from "../../replay/experiment.ts";
import { startStrategy } from "../entry.ts";
import type { ModeHandle, Shell } from "../app.ts";

export const LAB_TITLE = "Parameter Lab";

export const LAB_INTRO =
  "Choose a configuration and read which statement of the literature, if any, covers it. The status comes from the lab's classifier; the lab never extrapolates a theorem and never turns a simulation into one.";

export const LAB_SIM_NOTE =
  "Simulations are offered for EXPERIMENTAL configurations only. Each run is one seeded play with simple policies inside a round and work budget; it shows what happened once, not what either player can force.";

export const LAB_DISC_NOTE =
  "Discrepancies found while reading the proposal against the papers (D1 to D12). The 8-hole entry D1 changes a printed round count from 12 to 13.";

function worker(): Worker | null {
  if (typeof Worker === "undefined") {
    return null;
  }
  try {
    return new Worker(new URL("./lab-worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
}

const MAP_BIASES: readonly string[] = ["0", "1/2", "1", "3/2", "2", "3", "5", "8", "12", "16"];

export function mountLab(
  shell: Shell,
  panels: HTMLElement,
  toast: (message: string) => void,
  initial: ExperimentFile | null = null,
): ModeHandle {
  const svg = shell.svg;
  const controls = availableControls();
  const ctl = (id: string): ReturnType<typeof availableControls>[number] => {
    const c = controls.find((x) => x.id === id);
    if (c === undefined) {
      throw new Error(`lab control ${id} missing`);
    }
    return c;
  };
  const kCtl = ctl("k");
  const kMin = kCtl.min ?? 3;
  const kMax = kCtl.max ?? 12;

  // ---- parameter panel: built from availableControls() only ----------------
  const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
  const paramBox = section("lab-params", "Parameters", h("p", { class: "kx-lead" }, LAB_INTRO));
  const makeControl = (id: string): HTMLElement | null => {
    const c = ctl(id);
    let el: HTMLInputElement | HTMLSelectElement;
    if (c.kind === "select") {
      const sel = h("select");
      for (const o of c.options ?? []) {
        sel.append(h("option", { value: o.value }, o.note === undefined ? o.label : `${o.label} [${o.note}]`));
      }
      sel.value = String(c.default ?? "");
      el = sel;
    } else if (c.kind === "integer") {
      el = h("input", {
        type: "number",
        inputmode: "numeric",
        ...(c.min !== undefined ? { min: c.min } : {}),
        ...(c.max !== undefined ? { max: c.max } : {}),
        value: String(c.default ?? ""),
      });
    } else if (c.kind === "rational") {
      el = h("input", { type: "text", inputmode: "decimal", autocomplete: "off", value: String(c.default ?? "") });
    } else {
      return null;
    }
    el.id = `lab-${id.replace(".", "-")}`;
    inputs.set(id, el);
    const wrap = h("div", { class: "fld" });
    wrap.append(h("label", { for: el.id }, c.label), el, h("span", { class: "kx-hint" }, c.help));
    return wrap;
  };
  for (const id of ["model", "rule", "k", "bias", "encoding", "structures"]) {
    const f = makeControl(id);
    if (f !== null) {
      paramBox.append(f);
    }
  }
  const paramMsg = h("p", { id: "lab-param-msg", role: "status" });
  paramBox.append(paramMsg);

  // ---- result ledger ---------------------------------------------------------
  const resultBox = h("div", { id: "lab-result-body", "aria-live": "polite" });
  const resultSection = section("lab-result", "Result ledger", resultBox);

  // ---- simulation --------------------------------------------------------------
  const simBody = h("div", { id: "lab-sim-body" });
  const simSection = section("lab-sim", "Simulation", simBody);
  const simRun = h("button", { id: "lab-sim-run", type: "button" }, "Run bounded simulation");
  const simStop = h("button", { id: "lab-sim-stop", type: "button", disabled: true }, "Stop");
  const simOut = h("div", { id: "lab-sim-out", role: "status" });
  const simControls = h("div", { class: "kx-row" });

  // ---- experiment i/o + discrepancies -----------------------------------------
  const exportBtn = h("button", { id: "lab-export", type: "button" }, "Export experiment");
  const importBtn = h("button", { id: "lab-import", type: "button" }, "Import experiment");
  const menuBtn = h("button", { id: "lab-menu", type: "button", title: "Back to the mode menu (Esc / M)" }, "Menu");
  const ioSection = section(
    "lab-io",
    "Experiment",
    h("p", { class: "kx-hint" }, "Export the parameters, the seed and the recorded observation; an import re-runs the classifier and the simulation and compares them with the file."),
    h("div", { class: "kx-row" }, exportBtn, importBtn, menuBtn),
  );
  const discBody = h("div", { id: "lab-disc-body" });
  const discSection = section("lab-disc", "Discrepancies D1–D12", h("p", { class: "kx-hint" }, LAB_DISC_NOTE), discBody);

  panels.append(paramBox, resultSection, simSection, discSection, ioSection);

  // ---- state ----------------------------------------------------------------------
  let config: LabConfig | null = null;
  let result: LabResult | null = null;
  let lastSim: { settings: LabSimSettings; result: SimResult } | null = null;
  let handle: SimHandle | null = null;
  let destroyed = false;
  let simRunning = false;

  const readInputs = (): ReturnType<typeof configFromInputs> =>
    configFromInputs(
      {
        model: inputs.get("model")?.value ?? "",
        rule: inputs.get("rule")?.value ?? "",
        k: inputs.get("k")?.value ?? "",
        bias: inputs.get("bias")?.value ?? "",
        encoding: inputs.get("encoding")?.value ?? "",
        structures: inputs.get("structures")?.value ?? "",
      },
      { kMin, kMax },
    );

  function simSettings(): LabSimSettings {
    const seed = Number(simInputs.seed.value);
    return {
      seed: Number.isInteger(seed) && seed >= 0 && seed <= 4294967295 ? seed : 1,
      makerPolicy: simInputs.maker.value === "greedy" ? "greedy" : "random-legal",
      breakerPolicy: simInputs.breaker.value === "greedy" ? "greedy" : "random-legal",
      maxRounds: SIM_DEFAULT_ROUNDS,
      opsBudget: SIM_DEFAULT_OPS_BUDGET,
    };
  }

  // simulation controls come from availableControls() as well
  const simInputs = (() => {
    const mk = (id: string): HTMLSelectElement | HTMLInputElement => {
      const c = ctl(id);
      let el: HTMLSelectElement | HTMLInputElement;
      if (c.kind === "select") {
        const sel = h("select");
        for (const o of c.options ?? []) {
          sel.append(h("option", { value: o.value }, o.label));
        }
        sel.value = String(c.default ?? "");
        el = sel;
      } else {
        el = h("input", { type: "number", min: c.min ?? 0, value: String(c.default ?? 0), inputmode: "numeric" });
      }
      el.id = `lab-${id.replace(".", "-")}`;
      const wrap = h("div", { class: "fld" });
      wrap.append(h("label", { for: el.id }, c.label), el);
      simControls.append(wrap);
      return el;
    };
    return {
      breaker: mk("simulate.breakerPolicy") as HTMLSelectElement,
      maker: mk("simulate.makerPolicy") as HTMLSelectElement,
      seed: mk("simulate.seed") as HTMLInputElement,
    };
  })();

  // ---- rendering --------------------------------------------------------------------
  function refresh(): void {
    if (destroyed) {
      return;
    }
    const r = readInputs();
    if (!r.ok) {
      config = null;
      result = null;
      paramMsg.textContent = r.message;
      resultBox.replaceChildren(h("p", {}, "Fix the parameters above to see a result."));
    } else {
      paramMsg.textContent = "";
      config = r.config;
      result = classify(r.config);
      renderResult(result, r.config);
    }
    renderSim();
    renderDiscrepancies();
    drawMap();
  }

  function renderResult(res: LabResult, cfg: LabConfig): void {
    resultBox.replaceChildren();
    const badge = h(
      "span",
      { class: "status-badge lab-badge", "data-status": res.status, id: "lab-status", role: "status" },
      STATUS_LABEL[res.status],
    );
    badge.setAttribute("aria-label", `Status: ${STATUS_LABEL[res.status]}`);
    resultBox.append(
      h("p", { class: "lab-statusline" }, badge, ` ${formatBias(cfg.bias)}, k = ${cfg.k}, ${cfg.model}, ${cfg.rule}`),
      h("p", { class: "kx-lead" }, STATUS_MEANING[res.status]),
    );
    if (res.invalid.length > 0) {
      const ul = h("ul", { class: "lab-invalid" });
      for (const m of res.invalid) {
        ul.append(h("li", {}, m));
      }
      resultBox.append(h("h4", {}, "Invalid parameters"), ul);
    }
    // citations
    resultBox.append(h("h4", {}, "Citations"));
    if (res.citations.length === 0) {
      resultBox.append(h("p", {}, "None: no cited statement covers this configuration."));
    } else {
      const ul = h("ul", { class: "lab-cites" });
      for (const c of res.citations) {
        const row = sourceRow(c.rowId);
        ul.append(
          h(
            "li",
            {},
            h("span", { class: "tier tier-theorem-cited" }, c.rowId),
            ` basis: ${c.basis}. ${c.note}`,
            row === undefined ? null : h("div", { class: "source-ref" }, `${row.source} — ${row.statement}`),
          ),
        );
      }
      resultBox.append(ul);
    }
    resultBox.append(
      h("p", {}, h("strong", {}, "Strongest basis: "), res.basis === null ? "none" : res.basis),
      h("p", {}, h("strong", {}, "Verification: "), res.verification),
    );
    // encoding
    const e = res.encoding;
    resultBox.append(
      h("h4", {}, "Encoded strategy"),
      h(
        "p",
        {},
        e.requested === null
          ? "No encoded variant selected."
          : `${e.requested}: ${e.applies ? "applies to this exact game" : "does not apply to this exact game"}; availability ${e.availability}.`,
      ),
      h("p", { class: "kx-hint" }, e.note),
    );
    const links = h("div", { class: "kx-row lab-links" });
    if (e.replayOffered && e.requested !== null) {
      const id = e.requested;
      const b = h("button", { id: "lab-open-proof", type: "button" }, "Open in Proof mode");
      b.addEventListener("click", () => startStrategy(shell, id, "proof"));
      links.append(b);
    }
    if (e.requested !== null && e.requested.startsWith("kstrip-") && e.applies) {
      const b = h("button", { id: "lab-open-kstrip", type: "button" }, "Open the k-strip explorer");
      b.addEventListener("click", () => shell.startKStrip());
      links.append(b, h("span", { class: "kx-hint" }, "The explorer runs verified instances only; it is not an interactive replay of this game."));
    }
    if (links.childElementCount > 0) {
      resultBox.append(links);
    }
    // limitations, neighbours, reasons
    const listOf = (title: string, items: readonly string[]): void => {
      if (items.length === 0) {
        return;
      }
      const ul = h("ul");
      for (const m of items) {
        ul.append(h("li", {}, m));
      }
      resultBox.append(h("h4", {}, title), ul);
    };
    listOf("Limitations", res.limitations);
    if (res.neighbours.length > 0) {
      const ul = h("ul", { class: "lab-neigh" });
      for (const n of res.neighbours) {
        ul.append(
          h(
            "li",
            {},
            `${n.label}: model ${n.config.model}, k = ${n.config.k}, bias ${n.config.bias}, rule ${n.config.rule} (changes: ${n.changed.join(", ") || "none"}; rows ${n.citedRows.join(", ")})`,
          ),
        );
      }
      resultBox.append(h("h4", {}, "Nearest theorem-backed neighbours"), ul);
    }
    listOf("Reasons", res.reasons);
    resultBox.append(
      h("p", {}, h("strong", {}, "Simulation: "), `${res.simulation.available ? "available" : "not available"} — ${res.simulation.reason}`),
    );
    // published round bound (mono strategy, integer s)
    if (cfg.rule === "monochromatic") {
      const rb = monoRoundBound(cfg.k, cfg.structures, cfg.bias);
      resultBox.append(
        h(
          "p",
          { class: "lab-bound" },
          h("strong", {}, "Published round bound: "),
          rb.kind === "bound"
            ? `at most ${rb.rounds.d === 1n ? String(rb.rounds.n) : `${String(rb.rounds.n)}/${String(rb.rounds.d)}`} rounds for t = ${cfg.structures} k-strips (${rb.source}); an upper bound stated in the source, not an observation.`
            : `none: ${rb.reason}.`,
        ),
      );
    }
  }

  function renderSim(): void {
    simBody.replaceChildren(h("p", { class: "kx-hint" }, LAB_SIM_NOTE));
    if (result === null || config === null) {
      return;
    }
    const experimental = result.status === "EXPERIMENTAL";
    simBody.append(simControls, h("div", { class: "kx-row" }, simRun, simStop), simOut);
    const why = experimental
      ? ""
      : result.status === "THEOREM_BACKED"
        ? "Simulation is offered for EXPERIMENTAL configurations only: this configuration is backed by a cited statement."
        : `No simulation for this configuration: ${result.simulation.reason}`;
    simRun.disabled = !experimental || simRunning;
    simRun.setAttribute("aria-describedby", "lab-sim-why");
    simBody.append(h("p", { id: "lab-sim-why", class: "kx-avail kx-avail-estimate-only" }, why));
    if (why === "") {
      simBody.lastElementChild?.setAttribute("hidden", "");
    }
  }

  function renderSimResult(res: SimResult, settings: LabSimSettings): void {
    simOut.replaceChildren();
    if (res.kind === "unsupported") {
      simOut.append(h("p", {}, `Unsupported: ${res.reason}`));
      return;
    }
    const o = res.observed;
    const box = h("div", { class: `lab-obs lab-obs-${res.kind}` });
    box.append(
      h("h4", {}, "Observation (one sampled play)"),
      h("p", { class: "lab-obs-kind", "data-kind": res.kind }, simKindText(res.kind)),
      h("p", {}, `Stopped because ${STOP_TEXT[res.stoppedBy]}.`),
      h("p", { class: "lab-obs-label" }, res.label),
      h(
        "p",
        {},
        `Seed ${settings.seed}; Maker ${settings.makerPolicy}, Breaker ${settings.breakerPolicy}; ${o.rounds} round(s), ${o.makerPoints} Maker and ${o.breakerPoints} Breaker point(s); ` +
          `${o.holeFound ? `a ${o.k}-hole appeared in round ${String(o.holeRound)} (points ${(o.witness ?? []).join(", ")})` : `no ${o.k}-hole appeared`}; ${o.opsUsed} exact-geometry operations.`,
      ),
    );
    const det = h("details", {}, h("summary", {}, `Transcript (${o.transcript.length} placements)`));
    const ol = h("ol", { class: "lab-transcript" });
    for (const t of o.transcript) {
      ol.append(h("li", {}, t));
    }
    det.append(ol);
    box.append(det);
    simOut.append(box);
  }

  function runSim(): void {
    if (config === null || result === null || result.status !== "EXPERIMENTAL" || simRunning) {
      return;
    }
    const settings = simSettings();
    const cfg = config;
    simRunning = true;
    simRun.disabled = true;
    simStop.disabled = false;
    simOut.replaceChildren(h("p", {}, "Running… the page stays responsive; Stop discards the run."));
    const finish = (res: SimResult): void => {
      if (destroyed) {
        return;
      }
      simRunning = false;
      simStop.disabled = true;
      simRun.disabled = false;
      handle = null;
      lastSim = { settings, result: res };
      renderSimResult(res, settings);
    };
    const fail = (m: string): void => {
      if (destroyed) {
        return;
      }
      if (m === "the worker failed to start") {
        handle = runLabSimAsync(cfg, settings, finish, fail, null, (v) => v as SimResult, (c) => c);
        return;
      }
      simRunning = false;
      simStop.disabled = true;
      simRun.disabled = false;
      handle = null;
      simOut.replaceChildren(h("p", {}, `The simulation could not run: ${m}`));
    };
    handle = runLabSimAsync(
      cfg,
      settings,
      finish,
      fail,
      worker,
      (v) => decodeWire(v) as SimResult,
      (c) => encodeWire(c),
    );
  }
  simRun.addEventListener("click", runSim);
  simStop.addEventListener("click", () => {
    handle?.cancel();
    handle = null;
    simRunning = false;
    simStop.disabled = true;
    simRun.disabled = result?.status !== "EXPERIMENTAL";
    simOut.replaceChildren(h("p", {}, "Stopped: no observation was recorded."));
  });

  function renderDiscrepancies(): void {
    if (discBody.childElementCount > 0) {
      return;
    }
    const ul = h("ul", { class: "lab-disc-list" });
    for (const d of DISCREPANCIES) {
      const det = h("details", { id: `lab-${d.id}` });
      det.append(
        h("summary", {}, `${d.id} — ${d.where}`),
        h("p", {}, d.finding),
        h("p", { class: "kx-hint" }, `Effect on the lab: ${d.effectOnLab}`),
      );
      ul.append(h("li", {}, det));
    }
    discBody.append(ul);
    const tbl = h("table", { class: "kx-table" });
    tbl.append(
      h(
        "thead",
        {},
        h("tr", {}, ...["k", "Rounds (recomputed)", "Points", "Printed rounds", "Printed points", "Consistent"].map((c) => h("th", { scope: "col" }, c))),
      ),
    );
    const tb = h("tbody");
    for (const r of constructionArithmetic()) {
      tb.append(
        h(
          "tr",
          { class: r.consistent ? "" : "kx-dead" },
          ...[
            String(r.k),
            String(r.rounds),
            String(r.points),
            r.printedRounds === null ? "—" : String(r.printedRounds),
            r.printedPoints === null ? "—" : String(r.printedPoints),
            r.consistent ? "yes" : "no — see D1",
          ].map((c) => h("td", {}, c)),
        ),
      );
    }
    tbl.append(tb);
    discBody.append(
      h("h4", {}, "Das–Valla construction arithmetic (D1)"),
      h("div", { class: "kx-scroll" }, tbl),
    );
  }

  // ---- board: a map of classify() verdicts over (k, bias) ------------------------------
  const mapCache = new Map<string, LabStatus>();
  function statusAt(model: string, rule: string, k: number, bias: string, enc: string, t: number): LabStatus | null {
    const key = `${model}|${rule}|${k}|${bias}|${enc}|${t}`;
    const hit = mapCache.get(key);
    if (hit !== undefined) {
      return hit;
    }
    const r = configFromInputs(
      { model, rule, k: String(k), bias, encoding: "", structures: String(t) },
      { kMin, kMax },
    );
    if (!r.ok) {
      return null;
    }
    const st = classify(r.config).status;
    mapCache.set(key, st);
    return st;
  }

  let mapSig = "";
  function markCurrentCell(): void {
    const curK = Number(inputs.get("k")?.value);
    const curBias = config === null ? null : config.bias;
    for (const c of svg.querySelectorAll("rect.lab-cell")) {
      const b = c.getAttribute("data-bias") ?? "";
      const rb = Rat.fromString(b.includes("/") ? b : `${b}/1`);
      c.classList.toggle(
        "lab-cell-current",
        Number(c.getAttribute("data-k")) === curK && curBias !== null && curBias.equals(rb),
      );
    }
  }

  function drawMap(force = false): void {
    const w = svg.clientWidth > 0 ? svg.clientWidth : 800;
    const hgt = svg.clientHeight > 0 ? svg.clientHeight : 600;
    const model = inputs.get("model")?.value ?? "online";
    const rule = inputs.get("rule")?.value ?? "monochromatic";
    const sig = `${model}|${rule}|${w}x${hgt}`;
    if (sig === mapSig && !force) {
      markCurrentCell();
      return;
    }
    mapSig = sig;
    svg.replaceChildren();
    const ks: number[] = [];
    for (let k = kMin; k <= kMax; k += 1) {
      ks.push(k);
    }
    const left = 76;
    const top = 70;
    const cw = (w - left - 24) / ks.length;
    const ch = (hgt - top - 60) / MAP_BIASES.length;
    svg.append(svgEl("text", { x: 14, y: 24, class: "viz-label" }, `Regime map for the ${model} game, ${rule} rule: classifier verdict for each (k, bias 1:s)`));
    svg.append(svgEl("text", { x: 14, y: 42, class: "viz-label kx-note" }, "Each cell is one call of the classifier with no encoded variant. Click a cell to select it."));
    ks.forEach((k, ci) => {
      svg.append(svgEl("text", { x: left + ci * cw + cw / 2 - 4, y: top - 8, class: "viz-label" }, String(k)));
    });
    svg.append(svgEl("text", { x: left, y: top - 24, class: "viz-label" }, "k →"));
    const curK = Number(inputs.get("k")?.value);
    const curBias = config === null ? null : config.bias;
    MAP_BIASES.forEach((b, ri) => {
      const rb = Rat.fromString(b.includes("/") ? b : `${b}/1`);
      svg.append(svgEl("text", { x: 12, y: top + ri * ch + ch / 2 + 4, class: "viz-label" }, `1:${b}`));
      ks.forEach((k, ci) => {
        const st = statusAt(model, rule, k, b, "", config?.structures ?? 1);
        if (st === null) {
          return;
        }
        const x = left + ci * cw;
        const y = top + ri * ch;
        const isCur = k === curK && curBias !== null && curBias.equals(rb);
        const cell = svgEl("rect", {
          x: x + 1,
          y: y + 1,
          width: cw - 2,
          height: ch - 2,
          class: `lab-cell lab-cell-${st}${isCur ? " lab-cell-current" : ""}`,
          "data-k": k,
          "data-bias": b,
          "data-status": st,
        });
        cell.append(svgEl("title", {}, `k = ${k}, 1:${b}: ${STATUS_LABEL[st]}`));
        svg.append(cell);
        svg.append(svgEl("text", { x: x + cw / 2 - 3, y: y + ch / 2 + 4, class: "lab-cell-glyph" }, st === "THEOREM_BACKED" ? "T" : st === "EXPERIMENTAL" ? "E" : "N"));
      });
    });
    svg.append(
      svgEl("text", { x: left, y: hgt - 22, class: "viz-label" }, "T theorem-backed · E experimental · N not covered"),
    );
    svg.setAttribute("aria-label", `Regime map: classifier verdicts for the ${model} game, ${rule} rule`);
  }

  const onMapClick = (e: MouseEvent): void => {
    const t = e.target;
    if (!(t instanceof SVGElement) || !t.classList.contains("lab-cell")) {
      return;
    }
    const k = t.getAttribute("data-k");
    const b = t.getAttribute("data-bias");
    if (k === null || b === null) {
      return;
    }
    (inputs.get("k") as HTMLInputElement).value = k;
    (inputs.get("bias") as HTMLInputElement).value = b;
    refresh();
  };
  svg.addEventListener("click", onMapClick);

  // ---- events ---------------------------------------------------------------------------
  for (const el of inputs.values()) {
    el.addEventListener("input", refresh);
    el.addEventListener("change", refresh);
  }
  menuBtn.addEventListener("click", () => shell.toEntry());
  exportBtn.addEventListener("click", () => {
    if (config === null) {
      toast("Fix the parameters first.");
      return;
    }
    const file = labExperimentOf(config, lastSim, `lab ${config.rule} k=${config.k} ${formatBias(config.bias)}`);
    downloadReplay(experimentFilename(file), experimentText(file));
    toast("Experiment exported: parameters, seed and observation.");
  });
  importBtn.addEventListener("click", () => {
    pickReplayFile(toast).then(
      (text) => {
        if (text !== null) {
          loadText(text);
        }
      },
      () => toast("Experiment unreadable."),
    );
  });

  function loadText(text: string): boolean {
    if (!looksLikeExperiment(text)) {
      toast("Not an experiment file.");
      return false;
    }
    const p = parseExperiment(text);
    if (!p.ok) {
      toast(`Experiment rejected: ${p.issues.slice(0, 3).map((i) => `${i.code} at ${i.path || "file"}`).join("; ")}`);
      return false;
    }
    return apply(p.file);
  }

  function apply(file: ExperimentFile): boolean {
    if (file.kind !== "lab") {
      toast("This is a k-strip experiment; open it from the k-strip explorer.");
      return false;
    }
    const rep = replayLabExperiment(file.lab);
    if (!rep.ok) {
      toast(`Experiment rejected: ${rep.issues.join("; ")}`);
      return false;
    }
    const c = rep.config;
    (inputs.get("model") as HTMLSelectElement).value = c.model;
    (inputs.get("rule") as HTMLSelectElement).value = c.rule;
    (inputs.get("k") as HTMLInputElement).value = String(c.k);
    (inputs.get("bias") as HTMLInputElement).value = c.bias.d === 1n ? String(c.bias.n) : c.bias.toString();
    (inputs.get("encoding") as HTMLSelectElement).value = c.encodingId ?? "";
    (inputs.get("structures") as HTMLInputElement).value = String(c.structures);
    refresh();
    if (rep.result !== null && file.lab.simulation !== null) {
      const s = file.lab.simulation;
      const settings: LabSimSettings = {
        seed: s.seed,
        makerPolicy: s.makerPolicy,
        breakerPolicy: s.breakerPolicy,
        maxRounds: s.maxRounds,
        opsBudget: s.opsBudget,
      };
      simInputs.seed.value = String(s.seed);
      simInputs.maker.value = s.makerPolicy;
      simInputs.breaker.value = s.breakerPolicy;
      lastSim = { settings, result: rep.result };
      renderSimResult(rep.result, settings);
    }
    toast("Replay verified: the classifier and the recorded simulation reproduce the file.");
    return true;
  }

  const onKey = (e: KeyboardEvent): void => {
    if (!document.contains(svg)) {
      document.removeEventListener("keydown", onKey);
      return;
    }
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) {
      return;
    }
    if (e.key === "Escape" || e.key === "m" || e.key === "M") {
      shell.toEntry();
    }
  };
  document.addEventListener("keydown", onKey);

  refresh();
  if (initial !== null) {
    apply(initial);
  }

  return {
    onResize(): void {
      drawMap(true);
    },
    destroy(): void {
      destroyed = true;
      handle?.cancel();
      svg.removeEventListener("click", onMapClick);
      document.removeEventListener("keydown", onKey);
      for (const s of [paramBox, resultSection, simSection, discSection, ioSection]) {
        s.remove();
      }
      svg.setAttribute("aria-label", "Point plane: the evolving Maker–Breaker configuration");
    },
  };
}
