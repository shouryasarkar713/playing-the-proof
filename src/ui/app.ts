// ui/app.ts — shell: store lifecycle, keyed scene application, toasts,
// overlay flags, mode management (entry/sandbox/proof). The scene applier
// lives here (Phase-8 home): viz/ is DOM-free by architecture, so
// descriptor→DOM materialization is a ui-side effect.
import { Rat } from "../geometry/rat.ts";
import type { HoleAnalysis } from "../geometry/holes.ts";
import { stateHash } from "../game/hash.ts";
import { analyzeWinHoles } from "../game/gamemode.ts";
import { isUnitBias } from "../game/turnorder.ts";
import { biasLabel } from "../explain/bias.ts";
import type {
  Configuration,
  GameMode,
  GameState,
  StrategyStart,
} from "../game/types.ts";
import type { ExperimentFile } from "../replay/experiment.ts";
import { startSession } from "../session/commit.ts";
import { Store } from "../session/store.ts";
import { autoFit } from "../viz/projection.ts";
import type { View } from "../viz/projection.ts";
import { buildScene, diffScene, layerOrder } from "../viz/scene.ts";
import type {
  GhostSpec,
  SceneDesc,
  SceneNode,
  ScenePatch,
} from "../viz/scene.ts";
import { mountSandbox } from "./modes/sandbox.ts";
import { mountProof } from "./modes/proof.ts";
import { mountBreak } from "./modes/break.ts";
import { mountKStrip } from "./modes/kstrip.ts";
import { mountLab } from "./modes/lab.ts";
import { mountEntry } from "./entry.ts";
import { hudEnabled, mountHud } from "./hud.ts";
import type { RuntimeCtx } from "../engine/orchestrator.ts";

const SVGNS = "http://www.w3.org/2000/svg";

function tagFor(kind: SceneNode["kind"]): string {
  switch (kind) {
    case "rect":
      return "rect";
    case "circle":
      return "circle";
    case "diamond":
    case "polygon":
      return "polygon";
    case "polyline":
      return "polyline";
    case "path":
      return "path";
    case "line":
      return "line";
    case "text":
      return "text";
  }
}

function setAttrs(el: SVGElement, n: SceneNode): void {
  for (const name of el.getAttributeNames()) {
    el.removeAttribute(name);
  }
  for (const [name, value] of Object.entries(n.attrs)) {
    el.setAttribute(name, value);
  }
  el.textContent = n.text ?? "";
}

// applyScene: keyed application — same key keeps the same DOM node across
// frames (no leaks, no unkeyed churn); z-order re-asserted by append order.
export function applyScene(
  svg: SVGSVGElement,
  ordered: readonly SceneNode[],
  patch: ScenePatch,
  keys: Map<string, SVGElement>,
): void {
  for (const key of patch.unmount) {
    keys.get(key)?.remove();
    keys.delete(key);
  }
  const updates = new Set(patch.update.map((n) => n.key));
  for (const n of ordered) {
    let el = keys.get(n.key);
    if (el === undefined || el.tagName.toLowerCase() !== tagFor(n.kind)) {
      el?.remove();
      el = document.createElementNS(SVGNS, tagFor(n.kind));
      setAttrs(el, n);
      keys.set(n.key, el);
    } else if (updates.has(n.key)) {
      setAttrs(el, n);
    }
    svg.appendChild(el);
  }
}

export interface OverlayFlags {
  hull: boolean;
  holes: boolean;
  labels: boolean;
  casemap: boolean;
  regions: boolean; // strategy region overlays (forced region, ears, twins) — key 5
}

export interface Shell {
  readonly store: Store;
  readonly ctx: RuntimeCtx;
  readonly svg: SVGSVGElement;
  view(): View;
  render(): void;
  reset(): void;
  setRestart(fn: () => void): void;
  setGhost(ghost: GhostSpec | null): void;
  onRender(cb: (state: GameState) => void): void;
  overlays(): OverlayFlags;
  toggleOverlay(name: keyof OverlayFlags): void;
  cycleOverlay(n: number): void;
  setExtraLayer(nodes: SceneNode[]): void;
  toEntry(): void;
  startSandbox(k?: 3 | 4 | 5 | 6 | 7 | 8, gameMode?: GameMode, bias?: Rat): void;
  // Parameter Lab / k-strip explorer; an experiment file is replayed on mount.
  startLab(experiment?: ExperimentFile): void;
  startKStrip(experiment?: ExperimentFile): void;
  startProof(strategyId: string, strategyStart?: StrategyStart): void;
  startBreak(strategyId: string, strategyStart?: StrategyStart): void;
  showEntry(): void;
  // Last render's hole analysis (modes read it for browsers/diagnostics
  // without re-running the sweep).
  holes(): HoleAnalysis;
  // Override the board's hole analysis (the Overmars-29 fixture facts);
  // null restores live analysis. Cleared on every mode switch.
  setHoleFacts(facts: HoleAnalysis | null): void;
}

