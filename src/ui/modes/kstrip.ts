// ui/modes/kstrip.ts — the k-strip explorer (Mode): choose a verified
// configuration, see the cost estimate BEFORE running, run the exact
// construction (Web Worker when available), then step through the move log
// with the counting ledger, extension cones, candidate pairs, Breaker reasons
// and the recursion table. "Break the Proof" lets the user play Breaker in the
// top pairing phase. All geometry comes from src/kstrip.
import { Rat } from "../../geometry/rat.ts";
import { pt } from "../../geometry/pt.ts";
import type { Pt } from "../../geometry/pt.ts";
import {
  StripRegion,
  extensionCone,
  fromFrame,
  sharedHalfline,
} from "../../kstrip/index.ts";
import type { Dir, MoveLogEntry, TraceEvent } from "../../kstrip/index.ts";
import {
  conePolygon,
  dirToScreen,
  fitAniso,
  fromScreenAniso,
  halflineEnd,
  pointsAttr,
  regionPolygon,
  toScreenAniso,
} from "../../viz/aniso.ts";
import type { AnisoView } from "../../viz/aniso.ts";
import { downloadReplay, pickReplayFile } from "../replay-io.ts";
import { h, field, ratText, section, shortRat, svgEl } from "../dom.ts";
import { decodeWire } from "../wire.ts";
import {
  POLICY_IDS,
  POLICY_LABELS,
  SUPPORTED,
  VARIANT_LABELS,
  availability,
  availabilityText,
  breakTargetLevel,
  breakable,
  buildSteps,
  describePreview,
  fmtRat,
  isSupported,
  ledgerFor,
  parseS,
  phaseChips,
  placementText,
  reasonText,
  recursionTable,
  runBreak,
  runExplorerAsync,
  setDefaultWorkerFactory,
} from "../kstrip-core.ts";
import type {
  ExplorerParams,
  ExplorerRun,
  PendingBreak,
  PolicyId,
  RunHandle,
  Step,
} from "../kstrip-core.ts";
import {
  experimentFilename,
  experimentText,
  kstripExperimentOf,
  looksLikeExperiment,
  parseExperiment,
  replayKStripExperiment,
} from "../experiment-io.ts";
import type { BreakScript } from "../kstrip-core.ts";
import type { ExperimentFile } from "../../replay/experiment.ts";
import type { Variant } from "../../kstrip/index.ts";
import type { ModeHandle, Shell } from "../app.ts";
import {
  BREAK_DONE_NOTE,
  BREAK_INTRO,
  CLAIM_TIERS,
  CLIP_NOTE,
  ESTIMATE_NOTE,
  EXPLORER_INTRO,
  EXPLORER_TITLE,
  RESULT_TEXT,
  SCOPE_NOTE,
  explainStep,
} from "./kstrip-copy.ts";

type LedgerEvent = Extract<TraceEvent, { kind: "ledger" }>;

const DOWN_DIR: Dir = { x: Rat.ZERO, y: Rat.make(-1n) };

