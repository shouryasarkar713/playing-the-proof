// ui/modes/sandbox.ts — full sandbox (§14): either color, k-selector,
// seeded sets, typed placement, hole browsing, count-all-k, Overmars-29
// preset + 30th-point demo + chunked re-verification, passive strategy
// overlay, diagnostics with analysis-kind labels, undo/reset.
import { isKHole } from "../../geometry/holes.ts";
import type { HoleAnalysis } from "../../geometry/holes.ts";
import { analyzeWinHoles, gameModeOf } from "../../game/gamemode.ts";
import { gameModeLabel, ruleCaption } from "../../explain/gamemode.ts";
import { gp } from "../../geometry/predicates.ts";
import { hull } from "../../geometry/hull.ts";
import { Rat } from "../../geometry/rat.ts";
import { pt } from "../../geometry/pt.ts";
import type { Pt } from "../../geometry/pt.ts";
import type { GameState, Player } from "../../game/types.ts";
import { navigate } from "../../session/navigate.ts";
import { startSession } from "../../session/commit.ts";
import {
  clientToLocal,
  exceedsSeparation,
  screenToWorldQuantized,
  worldToScreen,
} from "../../viz/projection.ts";
import type { View } from "../../viz/projection.ts";
import { hoverToGhost } from "../../viz/interaction.ts";
import { node } from "../../viz/shapes.ts";
import { roundHalf } from "../../viz/projection.ts";
import type { SceneNode } from "../../viz/scene.ts";
import { dispatch, rejectionText } from "../dispatch.ts";
import { downloadReplay, exportSession } from "../replay-io.ts";
import {
  HONESTY_BUDGET_EXHAUSTED,
  HONESTY_WITNESS_ONLY,
} from "../../explain/templates.ts";
import { listStrategies, strategyOverlays } from "../../engine/describe.ts";
import overmarsJson from "../../../data/scenarios/overmars29.json";
import type { ModeHandle, Shell } from "../app.ts";

// Module-scoped pending preset (the Load button remounts at k=6; the fresh
// mount consumes the flag).
let pendingPreset = false;

interface OvermarsFile {
  points: [number, number][];
  checks: {
    V4_hull_layers: number[];
    V3_num_empty_convex_hexagons: number;
    V7_empty_convex_pentagons: number;
  };
}

const OVERMARS = overmarsJson as unknown as OvermarsFile;

// Deterministic 64-bit LCG (BigInt-exact — no Math.*, no floats).
function lcg64(seed: bigint): () => bigint {
  let a = BigInt.asUintN(64, seed);
  return () => {
    a = BigInt.asUintN(64, a * 6364136223846793005n + 1442695040888963407n);
    return a >> 33n;
  };
}

function overmarsPts(): Pt[] {
  return OVERMARS.points.map(([x, y]) =>
    pt(Rat.make(BigInt(x)), Rat.make(BigInt(y))),
  );
}

// The 29-point base, exhausted 6-hole analysis from fixture data (never a
// live 29-point sweep — that is minutes of BigInt work per render).
const OVERMARS_FACTS: HoleAnalysis = { kind: "exhaustive", k: 6, holes: [] };

// Exact preset match (ids, owners, coordinates in order).
function presetMatch(state: GameState): boolean {
  if (state.points.length !== OVERMARS.points.length || state.k !== 6) {
    return false;
  }
  const want = overmarsPts();
  for (let i = 0; i < want.length; i += 1) {
    const p = state.points[i];
    const w = want[i] as Pt;
    if (p === undefined || p.id !== `p${i + 1}`) {
      return false;
    }
    if (!p.pt.x.equals(w.x) || !p.pt.y.equals(w.y)) {
      return false;
    }
    if (p.owner !== (i % 2 === 0 ? "maker" : "breaker")) {
      return false;
    }
  }
  return true;
}

// The 30th-point demo state: the 29 base plus exactly one placed point.
function demoBase(state: GameState): boolean {
  if (state.points.length !== OVERMARS.points.length + 1 || state.k !== 6) {
    return false;
  }
  const want = overmarsPts();
  for (let i = 0; i < want.length; i += 1) {
    const p = state.points[i];
    const w = want[i] as Pt;
    if (p === undefined || !p.pt.x.equals(w.x) || !p.pt.y.equals(w.y)) {
      return false;
    }
  }
  return true;
}