export interface ModeHandle {
  destroy(): void;
  // Modes that draw their own board (lab, k-strip) repaint on viewport
  // changes through this hook instead of the store-driven scene render.
  onResize?(): void;
}

function defaultConfig(): Configuration {
  return {
    window: {
      xMin: Rat.make(-1000000n),
      yMin: Rat.make(-1000000n),
      xMax: Rat.make(1000000n),
      yMax: Rat.make(1000000n),
    },
    ui: { minSeparationPx: 6, theme: "light", autoplayMs: 900 },
    engine: { maxPoints: 64 },
    analysis: { budgetOps: 20000000 },
  };
}

// createShell: the mode-agnostic shell (no session, no mode). Entry and
// modes boot on top via startSandbox/startProof/toEntry below. Registries
// are wired by the caller (main.ts passes the live maps; tests may pass
// empty ones) — ui/ never imports strategy/ or verification/ (§18.1).
export function createShell(
  svg: SVGSVGElement,
  panels: HTMLElement,
  opts?: {
    width?: number;
    height?: number;
    registries?: {
      strategies: RuntimeCtx["strategies"];
      classifiers: RuntimeCtx["classifiers"];
      checkers: RuntimeCtx["checkers"];
    };
  },
): Shell {
  const config = defaultConfig();
  const ctx: RuntimeCtx = {
    config,
    strategies: opts?.registries?.strategies ?? new Map(),
    classifiers: opts?.registries?.classifiers ?? new Map(),
    checkers: opts?.registries?.checkers ?? new Map(),
  };
  const store = new Store();
  const keys = new Map<string, SVGElement>();
  let prev: SceneDesc = { nodes: [] };
  let ghost: GhostSpec | null = null;
  let extra: SceneNode[] = [];
  const flags: OverlayFlags = {
    hull: true,
    holes: true,
    labels: true,
    casemap: false,
    regions: true,
  };
  const renderCbs: Array<(state: GameState) => void> = [];
  // Hole-analysis override (fixture facts) + memo by state hash (states are
  // immutable; analysis is pure in points/k/budget — re-renders are free).
  let holeFacts: HoleAnalysis | null = null;
  const holeMemo = new Map<string, HoleAnalysis>();
  let mode: ModeHandle | null = null;
  let restartRef: () => void = () => shell.startSandbox();
  // Dev HUD (§10.7): mounted lazily on the first render when the URL
  // query contains "debug"; cleared with the mode.
  let hud: { update(): void } | null = null;
  let hudBits = 0;
  // QA D2: the view size follows the LIVE board box — it was frozen at
  // load (entry-screen size), so narrow/portrait layouts drew points off-canvas.
  const curW = (): number =>
    opts?.width ?? (svg.clientWidth === 0 ? 800 : svg.clientWidth);
  const curH = (): number =>
    opts?.height ?? (svg.clientHeight === 0 ? 600 : svg.clientHeight);

  const toast = makeToast(panels);

  // clearPanels keeps the persistent toast box across mode switches.
  const clearPanels = (): void => {
    let box = panels.querySelector("#toasts");
    panels.replaceChildren();
    if (box === null) {
      box = document.createElement("div");
      box.id = "toasts";
      box.setAttribute("role", "status");
      box.setAttribute("aria-live", "polite");
    }
    panels.appendChild(box);
  };

  // the FIG caption states what the board shows NOW (it was a hard-coded
  // "(5, 4) happy ending board" in every mode). Text lives in a data attribute
  // read by the existing CSS ::after — the identity element is unchanged.
  const setFig = (text: string): void => {
    document.getElementById("board-wrap")?.setAttribute("data-fig", text);
  };
  const figForStrategy = (strategyId: string): string => {
    const k = ctx.strategies.get(strategyId)?.def.k;
    return k === 5
      ? "Das–Valla, Lemma 6: a 5-hole in four rounds"
      : k === 6
        ? "Das–Valla, Lemma 7: from a 5-hole to a 6-hole"
        : "Maker–Breaker strategy board";
  };

  const clearMode = (): void => {
    mode?.destroy();
    mode = null;
    hud = null;
    hudBits = 0;
    clearPanels();
    svg.replaceChildren();
    keys.clear();
    prev = { nodes: [] };
    ghost = null;
    extra = [];
    holeFacts = null;
    holeMemo.clear();
    // Render callbacks belong to modes; a switch drops them (fresh mount
    // re-registers). The store subscription (below) is shell-level.
  };

  // Memoized board analysis (see holeFacts/holeMemo above).
  const renderHoles = (state: GameState): HoleAnalysis => {
    // Audit (replay audit #2): the holes OVERLAY toggle must never feed a
    // fabricated empty-and-complete analysis to the diagnostics panels —
    // the analysis is always the real (memoized, budgeted) one; only the
    // DRAWING of holes is gated (below, in render()).
    const key = stateHash(state);
    const hit = holeMemo.get(key);
    if (hit !== undefined) {
      return hit;
    }
    // Ownership-aware (docs/BICHROMATIC.md): monochromatic states delegate
    // to the unrestricted search with identical arguments.
    const holes = analyzeWinHoles(state, state.k, {
      budget: ctx.config.analysis.budgetOps,
    });
    if (holeMemo.size >= 30) {
      const oldest = holeMemo.keys().next();
      if (!oldest.done) {
        holeMemo.delete(oldest.value);
      }
    }
    holeMemo.set(key, holes);
    return holes;
  };
  let lastHoles: HoleAnalysis = { kind: "exhaustive", k: 5, holes: [] };
  // The analysis object the last panel painting observed (second-pass
  // convergence below).
  let cbsHoles: HoleAnalysis | null = null;

  const shell: Shell = {
    store,
    ctx,
    svg,
    view(): View {
      return autoFit(
        store.current().points.map((p) => p.pt),
        curW(),
        curH(),
      );
    },
    render(): void {
      const t0 = performance.now();
      const state = store.current();
      // Mode callbacks first: they paint panels AND set the extra layer, so
      // the layer applies to the scene built below (same frame — otherwise
      // chips/highlights lag one render behind). Iterate over a copy (a
      // callback may replace modes during teardown cascades).
      for (const cb of [...renderCbs]) {
        cb(state);
      }
      const view = shell.view();
      const holes: HoleAnalysis = holeFacts ?? renderHoles(state);
      lastHoles = holes;
      const next = buildScene(
        {
          state,
          holes: flags.holes
            ? holes
            : { kind: "exhaustive", k: state.k, holes: [] }, // drawing only
          showHull: flags.hull,
          ghost,
          labels: flags.labels,
        },
        view,
      );
      const ordered = layerOrder([...next.nodes, ...extra]);
      const patch = diffScene(prev, { nodes: ordered });
      applyScene(svg, ordered, patch, keys);
      prev = { nodes: ordered };
      // Panels painted above read the PREVIOUS frame's analysis; when this
      // frame computed a new analysis object, repaint them once with fresh
      // holes (the memoized check is free; reference comparison terminates
      // the cascade — stable renders stay single-pass).
      if (holes !== cbsHoles) {
        cbsHoles = holes;
        for (const cb of [...renderCbs]) {
          cb(state);
        }
      }
      // Dev HUD update (no-op unless ?debug mounted it).
      for (const p of state.points) {
        for (const v of [p.pt.x.n, p.pt.x.d, p.pt.y.n, p.pt.y.d]) {
          const bits = (v < 0n ? -v : v).toString(2).length;
          if (bits > hudBits) {
            hudBits = bits;
          }
        }
      }
      if (hud === null && hudEnabled(window.location.search)) {
        hud = mountHud(panels, () => ({
          mode: store.current().mode,
          node: store.current().strategy?.nodeId ?? "—",
          points: store.current().points.length,
          hash: stateHash(store.current()),
          renderMs: performance.now() - t0,
          maxBits: hudBits,
        }));
      }
      hud?.update();
    },
    reset(): void {
      restartRef();
    },
    setRestart(fn: () => void): void {
      restartRef = fn;
    },
    setGhost(g: GhostSpec | null): void {
      ghost = g;
    },
    onRender(cb: (state: GameState) => void): void {
      renderCbs.push(cb);
    },
    overlays(): OverlayFlags {
      return { ...flags };
    },
    toggleOverlay(name: keyof OverlayFlags): void {
      flags[name] = !flags[name];
      shell.render();
    },
    cycleOverlay(n: number): void {
      const names: Array<keyof OverlayFlags> = [
        "hull",
        "holes",
        "labels",
        "casemap",
        "regions",
      ];
      const name = names[(n - 1) % names.length];
      if (name !== undefined) {
        shell.toggleOverlay(name);
      }
    },
    setExtraLayer(nodes: SceneNode[]): void {
      extra = nodes;
    },
    toEntry(): void {
      shell.showEntry();
    },
    holes(): HoleAnalysis {
      return lastHoles;
    },
    setHoleFacts(facts: HoleAnalysis | null): void {
      holeFacts = facts;
    },
    startSandbox(
      k: 3 | 4 | 5 | 6 | 7 | 8 = 5,
      gameMode: GameMode = "monochromatic",
      bias?: Rat,
    ): void {
      const biasText = bias === undefined || isUnitBias(bias) ? "" : `, bias ${biasLabel(bias)}`;
      setFig(
        gameMode === "bichromatic"
          ? `Free point sets — Maker-only empty convex ${k}-gons (k = ${k}, bichromatic rule${biasText})`
          : `Free point sets — empty convex ${k}-gons (k = ${k}${biasText})`,
      );
      clearMode();
      renderCbs.length = 0;
      store.clear();
      const started = startSession(
        {
          kind: "sandbox",
          config: {
            mode: "sandbox",
            window: config.window,
            // Absent means monochromatic: only the literal flag is stored.
            ...(gameMode === "bichromatic" ? { gameMode } : {}),
            // Absent means 1:1: only a bias other than 1:1 is passed on.
            ...(bias !== undefined && !isUnitBias(bias) ? { bias } : {}),
          },
          k,
        },
        ctx,
        store,
      );
      if (started.status !== "accepted") {
        throw new Error("startSandbox failed");
      }
      const handle = mountSandbox(shell, panels, toast);
      mode = handle;
      shell.setRestart(() => shell.startSandbox(k, gameMode, bias));
      shell.render();
    },
    startLab(experiment?: ExperimentFile): void {
      setFig("Parameter Lab: which statement covers this game?");
      clearMode();
      renderCbs.length = 0;
      store.clear();
      mode = mountLab(shell, panels, toast, experiment ?? null);
      shell.setRestart(() => shell.startLab());
    },
    startKStrip(experiment?: ExperimentFile): void {
      setFig("k-strip explorer: exact construction, move log, counting ledger");
      clearMode();
      renderCbs.length = 0;
      store.clear();
      mode = mountKStrip(shell, panels, toast, experiment ?? null);
      shell.setRestart(() => shell.startKStrip());
    },
    startProof(strategyId: string, strategyStart?: StrategyStart): void {
      setFig(figForStrategy(strategyId));
      clearMode();
      renderCbs.length = 0;
      store.clear();
      const handle = mountProof(
        shell,
        panels,
        toast,
        strategyId,
        strategyStart,
      );
      mode = handle;
      shell.render();
    },
    startBreak(strategyId: string, strategyStart?: StrategyStart): void {
      setFig(figForStrategy(strategyId));
      clearMode();
      renderCbs.length = 0;
      store.clear();
      const handle = mountBreak(
        shell,
        panels,
        toast,
        strategyId,
        strategyStart,
      );
      mode = handle;
      shell.render();
    },
    showEntry(): void {
      setFig("Erdős–Szekeres: the happy ending problem");
      (ctx.config as { window: Configuration["window"] }).window =
        defaultConfig().window;
      clearMode();
      renderCbs.length = 0;
      store.clear();
      mountEntry(shell, panels, toast);
    },
  };

  store.subscribe(() => shell.render());
  // QA D2: re-fit on viewport changes (timer-coalesced; rAF is paused in hidden tabs). Skipped for tests that
  // pass an explicit fixed size.
  if (opts?.width === undefined && typeof window !== "undefined") {
    let pending = false;
    window.addEventListener("resize", () => {
      if (pending) {
        return;
      }
      pending = true;
      window.setTimeout(() => {
        pending = false;
        if (mode !== null) {
          if (mode.onResize !== undefined) {
            mode.onResize();
          } else {
            shell.render();
          }
        }
      }, 60);
    });
  }
  return shell;
}