function makeWorker(): Worker | null {
  if (typeof Worker === "undefined") {
    return null;
  }
  try {
    return new Worker(new URL("./kstrip-worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
}

export function mountKStrip(
  shell: Shell,
  panels: HTMLElement,
  toast: (message: string) => void,
  initial: ExperimentFile | null = null,
): ModeHandle {
  setDefaultWorkerFactory(makeWorker);
  const svg = shell.svg;

  // ---- state ---------------------------------------------------------------
  let run: ExplorerRun | null = null;
  let steps: Step[] = [];
  let stepIdx = 0;
  let playing = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let handle: RunHandle | null = null;
  let running = false;
  let selStrip = -1;
  let selUnit = -1;
  let showMinus = true;
  let showPlus = true;
  let sub: "explore" | "break" = "explore";
  let breakPts: Pt[] = [];
  let pending: PendingBreak | null = null;
  let breakParams: ExplorerParams | null = null;
  let candidate: Pt | null = null;
  let view: AnisoView | null = null;
  let destroyed = false;
  let lastVariant: Variant = "mono-1:1";

  // ---- configuration section -----------------------------------------------
  const variantSel = h("select");
  for (const v of ["mono-1:1", "mono-1:s", "bichromatic"] as const) {
    variantSel.append(h("option", { value: v }, VARIANT_LABELS[v]));
  }
  const kIn = h("input", { type: "number", min: 1, max: 12, value: 3, inputmode: "numeric" });
  const tIn = h("input", { type: "number", min: 1, max: 50, value: 1, inputmode: "numeric" });
  const tLabel = h("span", {}, "t (parallel strips required)");
  const sIn = h("input", { type: "text", value: "2", inputmode: "decimal", autocomplete: "off" });
  const sNote = h("span", { class: "kx-hint" }, "");
  const policySel = h("select");
  for (const p of POLICY_IDS) {
    policySel.append(h("option", { value: p }, POLICY_LABELS[p]));
  }
  policySel.value = "strategy-aware";
  const seedIn = h("input", { type: "number", min: 0, max: 4294967295, value: 1, inputmode: "numeric" });
  const estimateBox = h("div", { id: "kx-estimate" });
  const availBox = h("p", { id: "kx-availability", role: "status" });
  const runBtn = h("button", { id: "kx-run", type: "button" }, "Run");
  const stopBtn = h("button", { id: "kx-stop", type: "button", disabled: true }, "Stop");
  const menuBtn = h("button", { id: "kx-menu", type: "button", title: "Back to the mode menu (Esc / M)" }, "Menu");
  const tableBox = h("details", { id: "kx-table" });
  const sField = field("kx-s", "s (Breaker points per Maker point)", sIn);
  sField.append(sNote);
  const seedField = field("kx-seed", "Seed (random policy)", seedIn);
  const tField = h("div", { class: "fld" });
  tField.append(h("label", { for: "kx-t" }, tLabel), tIn);
  tIn.id = "kx-t";
  const configSection = section(
    "kx-config",
    "Configuration",
    h("p", { class: "kx-lead" }, EXPLORER_INTRO),
    field("kx-variant", "Variant", variantSel),
    field("kx-k", "k (strip size)", kIn),
    tField,
    sField,
    field("kx-policy", "Breaker policy", policySel),
    seedField,
    estimateBox,
    availBox,
    h("div", { class: "kx-row" }, runBtn, stopBtn, menuBtn),
    tableBox,
  );

  // ---- run summary + export/import ---------------------------------------
  const runStatus = h("p", { id: "kx-run-status", role: "status" });
  const runFacts = h("p", { id: "kx-run-facts", class: "kx-facts" });
  const exportBtn = h("button", { id: "kx-export", type: "button", disabled: true }, "Export experiment");
  const importBtn = h("button", { id: "kx-import", type: "button" }, "Import experiment");
  const checksBox = h("details", { id: "kx-checks" });
  const runSection = section(
    "kx-run-panel",
    "Run",
    runStatus,
    runFacts,
    h("div", { class: "kx-row" }, exportBtn, importBtn),
    checksBox,
  );

  // ---- stepper -------------------------------------------------------------
  const chipsBox = h("div", { class: "kx-chips", role: "group", "aria-label": "Phases of the run" });
  const firstBtn = h("button", { id: "kx-first", type: "button" }, "⏮ Restart");
  const prevBtn = h("button", { id: "kx-prev", type: "button" }, "◀ Back");
  const playBtn = h("button", { id: "kx-play", type: "button", "aria-pressed": "false" }, "▶ Play");
  const nextBtn = h("button", { id: "kx-next", type: "button" }, "Next ▶");
  const slider = h("input", { id: "kx-slider", type: "range", min: 0, max: 0, value: 0 });
  const sliderLabel = h("label", { for: "kx-slider" }, "Step");
  const speedSel = h("select");
  for (const [v, l] of [
    ["700", "Slow"],
    ["300", "Normal"],
    ["80", "Fast"],
  ] as const) {
    speedSel.append(h("option", { value: v }, l));
  }
  speedSel.value = "300";
  const caption = h("p", { id: "kx-caption", role: "status", "aria-live": "polite" });
  const explainBox = h("dl", { id: "kx-explain", class: "kx-explain" });
  const stepperSection = section(
    "kx-stepper",
    "Stepper",
    chipsBox,
    h("div", { class: "kx-row" }, firstBtn, prevBtn, playBtn, nextBtn),
    h("div", { class: "kx-row" }, sliderLabel, slider, field("kx-speed", "Speed", speedSel)),
    caption,
    explainBox,
  );

  // ---- ledger / inspect / reason / recursion / break / claims ------------
  const ledgerBox = h("div", { id: "kx-ledger-body" });
  const ledgerSection = section("kx-ledger", "Counting ledger", ledgerBox);
  const stripSel = h("select");
  const unitSel = h("select");
  const minusCk = h("input", { type: "checkbox", checked: true });
  const plusCk = h("input", { type: "checkbox", checked: true });
  const inspectInfo = h("div", { id: "kx-inspect-info", role: "status" });
  const inspectSection = section(
    "kx-inspect",
    "Inspect",
    field("kx-strip-sel", "Strip", stripSel),
    h("div", { class: "fld" }, h("label", { for: "kx-cone-minus" }, minusCk, " Cone C− (left of the first vertex)")),
    h("div", { class: "fld" }, h("label", { for: "kx-cone-plus" }, plusCk, " Cone C+ (right of the last vertex)")),
    field("kx-unit-sel", "Candidate pair", unitSel),
    inspectInfo,
    h("p", { class: "kx-hint" }, CLIP_NOTE),
  );
  minusCk.id = "kx-cone-minus";
  plusCk.id = "kx-cone-plus";
  const reasonBox = h("div", { id: "kx-reason-body", role: "status" });
  const reasonSection = section("kx-reason", "Breaker move", reasonBox);
  const recBox = h("div", { id: "kx-rec-body" });
  const recSection = section("kx-recursion", "Recursion", recBox);

  const breakBody = h("div", { id: "kx-break-body" });
  const breakSection = section("kx-break", "Break the Proof", breakBody);
  const claimsSection = section(
    "kx-claims",
    "What is claimed",
    h(
      "ul",
      { class: "kx-tiers" },
      ...CLAIM_TIERS.map((t) =>
        h("li", {}, h("span", { class: "tier tier-" + t.label.split(" ")[0] }, t.tag), ` ${t.label}: ${t.text}`),
      ),
    ),
    h("p", { class: "kx-hint" }, SCOPE_NOTE),
  );

  panels.append(
    configSection,
    runSection,
    stepperSection,
    ledgerSection,
    inspectSection,
    reasonSection,
    breakSection,
    recSection,
    claimsSection,
  );

  const boardHeading = EXPLORER_TITLE;
  svg.setAttribute("aria-label", `${boardHeading}: points and candidate regions`);

  // ---- helpers -------------------------------------------------------------
  const current = (): Step | null => steps[stepIdx] ?? null;

  function readParams(): { ok: true; params: ExplorerParams } | { ok: false; message: string } {
    const variant = variantSel.value as Variant;
    const k = Number(kIn.value);
    const t = Number(tIn.value);
    if (!Number.isInteger(k) || k < 1 || k > 12) {
      return { ok: false, message: "k must be an integer from 1 to 12." };
    }
    if (!Number.isInteger(t) || t < 1 || t > 50) {
      return { ok: false, message: "t must be an integer from 1 to 50." };
    }
    const s = parseS(variant, sIn.value);
    if (!s.ok) {
      return { ok: false, message: s.message };
    }
    const seed = Number(seedIn.value);
    if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) {
      return { ok: false, message: "The seed must be an integer from 0 to 4294967295." };
    }
    return {
      ok: true,
      params: { variant, k, t, s: s.s, policy: policySel.value as PolicyId, seed },
    };
  }

  function syncFormShape(): void {
    const v = variantSel.value as Variant;
    sField.hidden = v === "mono-1:1";
    seedField.hidden = policySel.value !== "random-legal";
    tLabel.textContent =
      v === "bichromatic" ? "r (parallel strips required)" : "t (parallel strips required)";
    sNote.textContent =
      v === "mono-1:s"
        ? "integer s >= 1"
        : v === "bichromatic"
          ? "rational, 0 <= s < 2 (for example 3/2)"
          : "";
    // Only when the variant CHANGES is s reset to a sensible default for it;
    // what the user types is never silently rewritten.
    if (v !== lastVariant) {
      lastVariant = v;
      if (v === "mono-1:s" && !/^[1-9]\d*$/.test(sIn.value.trim())) {
        sIn.value = "2";
      }
      if (v === "bichromatic" && /^\d+$/.test(sIn.value.trim()) && Number(sIn.value) >= 2) {
        sIn.value = "1";
      }
    }
  }

  function refreshAvailability(): void {
    syncFormShape();
    const r = readParams();
    estimateBox.replaceChildren();
    if (!r.ok) {
      availBox.textContent = r.message;
      runBtn.disabled = true;
      runBtn.setAttribute("aria-describedby", "kx-availability");
      return;
    }
    const a = availability(r.params);
    const est = a.estimate;
    if (est.supported) {
      const dl = h("dl", { class: "kx-est" });
      const row = (k: string, v: string): void => {
        dl.append(h("dt", {}, k), h("dd", {}, v));
      };
      row("Points", String(est.points));
      row("Rounds", String(est.rounds));
      row("Peak strips", String(est.peakStrips));
      row("Regions examined", String(est.regions));
      row("Abstract work", String(est.work));
      estimateBox.append(h("h4", {}, "Estimate (before running)"), dl);
      const tbl = h("table", { class: "kx-table" });
      tbl.append(
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            ...["Level", "Kind", "Strips", "Maker", "Breaker", "Units"].map((c) => h("th", { scope: "col" }, c)),
          ),
        ),
      );
      const tb = h("tbody");
      for (const l of est.levels) {
        tb.append(
          h(
            "tr",
            {},
            ...[String(l.level), l.kind, String(l.strips), String(l.makerMoves), String(l.breakerMoves), String(l.units)].map(
              (c) => h("td", {}, c),
            ),
          ),
        );
      }
      tbl.append(tb);
      estimateBox.append(h("div", { class: "kx-scroll" }, tbl), h("p", { class: "kx-hint" }, ESTIMATE_NOTE));
    }
    availBox.textContent = availabilityText(a);
    availBox.className = `kx-avail kx-avail-${a.kind}`;
    runBtn.disabled = a.kind !== "runnable" || running;
    runBtn.setAttribute("aria-describedby", "kx-availability");
  }

  function paintTable(): void {
    tableBox.replaceChildren();
    tableBox.append(h("summary", {}, "Verified configurations (the only ones that can run)"));
    const tbl = h("table", { class: "kx-table" });
    tbl.append(
      h("thead", {}, h("tr", {}, ...["Variant", "k", "s", "t", ""].map((c) => h("th", { scope: "col" }, c)))),
    );
    const tb = h("tbody");
    for (const row of SUPPORTED) {
      for (const t of row.t) {
        const use = h("button", { type: "button", class: "kx-use" }, "Use");
        use.addEventListener("click", () => {
          variantSel.value = row.variant;
          kIn.value = String(row.k);
          tIn.value = String(t);
          sIn.value = row.s === null ? "1" : ratText(Rat.fromString(row.s));
          refreshAvailability();
        });
        use.setAttribute("aria-label", `Use ${row.variant}, k=${row.k}, t=${t}${row.s === null ? "" : `, s=${row.s}`}`);
        tb.append(
          h(
            "tr",
            {},
            h("td", {}, row.variant),
            h("td", {}, String(row.k)),
            h("td", {}, row.s === null ? "1" : ratText(Rat.fromString(row.s))),
            h("td", {}, String(t)),
            h("td", {}, use),
          ),
        );
      }
    }
    tbl.append(tb);
    tableBox.append(
      h("div", { class: "kx-scroll" }, tbl),
      h(
        "p",
        { class: "kx-hint" },
        "Everything else is shown as an estimate only and is never executed. Over-budget parameters are refused before execution.",
      ),
    );
  }

  // ---- running -------------------------------------------------------------
  function startRun(): void {
    const r = readParams();
    if (!r.ok || running) {
      return;
    }
    const a = availability(r.params);
    if (a.kind !== "runnable") {
      return;
    }
    stopPlaying();
    running = true;
    runBtn.disabled = true;
    stopBtn.disabled = false;
    runStatus.textContent = "Running… the page stays responsive; Stop cancels the run.";
    const done = (res: ExplorerRun): void => {
      if (destroyed) {
        return;
      }
      running = false;
      stopBtn.disabled = true;
      handle = null;
      sub = "explore";
      setRun(res, 0);
      refreshAvailability();
    };
    const fail = (msg: string): void => {
      if (destroyed) {
        return;
      }
      if (msg === "the worker failed to start") {
        handle = runExplorerAsync(r.params, done, fail, null);
        return;
      }
      running = false;
      stopBtn.disabled = true;
      handle = null;
      runStatus.textContent = `The run could not be executed: ${msg}`;
      refreshAvailability();
    };
    handle = runExplorerAsync(r.params, done, fail, makeWorker, (v) => decodeWire(v) as ExplorerRun);
  }

  function stopRun(): void {
    handle?.cancel();
    handle = null;
    running = false;
    stopBtn.disabled = true;
    runStatus.textContent = "Run stopped: nothing was claimed.";
    refreshAvailability();
  }

  function setRun(res: ExplorerRun, at: number | "last"): void {
    run = res;
    steps = buildSteps(res);
    stepIdx = at === "last" ? (steps.length > 1 ? steps.length - 1 : 0) : at;
    selStrip = -1;
    selUnit = -1;
    renderAll();
  }

  // ---- stepping ------------------------------------------------------------
  function stopPlaying(): void {
    playing = false;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    playBtn.textContent = "▶ Play";
    playBtn.setAttribute("aria-pressed", "false");
  }
  function tick(): void {
    if (!playing) {
      return;
    }
    if (stepIdx >= steps.length - 1) {
      stopPlaying();
      return;
    }
    go(stepIdx + 1);
    timer = setTimeout(tick, Number(speedSel.value));
  }
  function startPlaying(): void {
    if (steps.length === 0) {
      return;
    }
    if (stepIdx >= steps.length - 1) {
      stepIdx = 0;
    }
    playing = true;
    playBtn.textContent = "⏸ Pause";
    playBtn.setAttribute("aria-pressed", "true");
    renderAll();
    timer = setTimeout(tick, Number(speedSel.value));
  }
  function go(i: number): void {
    if (steps.length === 0) {
      return;
    }
    const clamped = i < 0 ? 0 : i > steps.length - 1 ? steps.length - 1 : i;
    if (clamped !== stepIdx) {
      selStrip = selStrip >= 0 && current()?.start === steps[clamped]?.start ? selStrip : -1;
    }
    stepIdx = clamped;
    renderAll();
  }

  // ---- rendering -----------------------------------------------------------
  function visibleLog(): readonly MoveLogEntry[] {
    const s = current();
    return run === null || s === null ? [] : run.log.slice(0, s.logLength);
  }

  function snapshotOf(s: Step | null): {
    dir: Dir;
    regions: LedgerEvent["regions"];
    ledger: LedgerEvent["ledger"] | null;
  } | null {
    if (s === null) {
      return null;
    }
    if (s.kind === "end" && s.end !== null) {
      return { dir: s.end.dir, regions: s.end.regions, ledger: s.end.ledger };
    }
    const l = ledgerFor(steps, s.index);
    if (l !== null) {
      return { dir: l.dir, regions: l.regions, ledger: l.ledger };
    }
    return null;
  }

  function renderAll(): void {
    if (destroyed) {
      return;
    }
    renderRunSummary();
    renderStepper();
    renderLedger();
    renderInspectControls();
    renderReason();
    renderRecursion();
    renderBreak();
    drawBoard();
  }

  function renderRunSummary(): void {
    if (run === null) {
      runStatus.textContent = running ? runStatus.textContent : "No run yet. Choose a verified configuration and press Run.";
      runFacts.textContent = "";
      exportBtn.disabled = true;
      checksBox.replaceChildren();
      return;
    }
    runStatus.textContent = RESULT_TEXT[run.status] ?? run.status;
    const claimed = run.claims.length;
    runFacts.textContent =
      `${run.status === "awaiting-breaker-move" ? "so far: " : ""}` +
      `${run.points.length} points · ${run.rounds} rounds · ${claimed} strip(s) claimed (goal ${String(run.goal)}) · ` +
      `${run.levels.length} level report(s) · exact checks ${run.checks.filter((c) => c.ok).length}/${run.checks.length} passed · ` +
      `run time ${run.ms.toFixed(0)} ms · work ${String(run.work)}`;
    exportBtn.disabled = false;
    checksBox.replaceChildren(h("summary", {}, `Exact checks of this run (${run.checks.length})`));
    const ul = h("ul");
    const names = new Map<string, number>();
    for (const c of run.checks) {
      const key = `${c.ok ? "pass" : "FAIL"}: ${c.name.replace(/\d+/g, "#")}`;
      names.set(key, (names.get(key) ?? 0) + 1);
    }
    for (const [k, n] of names) {
      ul.append(h("li", {}, `${k} ×${n}`));
    }
    checksBox.append(ul);
  }

  function renderStepper(): void {
    const has = steps.length > 0;
    for (const b of [firstBtn, prevBtn, playBtn, nextBtn]) {
      b.disabled = !has;
    }
    slider.disabled = !has;
    slider.max = String(has ? steps.length - 1 : 0);
    slider.value = String(stepIdx);
    slider.setAttribute("aria-valuetext", has ? `step ${stepIdx + 1} of ${steps.length}` : "no steps");
    prevBtn.disabled = !has || stepIdx === 0;
    nextBtn.disabled = !has || stepIdx >= steps.length - 1;
    chipsBox.replaceChildren();
    for (const c of phaseChips(steps)) {
      const b = h("button", { type: "button", class: "kx-chip" }, c.label);
      const active = current() !== null && (current() as Step).start === steps[c.index]?.start;
      b.setAttribute("aria-pressed", String(active));
      b.addEventListener("click", () => {
        stopPlaying();
        go(c.index);
      });
      chipsBox.append(b);
    }
    explainBox.replaceChildren();
    const s = current();
    if (s === null) {
      caption.textContent = "";
      return;
    }
    caption.textContent = `Step ${s.index + 1} of ${steps.length}: ${s.title}`;
    const entry = s.moveIdx === null || run === null ? null : (run.log[s.moveIdx] ?? null);
    const ex = explainStep(s.phase, s.kind, entry === null ? null : entry.kind);
    if (ex === null) {
      if (s.kind === "result" && run !== null) {
        explainBox.append(h("dt", {}, "Result"), h("dd", {}, RESULT_TEXT[run.status] ?? run.status));
      }
      return;
    }
    const rows: [string, string][] = [
      ["Object", ex.object],
      ["Why it matters", ex.why],
      ["What Maker is attempting", ex.maker],
      ["What Breaker can do", ex.breaker],
      ["Invariant", ex.invariant],
      ["Next", ex.next],
    ];
    for (const [k, v] of rows) {
      explainBox.append(h("dt", {}, k), h("dd", {}, v));
    }
  }

  function renderLedger(): void {
    ledgerBox.replaceChildren();
    const s = current();
    const snap = snapshotOf(s);
    if (run === null || s === null) {
      ledgerBox.append(h("p", {}, "Run the construction to see the counting ledger."));
      return;
    }
    if (snap === null || snap.ledger === null) {
      ledgerBox.append(
        h(
          "p",
          {},
          s.kind === "result"
            ? "Final numbers are in the level reports below."
            : "This step has no counting structure: base points are only collected. The ledger starts with the first pairing or grouping phase.",
        ),
      );
      renderLevelReports();
      return;
    }
    const L = snap.ledger;
    const dl = h("dl", { class: "kx-est" });
    const row = (k: string, v: string): void => {
      dl.append(h("dt", {}, k), h("dd", {}, v));
    };
    const units = L.units.length;
    row("Units U (pairs or groups)", String(units));
    row("Strips required (t)", String(L.required));
    row("Breaker budget of the phase B", `${L.breakerUsed} used of ${L.budgetTotal}, ${L.budgetRemaining} left`);
    row("Units dead now", String(L.deadUnits));
    row("Units alive now", String(L.survivorsNow));
    row("Kills still affordable with the points left", String(L.maxFurtherKills));
    row("Survivor lower bound", `${units} − ${L.deadUnits} − ${L.maxFurtherKills} = ${L.guaranteedSurvivors}`);
    row(
      "Against the requirement",
      L.guaranteedSurvivors >= L.required
        ? `${L.guaranteedSurvivors} >= ${L.required}: met whatever Breaker does with the remaining points`
        : `${L.guaranteedSurvivors} < ${L.required}: not yet met by the bound alone`,
    );
    ledgerBox.append(dl);
    const p1 = L.proposition1;
    ledgerBox.append(
      h(
        "p",
        { class: "kx-prop1" },
        `Proposition 1 as worded in the paper: with B = ${L.budgetTotal} Breaker points, at most ⌊B/2⌋ = ⌊${L.budgetTotal}/2⌋ = ${p1.boundOnSuchUnits} ` +
          `units can hold two or more Breaker points inside R_(2j−1) ∪ R_(2j). Observed: ${p1.unitsWithTwoOrMoreInteriorBreakers} ` +
          `(${p1.holds ? "within the bound" : "violated"}). The survivor bound above is the stronger count the executor uses: a unit dies only if every one of its regions is blocked.`,
      ),
    );
    if (L.adoptions.length > 0) {
      const box = h("div", { class: "kx-adopt", role: "status" });
      box.append(h("h4", {}, "Boundary adoption"));
      for (const a of L.adoptions) {
        box.append(
          h(
            "p",
            {},
            `Unit ${a.unit}, ${a.kind} vertex ${fmtPt(a.from)} is replaced by the Breaker point ${fmtPt(a.to)}; ${a.absorbed.length} point(s) on that boundary halfline are absorbed. The region only shrinks.`,
          ),
        );
      }
      ledgerBox.append(box);
    }
    if (run.params.variant === "bichromatic") {
      const vis = visibleLog();
      const mk = vis.filter((e) => e.player === "maker").length;
      ledgerBox.append(
        h(
          "p",
          { class: "kx-own" },
          `Ownership (bichromatic): ${mk} Maker point(s) and ${vis.length - mk} Breaker point(s) on the board. Breaker points are blockers only; they are never adopted and never vertices of a claimed strip.`,
        ),
      );
    }
    // per-unit table
    const tbl = h("table", { class: "kx-table" });
    tbl.append(
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          ...["Unit", "Live regions", "Blockers (interior)", "Boundary", "Absorbed", "Need to kill"].map((c) =>
            h("th", { scope: "col" }, c),
          ),
        ),
      ),
    );
    const tb = h("tbody");
    for (const u of L.units) {
      const regs = snap.regions.filter((r) => r.unit === u.unit);
      const blockers = regs.map((r) => `${r.id}: ${r.interiorBreakers}${r.interiorMakers > 0 ? `+${r.interiorMakers}M` : ""}`).join(" · ");
      const boundary = regs.reduce((a, r) => a + r.boundary, 0);
      tb.append(
        h(
          "tr",
          { class: u.dead ? "kx-dead" : "" },
          h("td", {}, String(u.unit)),
          h("td", {}, `${u.liveRegions}${u.dead ? " (dead)" : ""}`),
          h("td", {}, blockers),
          h("td", {}, String(boundary)),
          h("td", {}, String(u.absorbed)),
          h("td", {}, u.dead ? "—" : String(u.need)),
        ),
      );
    }
    tbl.append(tb);
    ledgerBox.append(h("div", { class: "kx-scroll kx-scroll-tall" }, tbl));
    if (s.kind === "end") {
      renderLevelReports();
    }
  }

  function renderLevelReports(): void {
    if (run === null || run.levels.length === 0) {
      return;
    }
    const ul = h("ul", { class: "kx-levels" });
    for (const l of run.levels) {
      ul.append(
        h(
          "li",
          {},
          `Level ${l.level} (${l.phase}): ${l.survivors} strip(s) harvested of ${l.required} required from ${l.units} unit(s); ` +
            `${l.breakerMoves} Breaker point(s): ${l.interiorBreakerPoints} interior, ${l.absorbedBreakerPoints} absorbed, ${l.wastedBreakerPoints} useless; ` +
            `survivor lower bound at the end ${l.guaranteedAtEnd}${l.tilt === null ? "" : `; tilt ${l.tilt}`}.`,
        ),
      );
    }
    ledgerBox.append(h("h4", {}, "Level reports"), ul);
  }

  function stripsHere(): readonly (readonly Pt[])[] {
    const s = current();
    return s?.start?.inputs ?? [];
  }
  function unitsHere(): readonly number[] {
    const s = current();
    return s?.start?.plans.map((p) => p.unit) ?? [];
  }

  function renderInspectControls(): void {
    const strips = stripsHere();
    const units = unitsHere();
    stripSel.replaceChildren(h("option", { value: "-1" }, strips.length === 0 ? "no strips in this step" : "none selected"));
    strips.forEach((st, i) => {
      stripSel.append(h("option", { value: String(i) }, `S${i + 1}: ${st.length} point(s), x from ${shortRat(ratText((st[0] as Pt).x), 10)}`));
    });
    if (selStrip >= strips.length) {
      selStrip = -1;
    }
    stripSel.value = String(selStrip);
    stripSel.disabled = strips.length === 0;
    unitSel.replaceChildren(h("option", { value: "-1" }, units.length === 0 ? "no pairs in this step" : "none selected"));
    for (const u of units) {
      unitSel.append(h("option", { value: String(u) }, `Unit ${u}`));
    }
    if (selUnit >= 0 && !units.includes(selUnit)) {
      selUnit = -1;
    }
    unitSel.value = String(selUnit);
    unitSel.disabled = units.length === 0;
    minusCk.checked = showMinus;
    plusCk.checked = showPlus;
    inspectInfo.replaceChildren();
    const s = current();
    if (s === null || run === null) {
      return;
    }
    if (selStrip >= 0) {
      const st = strips[selStrip];
      if (st !== undefined) {
        inspectInfo.append(
          h("p", {}, `Strip S${selStrip + 1}: vertices ${st.map(fmtPt).join(", ")}. Its region is the convex hull of the vertices plus everything below it.`),
        );
        for (const side of ["minus", "plus"] as const) {
          if ((side === "minus" && !showMinus) || (side === "plus" && !showPlus)) {
            continue;
          }
          const res = extensionCone(st, visibleLog().map((e) => e.pt), s.start?.dir ?? DOWN_DIR, side);
          if (!res.ok) {
            inspectInfo.append(h("p", {}, `Cone C${side === "minus" ? "−" : "+"}: not defined here (${res.reason.code}).`));
          } else {
            const c = res.cone;
            inspectInfo.append(
              h(
                "p",
                {},
                `Cone C${side === "minus" ? "−" : "+"} at ${fmtPt(c.apex)}: stopped by ${
                  c.stop.kind === "edge-line"
                    ? "the line of the end edge"
                    : c.stop.kind === "blocked"
                      ? `the point ${fmtPt(c.stop.blocker)}`
                      : "the horizontal convention (k = 1)"
                }.`,
              ),
            );
          }
        }
      }
    }
    if (selUnit >= 0) {
      const plan = s.start?.plans.find((p) => p.unit === selUnit);
      const snap = snapshotOf(s);
      const regs = snap?.regions.filter((r) => r.unit === selUnit) ?? [];
      if (plan !== undefined) {
        inspectInfo.append(
          h("p", {}, `Unit ${selUnit} plan: ${plan.strips.length} input strips; the halfline l_j ∩ cones starts at ${fmtPt(plan.lineTop)} and runs downward.`),
        );
      }
      if (regs.length === 2) {
        const dir = snap?.dir ?? DOWN_DIR;
        const a = StripRegion.make((regs[0] as (typeof regs)[number]).chain, dir);
        const b = StripRegion.make((regs[1] as (typeof regs)[number]).chain, dir);
        let shared: Pt | null = null;
        if (a.ok && b.ok) {
          shared = sharedHalfline(a.region, b.region);
        }
        inspectInfo.append(
          h(
            "p",
            {},
            `${(regs[0] as (typeof regs)[number]).id} (${(regs[0] as (typeof regs)[number]).live ? "live" : "blocked"}) and ${(regs[1] as (typeof regs)[number]).id} (${(regs[1] as (typeof regs)[number]).live ? "live" : "blocked"}) ` +
              (shared === null
                ? "do not share a halfline in this step (the extension point is not placed yet)."
                : `meet exactly in the halfline below ${fmtPt(shared)}.`),
          ),
        );
      } else if (regs.length > 0) {
        inspectInfo.append(h("p", {}, `${regs.length} group region(s) for this unit.`));
      }
    }
  }

  function renderReason(): void {
    reasonBox.replaceChildren();
    const s = current();
    if (s === null || run === null) {
      reasonBox.append(h("p", {}, "Step to a Breaker move to read why the policy played it."));
      return;
    }
    const entry = s.moveIdx === null ? null : (run.log[s.moveIdx] ?? null);
    if (entry === null || entry.player !== "breaker") {
      reasonBox.append(h("p", {}, "The current step is not a Breaker move."));
      return;
    }
    reasonBox.append(
      h("p", {}, h("strong", {}, entry.reason?.policy ?? "policy"), `: ${reasonText(entry.reason)}`),
      h("p", { class: "kx-hint" }, `Point ${fmtPt(entry.pt)} · phase ${entry.phase}, level ${entry.level}, round ${entry.round}. Reason code: ${entry.reason?.code ?? "none"}.`),
    );
    const snap = snapshotOf(s);
    if (snap?.ledger !== null && snap?.ledger !== undefined) {
      const idx = run.log
        .slice(0, s.moveIdx === null ? 0 : s.moveIdx + 1)
        .filter((e) => e.player === "breaker" && e.level === entry.level && e.phase === entry.phase).length;
      const pl = snap.ledger.placements[idx - 1];
      if (pl !== undefined) {
        reasonBox.append(h("p", {}, `Ledger classification of this point: ${placementText(pl.category, pl.unit, pl.region)}.`));
      }
    }
  }

  function renderRecursion(): void {
    recBox.replaceChildren();
    const r = readParams();
    const p = run?.params ?? (r.ok ? r.params : null);
    if (p === null) {
      return;
    }
    const tbl = recursionTable(p);
    if (tbl.rows.length === 0) {
      recBox.append(h("p", {}, tbl.note));
      return;
    }
    const t = h("table", { class: "kx-table" });
    t.append(
      h(
        "thead",
        {},
        h("tr", {}, ...["Level ℓ", "Strips needed t_ℓ", "Recurrence", "r(ℓ, t_ℓ) exact", "Closed form"].map((c) => h("th", { scope: "col" }, c))),
      ),
    );
    const tb = h("tbody");
    const lvl = current()?.level ?? null;
    const addRow = (row: (typeof tbl.rows)[number], cls: string): void => {
      tb.append(
        h(
          "tr",
          { class: cls },
          h("td", {}, String(row.level)),
          h("td", {}, shortRat(row.strips, 16)),
          h("td", {}, row.recurrence),
          h("td", {}, row.value),
          h("td", {}, row.closed ?? "—"),
        ),
      );
    };
    for (const row of tbl.rows) {
      addRow(row, lvl === row.level ? "kx-current" : "");
    }
    if (tbl.next !== null) {
      addRow(tbl.next, "kx-next");
    }
    t.append(tb);
    recBox.append(
      h("div", { class: "kx-scroll" }, t),
      h("p", { class: "kx-hint" }, "The last row is the next recursive level (k + 1), shown for the growth only; it is not executed."),
      h("p", {}, tbl.note),
    );
  }

  // ---- break the proof -------------------------------------------------------
  const bxIn = h("input", { type: "text", inputmode: "decimal", autocomplete: "off", placeholder: "x, e.g. 7/2" });
  const byIn = h("input", { type: "text", inputmode: "decimal", autocomplete: "off", placeholder: "y, e.g. -12" });
  const bPreview = h("p", { id: "kx-break-preview", role: "status" });
  const bPlace = h("button", { id: "kx-break-place", type: "button" }, "Place Breaker point");
  const bUndo = h("button", { id: "kx-break-undo", type: "button" }, "Undo last");
  const bRestart = h("button", { id: "kx-break-restart", type: "button" }, "Restart");
  const bStart = h("button", { id: "kx-break-start", type: "button" }, "Start Break the Proof");
  const bInfo = h("div", { id: "kx-break-info" });
  const bList = h("ol", { id: "kx-break-list" });

  function parseCandidate(): Pt | null {
    try {
      const x = Rat.fromString(bxIn.value.trim());
      const y = Rat.fromString(byIn.value.trim());
      const LIM = 10n ** 100n;
      for (const v of [x, y]) {
        if (v.n > LIM || v.n < -LIM || v.d > LIM) {
          return null;
        }
      }
      return pt(x, y);
    } catch {
      return null;
    }
  }

  function updatePreview(): void {
    if (pending === null) {
      bPreview.textContent = "";
      bPlace.disabled = true;
      return;
    }
    const p = parseCandidate();
    if (p === null) {
      bPreview.textContent = "Enter exact coordinates (integers or n/d), or click the board.";
      bPlace.disabled = true;
      candidate = null;
      drawBoard();
      return;
    }
    candidate = p;
    const c = pending.classify(p);
    bPreview.textContent = describePreview(c);
    bPlace.disabled = c.kind === "illegal";
    drawBoard();
  }

  function renderBreak(): void {
    bStart.disabled = false;
    breakBody.replaceChildren();
    breakBody.append(h("p", { class: "kx-lead" }, BREAK_INTRO));
    const r = readParams();
    const target = r.ok ? r.params : (run?.params ?? null);
    const can = target === null ? { ok: false, reason: "Fix the configuration first." } : breakable(target);
    breakBody.append(h("div", { class: "kx-row" }, bStart));
    if (!can.ok && breakParams === null) {
      bStart.disabled = true;
      bStart.setAttribute("aria-describedby", "kx-break-why");
      breakBody.append(h("p", { id: "kx-break-why", class: "kx-avail kx-avail-refused" }, `Not available: ${can.reason}`));
    }
    if (sub !== "break" || breakParams === null) {
      return;
    }
    const lv = breakTargetLevel(breakParams.k, breakParams.variant);
    breakBody.append(
      bInfo,
      h(
        "div",
        { class: "kx-row" },
        h("div", { class: "fld" }, h("label", { for: "kx-break-x" }, "x"), bxIn),
        h("div", { class: "fld" }, h("label", { for: "kx-break-y" }, "y"), byIn),
      ),
      bPreview,
      h("div", { class: "kx-row" }, bPlace, bUndo, bRestart),
      h("h4", {}, "Your points"),
      bList,
    );
    bxIn.id = "kx-break-x";
    byIn.id = "kx-break-y";
    bInfo.replaceChildren();
    if (pending !== null) {
      bInfo.append(
        h(
          "p",
          { role: "status" },
          `Level ${lv} ${pending.phase}, Maker round ${pending.levelRound}: ${pending.breakerMovesLeftInPhase} of the phase's Breaker points remain to be placed (this phase gives you ${pending.breakerMovesTotalInPhase} in total).`,
        ),
      );
    } else if (run !== null) {
      bInfo.append(h("p", { role: "status" }, BREAK_DONE_NOTE), h("p", {}, RESULT_TEXT[run.status] ?? run.status));
    }
    bList.replaceChildren();
    const ledgerFinal = lastPhaseLedger(lv);
    breakPts.forEach((p, i) => {
      const pl = ledgerFinal?.placements[i];
      bList.append(
        h(
          "li",
          {},
          `${fmtPt(p)} — ${pl === undefined ? "pending" : placementText(pl.category, pl.unit, pl.region)}`,
        ),
      );
    });
    if (ledgerFinal !== null) {
      bInfo.append(
        h(
          "p",
          {},
          `Ledger after your points: ${ledgerFinal.units.length - ledgerFinal.deadUnits} of ${ledgerFinal.units.length} units alive, survivor lower bound ${ledgerFinal.guaranteedSurvivors} against ${ledgerFinal.required} required.`,
        ),
      );
    }
    bUndo.disabled = breakPts.length === 0;
    updatePreviewQuiet();
  }

  function updatePreviewQuiet(): void {
    bPlace.disabled = pending === null || candidate === null || pending.classify(candidate).kind === "illegal";
  }

  function lastPhaseLedger(level: number): LedgerEvent["ledger"] | null {
    if (run === null) {
      return null;
    }
    for (let i = run.trace.length - 1; i >= 0; i -= 1) {
      const e = run.trace[i] as TraceEvent;
      if (e.kind === "ledger" && e.level === level) {
        return e.ledger;
      }
      if (e.kind === "phase-end" && e.level === level && e.ledger !== null) {
        return e.ledger;
      }
    }
    return null;
  }

  function runBreakNow(): void {
    if (breakParams === null) {
      return;
    }
    const lv = breakTargetLevel(breakParams.k, breakParams.variant);
    const out = runBreak(breakParams, { level: lv, points: breakPts });
    pending = out.pending;
    candidate = null;
    bxIn.value = "";
    byIn.value = "";
    stopPlaying();
    setRun(out.run, "last");
    // Show the board at the last move, not the result sentinel.
    const lastMove = steps.length - 2;
    if (lastMove >= 0) {
      stepIdx = lastMove;
      renderAll();
    }
  }

  bStart.addEventListener("click", () => {
    const r = readParams();
    if (!r.ok) {
      toast(r.message);
      return;
    }
    const can = breakable(r.params);
    if (!can.ok) {
      toast(can.reason);
      return;
    }
    breakParams = r.params;
    breakPts = [];
    sub = "break";
    runBreakNow();
  });
  bPlace.addEventListener("click", () => {
    const p = parseCandidate();
    if (p === null || pending === null) {
      return;
    }
    const c = pending.classify(p);
    if (c.kind === "illegal") {
      toast(describePreview(c));
      return;
    }
    breakPts = [...breakPts, p];
    runBreakNow();
    toast(`Point ${breakPts.length} placed.`);
  });
  bUndo.addEventListener("click", () => {
    breakPts = breakPts.slice(0, -1);
    runBreakNow();
  });
  bRestart.addEventListener("click", () => {
    breakPts = [];
    runBreakNow();
  });
  bxIn.addEventListener("input", updatePreview);
  byIn.addEventListener("input", updatePreview);

  // ---- board -------------------------------------------------------------
  function boxSize(): { w: number; h: number } {
    return { w: svg.clientWidth > 0 ? svg.clientWidth : 800, h: svg.clientHeight > 0 ? svg.clientHeight : 600 };
  }

  function drawBoard(): void {
    svg.replaceChildren();
    const box = boxSize();
    const s = current();
    if (run === null || s === null) {
      view = null;
      const t = svgEl("text", { x: 24, y: 40, class: "viz-label" }, "No run yet — choose a verified configuration and press Run.");
      svg.append(t);
      return;
    }
    const log = visibleLog();
    const snap = snapshotOf(s);
    const dir = snap?.dir ?? s.start?.dir ?? DOWN_DIR;
    // what to fit
    const fit: Pt[] = log.map((e) => e.pt);
    const strips = stripsHere();
    const regions = snap?.regions ?? [];
    const focusPts: Pt[] = [];
    if (selStrip >= 0 && strips[selStrip] !== undefined) {
      focusPts.push(...(strips[selStrip] as readonly Pt[]));
    }
    if (selUnit >= 0) {
      for (const r of regions) {
        if (r.unit === selUnit) {
          focusPts.push(...r.chain);
        }
      }
    }
    if (focusPts.length > 0) {
      fit.push(...focusPts);
    } else {
      for (const st of strips) {
        fit.push(...st);
      }
      for (const r of regions) {
        fit.push(...r.chain);
      }
    }
    if (candidate !== null) {
      fit.push(candidate);
    }
    const bounds = focusPts.length > 0 ? [...focusPts, ...log.slice(-3).map((e) => e.pt)] : fit;
    view = fitAniso(bounds.length > 0 ? bounds : fit, box.w, box.h);
    const v = view;
    const dscr = dirToScreen(dir, v);
    const toS = (p: Pt): { x: number; y: number } => toScreenAniso(p, v);
    const g = svgEl("g", { class: "kx-layer" });
    svg.append(g);
    const poly = (chain: readonly Pt[], cls: string, title?: string): void => {
      const el = svgEl("polygon", {
        points: pointsAttr(regionPolygon(chain.map(toS), dscr, box)),
        class: `viz-ov ${cls}`,
      });
      if (title !== undefined) {
        el.append(svgEl("title", {}, title));
      }
      g.append(el);
    };
    // input strips (phase start / pairing moves): structure
    if (s.kind === "start" || (s.kind === "move" && snap === null)) {
      strips.forEach((st, i) => {
        poly(st, i === selStrip ? "viz-ov-forced kx-sel" : "viz-ov-structure", `S${i + 1}`);
      });
    }
    // candidate / group regions from the ledger snapshot
    for (const r of regions) {
      const isSel = r.unit === selUnit;
      poly(
        r.chain,
        r.live ? (s.kind === "end" ? "viz-ov-verify" : "viz-ov-candidate") : "viz-ov-neutral kx-dead-region",
        `${r.id}${r.live ? "" : " (blocked)"}`,
      );
      if (isSel) {
        poly(r.chain, "viz-ov-forced kx-sel");
        const first = r.chain[0];
        if (first !== undefined) {
          const sp = toS(first);
          g.append(svgEl("text", { x: sp.x + 4, y: sp.y - 6, class: "viz-label" }, r.id));
        }
      }
    }
    if (s.kind === "end" && s.end !== null && regions.length === 0) {
      for (const st of s.end.chosen) {
        poly(st, "viz-ov-verify", "harvested strip");
      }
    }
    // selected strip + cones
    if (selStrip >= 0 && strips[selStrip] !== undefined) {
      const st = strips[selStrip] as readonly Pt[];
      poly(st, "viz-ov-forced kx-sel", `S${selStrip + 1}`);
      const S = log.map((e) => e.pt);
      for (const side of ["minus", "plus"] as const) {
        if ((side === "minus" && !showMinus) || (side === "plus" && !showPlus)) {
          continue;
        }
        const res = extensionCone(st, S, s.start?.dir ?? DOWN_DIR, side);
        if (!res.ok) {
          continue;
        }
        const c = res.cone;
        const rayBase = fromFrame(c.frame, pt(c.apexF.x.add(c.rayF.x), c.apexF.y.add(c.rayF.y)));
        g.append(
          svgEl("polygon", {
            points: pointsAttr(conePolygon(toS(c.apex), toS(rayBase), dscr, box)),
            class: "viz-ov viz-ov-protected kx-cone",
          }),
        );
      }
    }
    // planned halfline of the selected unit
    if (selUnit >= 0) {
      const plan = s.start?.plans.find((p) => p.unit === selUnit);
      if (plan !== undefined) {
        const a = toS(plan.lineTop);
        const b = halflineEnd(a, dscr, box);
        g.append(svgEl("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "kx-halfline" }));
      }
    }
    // points
    log.forEach((e, i) => {
      const sp = toS(e.pt);
      const last = s.moveIdx !== null && i === s.moveIdx;
      const label = `${e.player} point ${e.n}: (${e.pt.x.toString()}, ${e.pt.y.toString()})`;
      if (e.player === "maker") {
        const c = svgEl("circle", { cx: sp.x, cy: sp.y, r: 3.6, class: "pt pt-maker kx-pt" });
        c.append(svgEl("title", {}, label));
        g.append(c);
      } else {
        const r = 4.8;
        const d = svgEl("polygon", {
          points: `${sp.x},${sp.y - r} ${sp.x + r},${sp.y} ${sp.x},${sp.y + r} ${sp.x - r},${sp.y}`,
          class: "pt pt-breaker kx-pt",
        });
        d.append(svgEl("title", {}, label));
        g.append(d);
      }
      if (last) {
        g.append(svgEl("circle", { cx: sp.x, cy: sp.y, r: 9, class: "kx-ring" }));
      }
    });
    if (candidate !== null) {
      const cp = toS(candidate);
      g.append(svgEl("circle", { cx: cp.x, cy: cp.y, r: 6, class: "kx-candidate" }));
    }
    // legend / clip note
    svg.append(svgEl("text", { x: 14, y: 22, class: "viz-label kx-note" }, "Clipped for display (illustrative); the exact region is unbounded."));
  }

  const onBoardClick = (e: MouseEvent): void => {
    if (sub !== "break" || pending === null || view === null) {
      return;
    }
    const rect = svg.getBoundingClientRect();
    const p = fromScreenAniso(e.clientX - rect.left, e.clientY - rect.top, view, 4n);
    bxIn.value = ratText(p.x);
    byIn.value = ratText(p.y);
    updatePreview();
  };
  svg.addEventListener("click", onBoardClick);

  // ---- events ----------------------------------------------------------------
  for (const el of [variantSel, kIn, tIn, sIn, policySel, seedIn]) {
    const onForm = (): void => {
      refreshAvailability();
      renderRecursion();
      if (sub !== "break") {
        renderBreak();
      }
    };
    el.addEventListener("input", onForm);
    el.addEventListener("change", onForm);
  }
  runBtn.addEventListener("click", startRun);
  stopBtn.addEventListener("click", stopRun);
  menuBtn.addEventListener("click", () => shell.toEntry());
  firstBtn.addEventListener("click", () => {
    stopPlaying();
    go(0);
  });
  prevBtn.addEventListener("click", () => {
    stopPlaying();
    go(stepIdx - 1);
  });
  nextBtn.addEventListener("click", () => {
    stopPlaying();
    go(stepIdx + 1);
  });
  playBtn.addEventListener("click", () => {
    if (playing) {
      stopPlaying();
    } else {
      startPlaying();
    }
  });
  slider.addEventListener("input", () => {
    stopPlaying();
    go(Number(slider.value));
  });
  stripSel.addEventListener("change", () => {
    selStrip = Number(stripSel.value);
    renderAll();
  });
  unitSel.addEventListener("change", () => {
    selUnit = Number(unitSel.value);
    renderAll();
  });
  minusCk.addEventListener("change", () => {
    showMinus = minusCk.checked;
    renderAll();
  });
  plusCk.addEventListener("change", () => {
    showPlus = plusCk.checked;
    renderAll();
  });
  exportBtn.addEventListener("click", () => {
    if (run === null) {
      return;
    }
    const script: BreakScript | null =
      sub === "break" && breakParams !== null
        ? { level: breakTargetLevel(breakParams.k, breakParams.variant), points: breakPts }
        : null;
    const file = kstripExperimentOf(run, script, `k-strip ${run.params.variant} k=${run.params.k} t=${run.params.t}`);
    downloadReplay(experimentFilename(file), experimentText(file));
    toast("Experiment exported: parameters, seed and log.");
  });
  importBtn.addEventListener("click", () => {
    pickReplayFile(toast).then(
      (text) => {
        if (text !== null) {
          loadExperiment(text);
        }
      },
      () => toast("Experiment unreadable."),
    );
  });

  function loadExperiment(text: string): boolean {
    if (!looksLikeExperiment(text)) {
      toast("Not an experiment file.");
      return false;
    }
    const parsed = parseExperiment(text);
    if (!parsed.ok) {
      toast(`Experiment rejected: ${parsed.issues.slice(0, 3).map((i) => `${i.code} at ${i.path || "file"}`).join("; ")}`);
      return false;
    }
    return applyExperiment(parsed.file);
  }

  function applyExperiment(file: ExperimentFile): boolean {
    if (file.kind !== "kstrip") {
      toast("This is a Parameter Lab experiment; open it from the Lab.");
      return false;
    }
    const rep = replayKStripExperiment(file.kstrip);
    if (!rep.ok) {
      toast(`Experiment rejected: ${rep.issues.slice(0, 2).join("; ")}`);
      return false;
    }
    const p = rep.run.params;
    variantSel.value = p.variant;
    kIn.value = String(p.k);
    tIn.value = String(p.t);
    sIn.value = p.s === null ? "1" : ratText(Rat.fromString(p.s));
    policySel.value = p.policy;
    seedIn.value = String(p.seed);
    if (rep.script !== null) {
      breakParams = p;
      breakPts = [...rep.script.points];
      sub = "break";
      const out = runBreak(p, rep.script);
      pending = out.pending;
      setRun(out.run, "last");
    } else {
      sub = "explore";
      setRun(rep.run, 0);
    }
    refreshAvailability();
    toast(`Replay verified: ${rep.verifiedMoves} moves identical to the re-executed run.`);
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
    } else if (e.key === "ArrowRight") {
      stopPlaying();
      go(stepIdx + 1);
    } else if (e.key === "ArrowLeft") {
      stopPlaying();
      go(stepIdx - 1);
    } else if (e.key === "r" || e.key === "R") {
      stopPlaying();
      go(0);
    } else if (e.key === " " && !(t instanceof HTMLButtonElement)) {
      e.preventDefault();
      if (playing) {
        stopPlaying();
      } else {
        startPlaying();
      }
    }
  };
  document.addEventListener("keydown", onKey);

  paintTable();
  syncFormShape();
  refreshAvailability();
  renderAll();
  if (initial !== null) {
    applyExperiment(initial);
  }

  return {
    onResize(): void {
      drawBoard();
    },
    destroy(): void {
      destroyed = true;
      stopPlaying();
      handle?.cancel();
      svg.removeEventListener("click", onBoardClick);
      document.removeEventListener("keydown", onKey);
      for (const s of [
        configSection,
        runSection,
        stepperSection,
        ledgerSection,
        inspectSection,
        reasonSection,
        breakSection,
        recSection,
        claimsSection,
      ]) {
        s.remove();
      }
      svg.setAttribute("aria-label", "Point plane: the evolving Maker–Breaker configuration");
    },
  };
}

function fmtPt(p: Pt): string {
  return `(${shortRat(fmtRat(p.x), 14)}, ${shortRat(fmtRat(p.y), 14)})`;
}

// Re-exported for tests.
export { isSupported };