// Convex-layer sizes by exact hull peeling (cheap at these sizes).
function hullLayers(pts: readonly Pt[]): number[] {
  let rest = [...pts];
  const out: number[] = [];
  for (;;) {
    if (rest.length === 0) {
      return out;
    }
    const h = hull(rest);
    if (h.length < 3) {
      out.push(rest.length);
      return out;
    }
    out.push(h.length);
    const inHull = new Set(h.map((q) => `${q.x.toString()},${q.y.toString()}`));
    rest = rest.filter(
      (p) => !inHull.has(`${p.x.toString()},${p.y.toString()}`),
    );
  }
}

// Integer floor of sqrt for non-negative finite numbers (binary search,
// no Math.*). Returns 0 for nonsense input.
function isqrtFloor(v: number): number {
  if (!(v >= 0) || !(v < Number.MAX_SAFE_INTEGER)) {
    return 0;
  }
  let lo = 0;
  let hi = v < 1 ? 1 : v;
  while (lo < hi) {
    const mid = (lo + hi + 1) / 2 - (((lo + hi + 1) / 2) % 1);
    if (mid * mid <= v) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

// Minimum pairwise screen gap, floored to whole px (screen terms only).
function minGapPx(pts: readonly Pt[], view: View): number | null {
  let best: number | null = null;
  const ss = pts.map((p) => worldToScreen(p, view));
  for (let i = 0; i < ss.length; i += 1) {
    for (let j = i + 1; j < ss.length; j += 1) {
      const a = ss[i] as { x: number; y: number };
      const b = ss[j] as { x: number; y: number };
      const d2 = (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
      if (best === null || d2 < best) {
        best = d2;
      }
    }
  }
  return best === null ? null : isqrtFloor(best);
}

export function mountSandbox(
  shell: Shell,
  panels: HTMLElement,
  toast: (message: string) => void,
): ModeHandle {
  // Interaction state (UI-only, never domain state).
  let owner: Player = "maker";
  let browseIdx = 0;
  let allK: { k: number; text: string }[] | null = null;
  let allKCount = -1;
  let overlayStrategy: string | null = null;
  let gpCount = -1;
  let gpVerdict = "";
  let verifyTimer: ReturnType<typeof setTimeout> | null = null;
  let verifyCancel = false;
  let verifyProgress = "";
  let verifyResult = "";

  const controls = document.createElement("div");
  controls.id = "sandbox-controls";

  const makerBtn = document.createElement("button");
  makerBtn.textContent = "Maker";
  const breakerBtn = document.createElement("button");
  breakerBtn.textContent = "Breaker";
  const syncOwner = (): void => {
    makerBtn.setAttribute("aria-pressed", String(owner === "maker"));
    breakerBtn.setAttribute("aria-pressed", String(owner === "breaker"));
  };
  makerBtn.addEventListener("click", () => {
    owner = "maker";
    syncOwner();
  });
  breakerBtn.addEventListener("click", () => {
    owner = "breaker";
    syncOwner();
  });
  syncOwner();

  const undoBtn = document.createElement("button");
  undoBtn.textContent = "Undo";
  undoBtn.addEventListener("click", () => {
    navigate(shell.store, { kind: "undo" });
    afterBoardChange();
  });
  const resetBtn = document.createElement("button");
  resetBtn.textContent = "Reset";
  resetBtn.addEventListener("click", () => {
    shell.reset();
  });
  const exportBtn = document.createElement("button");
  exportBtn.textContent = "Export replay";
  exportBtn.addEventListener("click", () => {
    try {
      const cursor = shell.store.cursorTxnId();
      const text = exportSession(
        shell,
        `sandbox k=${shell.store.current().k} t${cursor}`,
      );
      downloadReplay(
        `playing-the-proof-sandbox-k${shell.store.current().k}-t${cursor}.replay.json`,
        text,
      );
    } catch {
      toast("Export failed — implementation error");
    }
  });

  // k-selector (3–8): a new session at the chosen k.
  const kRow = document.createElement("div");
  kRow.id = "sandbox-k";
  const kLabel = document.createElement("label");
  kLabel.textContent = "k: ";
  kRow.appendChild(kLabel);
  const syncK = (): void => {
    for (const el of kRow.querySelectorAll("button")) {
      el.setAttribute(
        "aria-pressed",
        String(Number(el.textContent) === shell.store.current().k),
      );
    }
  };
  for (const k of [3, 4, 5, 6, 7, 8]) {
    const b = document.createElement("button");
    b.textContent = String(k);
    b.addEventListener("click", () => {
      shell.startSandbox(k as 3 | 4 | 5 | 6 | 7 | 8);
    });
    kRow.appendChild(b);
  }

  // Winning-hole rule (docs/BICHROMATIC.md): the rule is a property of the
  // session (GameState.gameMode), so switching starts a fresh sandbox.
  const gameMode = gameModeOf(shell.store.current());
  const ruleRow = document.createElement("div");
  ruleRow.id = "sandbox-rule";
  const ruleLabel = document.createElement("label");
  ruleLabel.textContent = "rule: ";
  ruleRow.appendChild(ruleLabel);
  for (const m of ["monochromatic", "bichromatic"] as const) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = gameModeLabel(m).short;
    b.setAttribute("aria-pressed", String(m === gameMode));
    b.addEventListener("click", () => {
      if (m !== gameMode) {
        shell.startSandbox(
          shell.store.current().k as 3 | 4 | 5 | 6 | 7 | 8,
          m,
        );
      }
    });
    ruleRow.appendChild(b);
  }
  const ruleCap = document.createElement("p");
  ruleCap.id = "sandbox-rule-caption";
  ruleCap.textContent = ruleCaption(gameMode);
  ruleRow.appendChild(ruleCap);

  // Seeded generator (sizes 3–24; 25–32 with an explicit capped warning).
  const genBox = document.createElement("div");
  genBox.id = "sandbox-generate";
  const seedLabel = document.createElement("label");
  seedLabel.textContent = "seed ";
  const seedInput = document.createElement("input");
  seedInput.id = "gen-seed";
  seedInput.value = "7";
  seedLabel.htmlFor = "gen-seed";
  const sizeLabel = document.createElement("label");
  sizeLabel.textContent = "size (3–24, to 32 capped) ";
  const sizeInput = document.createElement("input");
  sizeInput.id = "gen-size";
  sizeInput.value = "12";
  sizeLabel.htmlFor = "gen-size";
  const genBtn = document.createElement("button");
  genBtn.textContent = "Generate";
  const genNote = document.createElement("span");
  genNote.id = "gen-note";
  genBtn.addEventListener("click", () => {
    generate(seedInput.value, sizeInput.value, genNote, toast);
  });
  genBox.append(seedLabel, seedInput, sizeLabel, sizeInput, genBtn, genNote);

  // Typed placement (a11y alternative to clicking).
  const placeBox = document.createElement("div");
  placeBox.id = "sandbox-place";
  const xLabel = document.createElement("label");
  xLabel.textContent = "x ";
  const xInput = document.createElement("input");
  xInput.id = "place-x";
  xLabel.htmlFor = "place-x";
  const yLabel = document.createElement("label");
  yLabel.textContent = "y ";
  const yInput = document.createElement("input");
  yInput.id = "place-y";
  yLabel.htmlFor = "place-y";
  const placeBtn = document.createElement("button");
  placeBtn.textContent = "Place";
  placeBtn.addEventListener("click", () => {
    placeTyped(xInput.value, yInput.value);
  });
  placeBox.append(xLabel, xInput, yLabel, yInput, placeBtn);

  const diag = document.createElement("div");
  diag.id = "sandbox-diagnostics";

  // Hole browser + count-all-k.
  const browseBox = document.createElement("div");
  browseBox.id = "sandbox-holes";
  const prevBtn = document.createElement("button");
  prevBtn.textContent = "◀ hole";
  const nextBtn = document.createElement("button");
  nextBtn.textContent = "hole ▶";
  const browseCap = document.createElement("span");
  browseCap.id = "hole-caption";
  prevBtn.addEventListener("click", () => {
    browseIdx -= 1;
    shell.render();
  });
  nextBtn.addEventListener("click", () => {
    browseIdx += 1;
    shell.render();
  });
  const countBtn = document.createElement("button");
  countBtn.textContent = "Count all k";
  countBtn.addEventListener("click", () => {
    countAllK();
  });
  const countOut = document.createElement("div");
  countOut.id = "allk-counts";
  browseBox.append(prevBtn, nextBtn, browseCap, countBtn, countOut);

  // Overmars-29 preset + demo + re-verify.
  const presetBox = document.createElement("div");
  presetBox.id = "sandbox-preset";
  const presetBtn = document.createElement("button");
  presetBtn.textContent = "Load Overmars-29";
  presetBtn.addEventListener("click", () => {
    pendingPreset = true;
    shell.startSandbox(6);
  });
  const presetBanner = document.createElement("div");
  presetBanner.id = "preset-banner";
  const verifyBtn = document.createElement("button");
  verifyBtn.textContent = "Re-verify full sweep";
  verifyBtn.addEventListener("click", () => {
    startVerify();
  });
  const verifyCancelBtn = document.createElement("button");
  verifyCancelBtn.textContent = "Cancel";
  verifyCancelBtn.addEventListener("click", () => {
    verifyCancel = true;
  });
  const verifyBar = document.createElement("div");
  verifyBar.id = "verify-progress";
  const verifyOut = document.createElement("div");
  verifyOut.id = "verify-result";
  presetBox.append(
    presetBtn,
    presetBanner,
    verifyBtn,
    verifyCancelBtn,
    verifyBar,
    verifyOut,
  );

  // Passive strategy overlay.
  const sovBox = document.createElement("div");
  sovBox.id = "sandbox-overlay";
  const sovLabel = document.createElement("label");
  sovLabel.textContent = "strategy overlay ";
  const sovSelect = document.createElement("select");
  sovSelect.id = "overlay-strategy";
  const sovBlank = document.createElement("option");
  sovBlank.value = "";
  sovBlank.textContent = "off";
  sovSelect.appendChild(sovBlank);
  for (const rs of listStrategies(shell.ctx)) {
    const opt = document.createElement("option");
    opt.value = rs.id;
    opt.textContent = `${rs.id} (${rs.status})`;
    sovSelect.appendChild(opt);
  }
  sovSelect.addEventListener("change", () => {
    overlayStrategy = sovSelect.value === "" ? null : sovSelect.value;
    shell.render();
  });
  const sovList = document.createElement("div");
  sovList.id = "overlay-list";
  sovBox.append(sovLabel, sovSelect, sovList);

  // Honesty footer (§14.2 non-guarantees, shown in-mode).
  const footer = document.createElement("div");
  footer.id = "sandbox-honesty";
  footer.textContent =
    "Sandbox only: a k-hole existing is shown with its analysis kind; no win/lose beyond that, no legality beyond general position, no strategy validity, and no claim that a configuration is reachable in play.";

  // QA D10: a visible way back to the menu (Esc/M were Proof/Break only).
  const menuBtn = document.createElement("button");
  menuBtn.textContent = "Menu";
  menuBtn.title = "Back to the mode menu (Esc / M)";
  menuBtn.addEventListener("click", () => shell.toEntry());
  const onSandboxKey = (e: KeyboardEvent): void => {
    if (!document.contains(shell.svg)) {
      document.removeEventListener("keydown", onSandboxKey);
      return;
    }
    const t = e.target;
    if (
      t instanceof HTMLInputElement ||
      t instanceof HTMLSelectElement ||
      t instanceof HTMLTextAreaElement
    ) {
      return;
    }
    if (e.key === "Escape" || e.key === "m" || e.key === "M") {
      shell.toEntry();
    }
  };
  document.addEventListener("keydown", onSandboxKey);
  controls.append(makerBtn, breakerBtn, undoBtn, resetBtn, exportBtn, menuBtn);
  // The Overmars-29 facts are about the monochromatic rule: disabled, with
  // the reason shown, under the bichromatic rule.
  if (gameMode === "bichromatic") {
    presetBtn.disabled = true;
    presetBtn.setAttribute("aria-describedby", "preset-why");
    const why = document.createElement("p");
    why.id = "preset-why";
    why.textContent =
      "Unavailable under the bichromatic rule: the Overmars-29 data and its hexagon facts concern the monochromatic game.";
    presetBox.insertBefore(why, presetBanner);
    verifyBtn.disabled = true;
  }
  panels.append(
    controls,
    kRow,
    ruleRow,
    genBox,
    placeBox,
    diag,
    browseBox,
    presetBox,
    sovBox,
    footer,
  );

  // Pending preset consumed at boot (remount path for k changes).
  if (pendingPreset) {
    pendingPreset = false;
    loadPreset();
  }

  function currentK(): number {
    return shell.store.current().k;
  }

  function generate(
    seedText: string,
    sizeText: string,
    note: HTMLElement,
    toastFn: (m: string) => void,
  ): void {
    let seed: bigint;
    try {
      if (!/^-?\d+$/.test(seedText.trim())) {
        throw new Error("bad seed");
      }
      seed = BigInt(seedText.trim());
    } catch {
      toastFn("Seed must be an integer.");
      return;
    }
    const size = Number(sizeText);
    if (!Number.isInteger(size) || size < 3 || size > 32) {
      toastFn("Size must be an integer 3–32.");
      return;
    }
    note.textContent =
      size > 24
        ? "sizes above 24 may cap analysis (kinds labeled below)"
        : `seeded set: seed ${seedText.trim()}, ${size} points`;
    // Fresh session at the current k, then sequential legal placements
    // (deterministic stream ⇒ deterministic set; GP screened exactly
    // against committed + already-generated points).
    const k = currentK();
    shell.store.clear();
    const started = startSession(
      {
        kind: "sandbox",
        config: {
          mode: "sandbox",
          window: shell.ctx.config.window,
          ...(gameMode === "bichromatic" ? { gameMode } : {}),
        },
        k: k as 3 | 4 | 5 | 6 | 7 | 8,
      },
      shell.ctx,
      shell.store,
    );
    if (started.status !== "accepted") {
      toastFn("Could not restart the sandbox session.");
      return;
    }
    const rand = lcg64(seed);
    const fresh: Pt[] = [];
    for (let i = 0; i < size; i += 1) {
      let at: Pt | null = null;
      for (let t = 0; t < 500 && at === null; t += 1) {
        const cand = pt(
          Rat.make((rand() % 81n) - 40n),
          Rat.make((rand() % 81n) - 40n),
        );
        const combo = [
          ...shell.store.current().points.map((p) => p.pt),
          ...fresh,
          cand,
        ];
        if (gp(combo)) {
          at = cand;
        }
      }
      if (at === null) {
        toastFn("Could not complete a general-position set from this seed.");
        return;
      }
      fresh.push(at);
    }
    // Window legality (rung 1) for the batch; GP already established.
    const window = shell.ctx.config.window;
    for (const q of fresh) {
      if (
        window.xMin.cmp(q.x) > 0 ||
        q.x.cmp(window.xMax) > 0 ||
        window.yMin.cmp(q.y) > 0 ||
        q.y.cmp(window.yMax) > 0
      ) {
        toastFn("Generated set leaves the play window.");
        return;
      }
    }
    bulkPlace(fresh.map((q) => ({ owner, at: q })), toastFn);
    shell.setHoleFacts(null);
    browseIdx = 0;
    allK = null;
    shell.render();
  }

  function placeTyped(xText: string, yText: string): void {
    let x: Rat;
    let y: Rat;
    try {
      x = Rat.fromString(xText.trim());
      y = Rat.fromString(yText.trim());
    } catch {
      toast("Coordinates must be rationals (n/d).");
      return;
    }
    const LIM = 10n ** 100n;
    for (const v of [x, y]) {
      if (v.n > LIM || v.n < -LIM || v.d > LIM) {
        toast("Unreasonably large rational (limit 10^100).");
        return;
      }
    }
    const at = pt(x, y);
    const view = shell.view();
    const state = shell.store.current();
    const { ghost } = hoverToGhost(
      0,
      0,
      at,
      state,
      view,
      shell.ctx.config.window,
    );
    if (ghost.rejection !== null) {
      toast(rejectionText(ghost.rejection));
      return;
    }
    for (const p of state.points) {
      if (
        !exceedsSeparation(at, p.pt, view, shell.ctx.config.ui.minSeparationPx)
      ) {
        toast(rejectionText({ reason: "ui-too-close", at }));
        return;
      }
    }
    dispatch(shell.store, shell.ctx, { kind: "place", owner, at }, toast);
    afterBoardChange();
  }

  // (sandbox perf, F-16): bulk loads (generator, preset) used to run the
  // capped per-placement hole analysis + a render for EVERY point (≈ 0.7 s each
  // at 25+ points: 4–27 s of blocking). The per-placement analysis only feeds
  // a diagnostic note the bulk path discards, so the engine runs with budget 0
  // and the store publishes ONCE; the board analysis runs once, in render().
  function bulkPlace(
    items: ReadonlyArray<{ owner: "maker" | "breaker"; at: Pt }>,
    toastFn: (m: string) => void,
  ): void {
    const quick = {
      ...shell.ctx,
      config: { ...shell.ctx.config, analysis: { budgetOps: 0 } },
    };
    shell.store.batch(() => {
      for (const it of items) {
        dispatch(shell.store, quick, { kind: "place", owner: it.owner, at: it.at }, toastFn);
      }
    });
  }

  function afterBoardChange(): void {
    allK = null;
    // (F-17): the pre-verified fixture facts belong to the EXACT preset
    // board — restore them when undo/redo returns to it, drop them otherwise.
    shell.setHoleFacts(presetMatch(shell.store.current()) ? OVERMARS_FACTS : null);
    shell.render();
  }

  function countAllK(): void {
    const state = shell.store.current();
    const n = state.points.length;
    const rows: { k: number; text: string }[] = [];
    for (const k of [3, 4, 5, 6, 7, 8]) {
      const a = analyzeWinHoles(
        { ...state, k: k as GameState["k"] },
        k,
        { budget: shell.ctx.config.analysis.budgetOps },
      );
      if (a.kind === "exhaustive") {
        rows.push({
          k,
          text: `k=${k}: ${a.holes.length} hole(s), exhaustive over ${n} points`,
        });
      } else if (a.kind === "witness-only") {
        rows.push({ k, text: `k=${k}: ${HONESTY_WITNESS_ONLY}` });
      } else {
        rows.push({ k, text: `k=${k}: ${HONESTY_BUDGET_EXHAUSTED}` });
      }
    }
    allK = rows;
    allKCount = n;
    shell.render();
  }

  function loadPreset(): void {
    shell.setHoleFacts(OVERMARS_FACTS);
    const pts = overmarsPts();
    bulkPlace(
      pts.map((q, i) => ({ owner: i % 2 === 0 ? ("maker" as const) : ("breaker" as const), at: q })),
      toast,
    );
    browseIdx = 0;
    allK = null;
    shell.render();
  }

  // Chunked exhaustive 6-hole sweep (explicit re-verification): lexicographic
  // 6-combinations of 0..28 through isKHole, sliced for UI liveness.
  function startVerify(): void {
    if (verifyTimer !== null || !presetMatch(shell.store.current())) {
      return;
    }
    verifyCancel = false;
    verifyProgress = "0%";
    verifyResult = "";
    const pts = overmarsPts();
    const idx = [0, 1, 2, 3, 4, 5];
    const total = 475020;
    let done = 0;
    let holes = 0;
    let finished = false;
    const step = (): void => {
      if (verifyCancel) {
        verifyTimer = null;
        verifyProgress = "cancelled";
        verifyResult = "";
        shell.render();
        return;
      }
      const slice = 500;
      for (let s = 0; s < slice && !finished; s += 1) {
        const subset = idx.map((i) => pts[i] as Pt);
        if (isKHole(subset, pts)) {
          holes += 1;
        }
        done += 1;
        let i = 5;
        while (i >= 0 && (idx[i] as number) === 29 - 6 + i) {
          i -= 1;
        }
        if (i < 0) {
          finished = true;
        } else {
          const v = (idx[i] as number) + 1;
          for (let j = i; j < 6; j += 1) {
            idx[j] = v + (j - i);
          }
        }
      }
      verifyProgress =
        done >= total || finished ? "100%" : `${(done * 100) / total}%`;
      if (done >= total || finished) {
        verifyTimer = null;
        verifyProgress = "100%";
        verifyResult =
          holes === 0
            ? `0 empty hexagons among ${total} 6-subsets — matches the pre-verified fixture`
            : `MISMATCH: ${holes} empty hexagons — fixture disagrees`;
      } else {
        verifyTimer = setTimeout(step, 0);
      }
      shell.render();
    };
    verifyTimer = setTimeout(step, 0);
    shell.render();
  }

  function stopVerify(): void {
    verifyCancel = true;
    if (verifyTimer !== null) {
      clearTimeout(verifyTimer);
      verifyTimer = null;
    }
  }

  function kindSummary(holes: HoleAnalysis, n: number): string {
    if (holes.kind === "exhaustive") {
      return `${holes.holes.length} ${holes.k}-hole(s), exhaustive over ${n} points`;
    }
    if (holes.kind === "witness-only") {
      return `witness-only: ${HONESTY_WITNESS_ONLY} over ${n} points`;
    }
    return `search capped over ${n} points — ${HONESTY_BUDGET_EXHAUSTED}`;
  }

  shell.onRender((state: GameState) => {
    syncK();
    syncOwner();
    const n = state.points.length;
    const holes = shell.holes();
    // Diagnostics: counts, session-k analysis with kind, min gap, GP.
    if (n !== gpCount) {
      gpCount = n;
      gpVerdict = gp(state.points.map((p) => p.pt))
        ? `general position: yes (checked over ${n} points)`
        : "general position: VIOLATED — implementation error";
    }
    const gap = minGapPx(
      state.points.map((p) => p.pt),
      shell.view(),
    );
    diag.textContent =
      `points: ${n} · turn: ${state.turn} · k=${state.k} · ${kindSummary(holes, n)}` +
      ` · min display gap: ${gap === null ? "—" : `${gap}px`}` +
      ` · ${gpVerdict}` +
      (gameMode === "bichromatic"
        ? " · bichromatic rule: holes use Maker points only; Breaker points are blockers"
        : "");
    // Hole browser.
    const list =
      holes.kind === "exhaustive"
        ? holes.holes.map((h) => [...h.verts])
        : holes.kind === "witness-only"
          ? [[...holes.witness.verts]]
          : [];
    if (list.length > 0) {
      browseIdx = ((browseIdx % list.length) + list.length) % list.length;
      const verts = list[browseIdx] as string[];
      browseCap.textContent =
        holes.kind === "exhaustive"
          ? `${holes.k}-hole ${browseIdx + 1} of ${list.length}: ${verts.join(", ")}`
          : `${holes.k}-hole witness (1 of ? — capped: not a full count): ${verts.join(", ")}`;
    } else if (holes.kind === "budget-exhausted") {
      browseCap.textContent = `no k-hole found within budget — never presented as 'none exist'`;
    } else {
      browseCap.textContent = "no holes to browse";
    }
    // Count-all-k staleness.
    if (allK !== null && allKCount !== n) {
      allK = null;
      countOut.replaceChildren();
    }
    if (allK !== null) {
      countOut.replaceChildren();
      const ul = document.createElement("ul");
      for (const row of allK) {
        const li = document.createElement("li");
        li.textContent = row.text;
        ul.appendChild(li);
      }
      countOut.appendChild(ul);
    }
    // Preset banner + demo state.
    presetBanner.replaceChildren();
    if (presetMatch(state)) {
      const layers = hullLayers(state.points.map((p) => p.pt));
      const info = document.createElement("p");
      info.textContent =
        `Overmars-29 (pre-verified fixture data): 0 empty hexagons (exhaustive over 29 points); ` +
        `hull layers ${layers.join(",")}; ${String(OVERMARS.checks.V7_empty_convex_pentagons)} empty pentagons (pre-verified). ` +
        `Place a 30th point anywhere — h(6) = 30 says an empty hexagon must appear.`;
      presetBanner.appendChild(info);
    } else if (demoBase(state)) {
      const info = document.createElement("p");
      if (holes.kind === "witness-only") {
        info.textContent =
          `h(6) = 30 at work: empty hexagon ${holes.witness.verts.join(", ")} found ` +
          `(first-witness search, labeled as such — not an exhaustive count).`;
      } else if (holes.kind === "exhaustive") {
        info.textContent = `30-point analysis, exhaustive over ${n} points: ${holes.holes.length} 6-hole(s).`;
      } else {
        info.textContent = `searching: ${HONESTY_BUDGET_EXHAUSTED}`;
      }
      presetBanner.appendChild(info);
    }
    verifyBar.textContent =
      verifyTimer !== null || verifyProgress !== ""
        ? `re-verify: ${verifyProgress}`
        : "";
    verifyOut.textContent = verifyResult;
    // Passive strategy overlay.
    sovList.replaceChildren();
    const extra: SceneNode[] = [];
    if (overlayStrategy !== null) {
      const ovs = strategyOverlays(overlayStrategy, state, shell.ctx);
      if (ovs === null) {
        const p = document.createElement("p");
        p.textContent = "unknown strategy";
        sovList.appendChild(p);
      } else {
        const view = shell.view();
        const ul = document.createElement("ul");
        let oi = 0;
        for (const o of ovs) {
          const li = document.createElement("li");
          if (o.region !== null) {
            li.textContent = `${o.nodeId}: ${o.label} (live)`;
            const parts =
              o.region.kind === "poly"
                ? [o.region]
                : o.region.parts.filter((q) => q.kind === "poly");
            for (const part of parts) {
              if (part.kind !== "poly" || part.verts.length < 3) {
                continue;
              }
              extra.push(
                node(`sov-${oi}`, "region", "polygon", {
                  class: "viz-sov",
                  points: part.verts
                    .map((q) => {
                      const s = worldToScreen(q, view);
                      return `${roundHalf(s.x)},${roundHalf(s.y)}`;
                    })
                    .join(" "),
                  fill: "#2B5F8A",
                  opacity: "0.10",
                  stroke: "#2B5F8A",
                  "stroke-width": "1",
                }),
              );
              oi += 1;
            }
          } else {
            li.textContent = `${o.nodeId}: ${o.label} — ${o.skipped ?? "unavailable"}`;
          }
          ul.appendChild(li);
        }
        sovList.appendChild(ul);
      }
    }
    // Browse highlight.
    if (list.length > 0) {
      const verts = list[browseIdx] as string[];
      const pts: Pt[] = [];
      for (const id of verts) {
        const p = state.points.find((q) => q.id === id)?.pt;
        if (p !== undefined) {
          pts.push(p);
        }
      }
      if (pts.length === verts.length && pts.length >= 3) {
        const view = shell.view();
        extra.push(
          node("browse-hl", "hole", "polygon", {
            class: "viz-browse",
            points: pts
              .map((q) => {
                const s = worldToScreen(q, view);
                return `${roundHalf(s.x)},${roundHalf(s.y)}`;
              })
              .join(" "),
            fill: "none",
            stroke: "#38A169",
            "stroke-width": "3",
          }),
        );
      }
    }
    shell.setExtraLayer(extra);
  });

  const local = (e: MouseEvent): { sx: number; sy: number } => {
    const rect = shell.svg.getBoundingClientRect();
    return clientToLocal(e.clientX, e.clientY, rect.left, rect.top);
  };

  const onMove = (e: MouseEvent): void => {
    const { sx, sy } = local(e);
    const view = shell.view();
    const quantized = screenToWorldQuantized(sx, sy, view);
    const { ghost } = hoverToGhost(
      sx,
      sy,
      quantized,
      shell.store.current(),
      view,
      shell.ctx.config.window,
    );
    shell.setGhost(ghost);
    shell.render();
  };
  const onLeave = (): void => {
    shell.setGhost(null);
    shell.render();
  };
  const onClick = (e: MouseEvent): void => {
    const { sx, sy } = local(e);
    const view = shell.view();
    const state = shell.store.current();
    const at = screenToWorldQuantized(sx, sy, view);
    const { ghost } = hoverToGhost(
      sx,
      sy,
      at,
      state,
      view,
      shell.ctx.config.window,
    );
    if (ghost.rejection !== null) {
      toast(rejectionText(ghost.rejection));
      return;
    }
    for (const p of state.points) {
      if (
        !exceedsSeparation(at, p.pt, view, shell.ctx.config.ui.minSeparationPx)
      ) {
        toast(rejectionText({ reason: "ui-too-close", at }));
        return;
      }
    }
    // Math-legal and displayable: the single engine path (commit publishes
    // → subscribers re-render).
    dispatch(shell.store, shell.ctx, { kind: "place", owner, at }, toast);
    afterBoardChange();
  };
  shell.svg.addEventListener("mousemove", onMove);
  shell.svg.addEventListener("mouseleave", onLeave);
  shell.svg.addEventListener("click", onClick);

  return {
    destroy(): void {
      stopVerify();
      shell.svg.removeEventListener("mousemove", onMove);
      shell.svg.removeEventListener("mouseleave", onLeave);
      shell.svg.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onSandboxKey);
      controls.remove();
      kRow.remove();
      ruleRow.remove();
      genBox.remove();
      placeBox.remove();
      diag.remove();
      browseBox.remove();
      presetBox.remove();
      sovBox.remove();
      footer.remove();
      shell.setGhost(null);
    },
  };
}