// Toasts are non-blocking notices (§4.4): self-dismissing after
// TOAST_LIFETIME_MS and capped at TOAST_MAX on screen, so a long session
// (repeated rejections/hovers) can never grow #toasts unboundedly.
const TOAST_LIFETIME_MS = 6000;
const TOAST_MAX = 4;

export function makeToast(host: HTMLElement): (message: string) => void {
  let box = host.querySelector("#toasts");
  if (box === null) {
    box = document.createElement("div");
    box.id = "toasts";
    host.appendChild(box);
  }
  // QA D7: toasts are announced (polite live region).
  box.setAttribute("role", "status");
  box.setAttribute("aria-live", "polite");
  return (message: string) => {
    const div = document.createElement("div");
    div.className = "toast";
    div.textContent = message;
    box?.appendChild(div);
    while ((box?.childElementCount ?? 0) > TOAST_MAX) {
      box?.firstElementChild?.remove();
    }
    window.setTimeout(() => {
      div.remove();
    }, TOAST_LIFETIME_MS);
  };
}

// mount: direct sandbox boot (kept for tests + direct entry).
export function mount(
  svg: SVGSVGElement,
  panels: HTMLElement,
  opts?: { width?: number; height?: number; k?: 3 | 4 | 5 | 6 | 7 | 8 },
): Shell {
  const shell = createShell(svg, panels, opts);
  shell.startSandbox(opts?.k ?? 5);
  return shell;
}
