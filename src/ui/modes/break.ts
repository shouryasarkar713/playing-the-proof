// ui/modes/break.ts — Break-the-Proof mode (§12): free Breaker exploration
// against the encoded Maker strategy. Threat preview on hover (effective
// cells), classification chips + matched-cell highlight on the board,
// effect-diff in the Why panel, attack log, honesty footer, session
// summary, uncovered/integrity terminal panels, timeline branching.
// No sample chips, no autoplay (MVP free exploration only, §12.4).
import { startSession } from "../../session/commit.ts";
import { navigate } from "../../session/navigate.ts";
import {
  attackLog,
  caseWash,
  invariantStatuses,
  nodeExplanation,
  sessionStats,
  statusBadge,
  threatPreview,
  uncoveredCard,
  winCard,
} from "../../engine/describe.ts";
import {
  bootstrapErrorText,
  growToSeven,
  growToSevenBlock,
  growToSix,
  growToSixBlock,
} from "./promote.ts";
import { caseFill, regionOverlayNodes } from "../overlays.ts";
import { dispatch, rejectionText } from "../dispatch.ts";
import { downloadReplay, exportSession, forkSession } from "../replay-io.ts";
import { mountTimeline } from "../timeline.ts";
import type { TimelineHandle } from "../timeline.ts";
import { renderInvariants } from "../panels/invariants.ts";
import { renderStrategy } from "../panels/strategy.ts";
import { renderWhy } from "../panels/why.ts";
import {
  clientToLocal,
  exceedsSeparation,
  screenToWorldQuantized,
} from "../../viz/projection.ts";
import { hoverToGhost } from "../../viz/interaction.ts";
import { node } from "../../viz/shapes.ts";
import { roundHalf, worldToScreen } from "../../viz/projection.ts";
import type { View } from "../../viz/projection.ts";
import { pt } from "../../geometry/pt.ts";
import type { Pt } from "../../geometry/pt.ts";
import { Rat } from "../../geometry/rat.ts";
import type { ConvexPoly } from "../../geometry/poly.ts";
import type { GameState, StrategyStart } from "../../game/types.ts";
import type { ModeHandle, Shell } from "../app.ts";
import type { SceneNode } from "../../viz/scene.ts";

const HONESTY_FOOTER =
  "You are testing the encoded strategy. The published proof covers all replies; this encoding's coverage is shown per move.";

function pointsAttr(pts: readonly Pt[], view: View): string {
  return pts
    .map((p) => {
      const s = worldToScreen(p, view);
      return `${roundHalf(s.x)},${roundHalf(s.y)}`;
    })
    .join(" ");
}

function polyAttr(poly: ConvexPoly, view: View): string {
  return pointsAttr([...poly], view);
}

function uncoveredText(
  terminal: Extract<GameState["terminal"], { kind: "uncovered" }>,
  strategyId: string,
  ctx: Shell["ctx"],
): string {
  return uncoveredCard(terminal, strategyId, ctx);
}

export function mountBreak(
  shell: Shell,
  panels: HTMLElement,
  toast: (message: string) => void,
  strategyId: string,
  strategyStart?: StrategyStart,
): ModeHandle {
  const boot = (): void => {
    shell.store.clear();
    const started = startSession(
      {
        kind: "guided",
        config: { mode: "break", window: shell.ctx.config.window },
        strategyId,
        mode: "break",
        ...(strategyStart !== undefined ? { strategyStart } : {}),
      },
      shell.ctx,
      shell.store,
    );
    if (started.status !== "accepted") {
      toast(
        `Could not start ${strategyId}: ${started.error === undefined ? "rejected without detail" : bootstrapErrorText(started.error)}`,
      );
      return;
    }
    shell.render();
  };

  const strategyEl = document.createElement("section");
  strategyEl.id = "panel-strategy";
  const whyEl = document.createElement("section");
  whyEl.id = "panel-why";
  const invEl = document.createElement("section");
  invEl.id = "panel-invariants";
  const threatEl = document.createElement("div");
  threatEl.id = "threat-line";
  threatEl.setAttribute("aria-live", "polite");
  // Typed placement — the keyboard/assistive alternative to clicking the
  // board (QA D5,): exact rationals, same legality + UI checks as a click.
  const placeEl = document.createElement("form");
  placeEl.id = "break-place";
  placeEl.setAttribute("aria-label", "Place a Breaker point by typed coordinates");
  const mkField = (id: string, text: string): HTMLInputElement => {
    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = `${text} `;
    const input = document.createElement("input");
    input.id = id;
    input.autocomplete = "off";
    input.placeholder = "n or n/d";
    placeEl.append(label, input);
    return input;
  };
  const xIn = mkField("break-x", "x");
  const yIn = mkField("break-y", "y");
  const placeBtn = document.createElement("button");
  placeBtn.type = "submit";
  placeBtn.textContent = "Place Breaker point";
  placeEl.appendChild(placeBtn);
  const logEl = document.createElement("section");
  logEl.id = "attack-log";
  const summaryEl = document.createElement("div");
  summaryEl.id = "summary-line";
  const footerEl = document.createElement("div");
  footerEl.id = "honesty-footer";
  footerEl.textContent = HONESTY_FOOTER;
  const timelineEl = document.createElement("div");
  timelineEl.id = "timeline";
  const terminalHost = document.createElement("div");
  terminalHost.id = "terminal-host";
  panels.append(
    strategyEl,
    whyEl,
    invEl,
    threatEl,
    placeEl,
    logEl,
    summaryEl,
    footerEl,
    timelineEl,
    terminalHost,
  );

  // Chain length from the cursor (txn 0 counts): committed txns off the
  // chain are retries (branch variations), derived purely from the tree.
  const retriesOf = (): number => {
    const tree = shell.store.tree();
    let cursor: number | null = null;
    try {
      cursor = shell.store.cursorTxnId();
    } catch {
      return 0;
    }
    const chain = new Set<number>();
    let c: number | null = cursor;
    for (;;) {
      if (c === null) {
        break;
      }
      chain.add(c);
      const txn = tree.transactions.find((t) => t.txnId === c);
      c = txn?.parentTxnId ?? null;
    }
    return tree.transactions.length - chain.size;
  };

  const paintPanels = (state: GameState): void => {
    const stats = sessionStats(state);
    renderStrategy(strategyEl, state, stats, statusBadge(state, shell.ctx));
    renderWhy(whyEl, nodeExplanation(state, shell.ctx));
    paintOutcome(state);
    renderInvariants(invEl, invariantStatuses(state, shell.ctx));
    paintLog();
    paintTerminal(state);
  };

  // §12.3: the Why panel carries the classification, the effect diff, and
  // the post-reply invariant status for the latest attack.
  const paintOutcome = (state: GameState): void => {
    const host = whyEl.querySelector(".attack-outcome");
    host?.remove();
    const tree = shell.store.tree();
    let cursor: number | null = null;
    try {
      cursor = shell.store.cursorTxnId();
    } catch {
      return;
    }
    const txn = tree.transactions.find((t) => t.txnId === cursor);
    const placed = txn?.events.find((e) => e.owner === "breaker");
    if (txn === undefined || txn.parentTxnId === null || placed === undefined) {
      return;
    }
    const box = document.createElement("div");
    box.className = "attack-outcome";
    const head = document.createElement("h4");
    head.textContent = "Attack outcome";
    box.appendChild(head);
    const list = document.createElement("ul");
    const li = (tier: string, text: string): void => {
      const el = document.createElement("li");
      const chip = document.createElement("span");
      chip.className = `tier tier-${tier}`;
      chip.textContent = tier;
      el.append(chip, document.createTextNode(` ${text}`));
      list.appendChild(el);
    };
    if (placed.caseId !== undefined) {
      li("observed", `Your move was classified ${placed.caseId}.`);
    } else {
      li("observed", "Your move won immediately (no case).");
    }
    const log = attackLog(
      tree,
      (id) => shell.store.stateAtTxn(id),
      shell.ctx.config.analysis.budgetOps,
    );
    const entry = log?.entries.find((e) => e.txnId === cursor);
    for (const claim of entry?.claims ?? []) {
      if (
        claim.text.startsWith(`Txn ${cursor}: classified`) ||
        claim.text.startsWith(`Txn ${cursor}: the win`)
      ) {
        continue; // already stated above.
      }
      li(claim.tier, claim.text);
    }
    const lamps = invariantStatuses(state, shell.ctx);
    const passed = lamps.filter((l) => l.passed).length;
    li(
      "observed",
      `Invariants after the reply: ${passed} passed, ${lamps.length - passed} failed.`,
    );
    box.appendChild(list);
    whyEl.appendChild(box);
  };

  const paintLog = (): void => {
    logEl.replaceChildren();
    const head = document.createElement("h3");
    head.textContent = "Attack log";
    logEl.appendChild(head);
    const tree = shell.store.tree();
    const log = attackLog(
      tree,
      (id) => shell.store.stateAtTxn(id),
      shell.ctx.config.analysis.budgetOps,
    );
    if (log === null || log.entries.length === 0) {
      const p = document.createElement("p");
      p.textContent = "No attacks yet — place a Breaker point.";
      logEl.appendChild(p);
    } else {
      const list = document.createElement("ol");
      for (const entry of log.entries) {
        const item = document.createElement("li");
        const bits = [
          `t${entry.txnId} (${entry.point.x}, ${entry.point.y})`,
          entry.caseId ?? "no case",
          entry.terminalKind ?? "parked",
        ];
        item.textContent = bits.join(" · ");
        const sub = document.createElement("ul");
        for (const claim of entry.claims) {
          const sli = document.createElement("li");
          sli.textContent = `[${claim.tier}] ${claim.text}`;
          sub.appendChild(sli);
        }
        item.appendChild(sub);
        list.appendChild(item);
      }
      logEl.appendChild(list);
    }
    const byCase = log === null ? {} : log.summary.byCase;
    const caseBits = Object.entries(byCase).map(([c, n]) => `${c}: ${n}`);
    summaryEl.textContent =
      `Attacks: ${log === null ? 0 : log.summary.classified} classified` +
      (caseBits.length > 0 ? ` (${caseBits.join(", ")})` : "") +
      ` · wins ${log === null ? 0 : log.summary.wins}` +
      ` · uncovered ${log === null ? 0 : log.summary.uncovered}` +
      ` · retries ${retriesOf()}`;
  };

  const paintTerminal = (state: GameState): void => {
    terminalHost.replaceChildren();
    const terminal = state.terminal;
    if (terminal === null) {
      return;
    }
    const box = document.createElement("div");
    box.className = "terminal-card";
    if (terminal.kind === "maker-won") {
      const card = winCard(state);
      const head = document.createElement("h3");
      head.textContent = card?.title ?? "Maker wins";
      box.appendChild(head);
      if (card !== null) {
        const lines = document.createElement("p");
        lines.textContent = card.stats;
        box.appendChild(lines);
        const wit = document.createElement("ul");
        for (const w of card.witnesses) {
          const li = document.createElement("li");
          li.textContent = w;
          wit.appendChild(li);
        }
        box.appendChild(wit);
        const honest = document.createElement("p");
        honest.className = "honesty";
        honest.textContent = card.honesty;
        box.appendChild(honest);
      }
    } else if (terminal.kind === "uncovered") {
      const head = document.createElement("h3");
      head.textContent = "Outside the encoding's coverage";
      box.appendChild(head);
      const p = document.createElement("p");
      p.textContent = uncoveredText(
        terminal,
        state.strategy?.strategyId ?? "?",
        shell.ctx,
      );
      box.appendChild(p);
    } else {
      const head = document.createElement("h3");
      head.textContent = "Strategy integrity failure";
      box.appendChild(head);
      const p = document.createElement("p");
      const report = terminal.report;
      p.textContent = `${report.failedAt} ${report.phase}: ${report.failed.detail}`;
      box.appendChild(p);
    }
    const row = document.createElement("div");
    const again = document.createElement("button");
    again.textContent = "Play again";
    again.addEventListener("click", () => boot());
    const back = document.createElement("button");
    back.textContent = "Back one step";
    back.addEventListener("click", () =>
      navigate(shell.store, { kind: "undo" }),
    );
    row.append(again, back);
    if (state.k === 5 && terminal.kind === "maker-won") {
      const grow = document.createElement("button");
      grow.textContent = "Grow to 6";
      const blocked = growToSixBlock(state);
      grow.title =
        blocked ?? "Continue this won k=5 session into the k=6 phase.";
      grow.disabled = blocked !== null;
      grow.addEventListener("click", () => growToSix(shell, toast, "break"));
      row.appendChild(grow);
      if (blocked !== null) {
        const why = document.createElement("p");
        why.className = "honesty";
        why.textContent = blocked;
        box.appendChild(why);
      }
    }
    if (state.k === 6 && terminal.kind === "maker-won") {
      const grow = document.createElement("button");
      grow.textContent = "Grow to 7";
      const blocked = growToSevenBlock(state);
      grow.title =
        blocked ?? "Continue this won k=6 session into the k=7 phase.";
      grow.disabled = blocked !== null;
      grow.addEventListener("click", () => growToSeven(shell, toast, "break"));
      row.appendChild(grow);
      if (blocked !== null) {
        const why = document.createElement("p");
        why.className = "honesty";
        why.textContent = blocked;
        box.appendChild(why);
      }
    }
    box.appendChild(row);
    terminalHost.appendChild(box);
  };

  // Board layer: case-map wash (overlay-gated) + case chip on the latest
  // Breaker point. (The matched-cell flash of §12.2 is the chip + wash
  // pair: per-point previews resolve exactly through hypo-routing, while
  // the wash stays the cell teaching layer.)
  const extraLayer = (): SceneNode[] => {
    const out: SceneNode[] = [];
    const view = shell.view();
    const state = shell.store.current();
    if (shell.overlays().regions) {
      out.push(...regionOverlayNodes(state, shell.ctx, view));
    }
    if (shell.overlays().casemap) {
      let wi = 0;
      const caseIdx = new Map<string, number>();
      for (const cell of caseWash(state, shell.ctx)) {
        if (!caseIdx.has(cell.caseId)) {
          caseIdx.set(cell.caseId, caseIdx.size);
        }
        const tint = caseFill(caseIdx.get(cell.caseId) as number);
        out.push(
          node(`wash-${wi}`, "casemap", "polygon", {
            class: tint.cls,
            points: polyAttr(cell.poly, view),
            fill: tint.fill,
            opacity: "0.12",
            stroke: "#2B5F8A",
            "stroke-width": "1",
          }),
        );
        wi += 1;
      }
    }
    let cursor: number | null = null;
    try {
      cursor = shell.store.cursorTxnId();
    } catch {
      return out;
    }
    const tree = shell.store.tree();
    const txn = tree.transactions.find((t) => t.txnId === cursor);
    const placed = txn?.events.find((e) => e.owner === "breaker");
    if (txn !== undefined && placed !== undefined) {
      const s = worldToScreen(placed.at, view);
      out.push(
        node(
          `chip-${txn.txnId}`,
          "label",
          "text",
          {
            class: "viz-case-chip",
            x: String(roundHalf(s.x + 10)),
            y: String(roundHalf(s.y - 10)),
            "font-size": "12",
            fill: "#1A202C",
          },
          placed.caseId ?? "win",
        ),
      );
    }
    return out;
  };

  shell.onRender((state) => {
    paintPanels(state);
    shell.setExtraLayer(extraLayer());
  });

  const timeline: TimelineHandle = mountTimeline(shell, timelineEl, {
    autoplayMs: shell.ctx.config.ui.autoplayMs,
    toast,
    onSampleStep: null,
    fork: () => forkSession(shell, toast),
    exportAll: () => {
      try {
        const cursor = shell.store.cursorTxnId();
        const sid = shell.store.current().strategy?.strategyId ?? "session";
        downloadReplay(
          `playing-the-proof-${sid}-t${cursor}.replay.json`,
          exportSession(shell, `${sid} t${cursor}`),
        );
        toast(`Replay downloaded: playing-the-proof-${sid}-t${cursor}.replay.json`);
      } catch {
        toast("Export failed — implementation error");
      }
    },
    menu: () => {
      timeline.setAutoplay(false);
      destroy();
      shell.toEntry();
    },
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
    const state = shell.store.current();
    if (
      state.terminal === null &&
      state.strategy !== null &&
      ghost.rejection === null
    ) {
      const prev = threatPreview(state, shell.ctx, quantized);
      threatEl.textContent =
        prev === null ? "" : `Case ${prev.caseId} → ${prev.targetHeadline}`;
    } else if (ghost.rejection !== null) {
      threatEl.textContent = "";
    } else {
      threatEl.textContent = "";
    }
    shell.render();
  };

  const onLeave = (): void => {
    shell.setGhost(null);
    threatEl.textContent = "";
    shell.render();
  };

  // Shared by the click path and the typed path: legality (ghost rejection),
  // [UI] separation, then the engine dispatch. Returns nothing; failures toast.
  const tryPlace = (at: Pt, sx: number, sy: number): boolean => {
    const view = shell.view();
    const state = shell.store.current();
    if (state.terminal !== null || state.strategy === null) {
      return false;
    }
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
      return false;
    }
    for (const p of state.points) {
      if (
        !exceedsSeparation(at, p.pt, view, shell.ctx.config.ui.minSeparationPx)
      ) {
        toast(rejectionText({ reason: "ui-too-close", at }));
        return false;
      }
    }
    dispatch(
      shell.store,
      shell.ctx,
      { kind: "place", owner: "breaker", at },
      toast,
    );
    return shell.store.current() !== state;
  };

  const onClick = (e: MouseEvent): void => {
    const { sx, sy } = local(e);
    const at = screenToWorldQuantized(sx, sy, shell.view());
    tryPlace(at, sx, sy);
  };

  const onTypedPlace = (e: Event): void => {
    e.preventDefault();
    let x: Rat;
    let y: Rat;
    if (/\/\s*[-+]?0+\s*$/.test(xIn.value) || /\/\s*[-+]?0+\s*$/.test(yIn.value)) {
      toast("A denominator must not be zero.");
      return;
    }
    try {
      x = Rat.fromString(xIn.value.trim());
      y = Rat.fromString(yIn.value.trim());
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
    if (tryPlace(pt(x, y), 0, 0)) {
      xIn.value = "";
      yIn.value = "";
      xIn.focus();
    }
  };
  placeEl.addEventListener("submit", onTypedPlace);

  shell.svg.addEventListener("mousemove", onMove);
  shell.svg.addEventListener("mouseleave", onLeave);
  shell.svg.addEventListener("click", onClick);

  const onKey = (e: KeyboardEvent): void => {
    if (!document.contains(shell.svg)) {
      document.removeEventListener("keydown", onKey);
      return;
    }
    if (e.target instanceof HTMLInputElement) {
      return;
    }
    const k = e.key;
    if (k === "r" || k === "R") {
      boot();
    } else if (k === "1" || k === "2" || k === "3" || k === "4" || k === "5") {
      shell.cycleOverlay(Number(k));
    } else if (k === "c" || k === "C") {
      shell.toggleOverlay("casemap");
    } else if (k === "b" || k === "B") {
      toast("Branched here — your next placement starts a variation.");
    } else if (k === "m" || k === "M" || k === "Escape") {
      destroy();
      shell.toEntry();
    }
  };
  document.addEventListener("keydown", onKey);

  function destroy(): void {
    timeline.destroy();
    document.removeEventListener("keydown", onKey);
    shell.svg.removeEventListener("mousemove", onMove);
    shell.svg.removeEventListener("mouseleave", onLeave);
    shell.svg.removeEventListener("click", onClick);
    placeEl.removeEventListener("submit", onTypedPlace);
    placeEl.remove();
    strategyEl.remove();
    whyEl.remove();
    invEl.remove();
    threatEl.remove();
    logEl.remove();
    summaryEl.remove();
    footerEl.remove();
    timelineEl.remove();
    terminalHost.remove();
    shell.setExtraLayer([]);
  }

  shell.setRestart(() => {
    boot();
  });
  boot();
  return { destroy };
}
