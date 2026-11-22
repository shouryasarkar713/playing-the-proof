// ui/modes/proof.ts — Proof mode: guided stepping with per-case sample
// chips (sample replies from engine caseData) + free Breaker stepping,
// strategy/why/invariants panels, win card, keyboard map.
import { startSession } from "../../session/commit.ts";
import {
  branchInteractions,
  caseData,
  invariantStatuses,
  nodeExplanation,
  sessionStats,
  statusBadge,
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
import { branchLabel, renderBranches } from "../panels/branches.ts";
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
import type { Pt } from "../../geometry/pt.ts";
import type { GameState, StrategyStart } from "../../game/types.ts";
import type { ModeHandle, Shell } from "../app.ts";
import type { SceneNode } from "../../viz/scene.ts";

function pointsAttr(pts: readonly Pt[], view: View): string {
  return pts
    .map((p) => {
      const s = worldToScreen(p, view);
      return `${roundHalf(s.x)},${roundHalf(s.y)}`;
    })
    .join(" ");
}

export function mountProof(
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
  const branchEl = document.createElement("section");
  branchEl.id = "panel-branches";
  const sampleRow = document.createElement("div");
  sampleRow.id = "sample-row";
  const timelineEl = document.createElement("div");
  timelineEl.id = "timeline";
  const cardHost = document.createElement("div");
  cardHost.id = "win-card-host";
  panels.append(strategyEl, branchEl, whyEl, invEl, sampleRow, timelineEl, cardHost);

  const paintPanels = (state: GameState): void => {
    const stats = sessionStats(state);
    renderStrategy(strategyEl, state, stats, statusBadge(state, shell.ctx));
    const branches = branchInteractions(state, shell.ctx);
    renderBranches(branchEl, branches);
    renderWhy(whyEl, nodeExplanation(state, shell.ctx));
    renderInvariants(invEl, invariantStatuses(state, shell.ctx));
    paintSamples(state);
    paintCard(state);
  };

  const paintSamples = (state: GameState): void => {
    sampleRow.replaceChildren();
    if (state.terminal !== null || state.strategy === null) {
      return;
    }
    const data = caseData(state, shell.ctx);
    if (data === null) {
      return;
    }
    if (!data.cells.available) {
      const p = document.createElement("p");
      p.className = "samples-unavailable";
      p.textContent =
        data.cells.reason === "boundaries-unavailable"
          ? `Samples unavailable — boundary computation budget-exhausted; not 'no cases exist' (${data.cells.detail})`
          : `Samples unavailable (${data.cells.reason}) — step freely.`;
      sampleRow.appendChild(p);
      return;
    }
    const nextBtn = document.createElement("button");
    nextBtn.textContent = "⟳ Next";
    nextBtn.title = "Play the first case's sample reply";
    nextBtn.addEventListener("click", () => playSample(0));
    sampleRow.appendChild(nextBtn);
    data.samples.forEach((sample, i) => {
      const btn = document.createElement("button");
      const caseId = data.cases[i] as string;
      const klass = branchLabel(
        branchInteractions(state, shell.ctx)?.find((b) => b.caseId === caseId)
          ?.interaction ?? null,
      );
      const suffix = klass === null ? "" : ` (${klass})`;
      btn.textContent =
        sample === null
          ? `${caseId} (no point)${suffix}`
          : `Play ${caseId}${suffix}`;
      if (klass !== null) {
        btn.setAttribute("aria-label", `Play ${caseId}, ${klass}`);
      }
      btn.disabled = sample === null;
      btn.addEventListener("click", () => playSample(i));
      sampleRow.appendChild(btn);
    });
  };

  const playSample = (index: number): void => {
    const state = shell.store.current();
    if (state.terminal !== null || state.strategy === null) {
      return;
    }
    const data = caseData(state, shell.ctx);
    if (data === null || !data.cells.available) {
      // QA D4: never keep an autoplay timer toasting forever.
      timeline.setAutoplay(false);
      toast("No sample available — autoplay stopped; step freely.");
      return;
    }
    const sample = data.samples[index];
    if (sample === undefined || sample === null) {
      timeline.setAutoplay(false);
      toast("No representative available for that case — autoplay stopped; step freely.");
      return;
    }
    dispatch(
      shell.store,
      shell.ctx,
      { kind: "sample", caseId: sample.caseId, at: sample.at },
      toast,
    );
  };

  const paintCard = (state: GameState): void => {
    cardHost.replaceChildren();
    const card = winCard(state);
    if (card === null) {
      return;
    }
    const box = document.createElement("div");
    box.className = "win-card";
    const head = document.createElement("h3");
    head.textContent = card.title;
    box.appendChild(head);
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
    const again = document.createElement("button");
    again.textContent = "Play again";
    again.addEventListener("click", () => boot());
    box.appendChild(again);
    if (state.k === 5) {
      const grow = document.createElement("button");
      grow.textContent = "Grow to 6";
      const blocked = growToSixBlock(state);
      grow.title =
        blocked ?? "Continue this won k=5 session into the k=6 phase.";
      grow.disabled = blocked !== null;
      grow.addEventListener("click", () => growToSix(shell, toast, "proof"));
      box.appendChild(grow);
      if (blocked !== null) {
        const why = document.createElement("p");
        why.className = "honesty";
        why.textContent = blocked;
        box.appendChild(why);
      }
    }
    if (state.k === 6) {
      const grow = document.createElement("button");
      grow.textContent = "Grow to 7";
      const blocked = growToSevenBlock(state);
      grow.title =
        blocked ?? "Continue this won k=6 session into the k=7 phase.";
      grow.disabled = blocked !== null;
      grow.addEventListener("click", () => growToSeven(shell, toast, "proof"));
      box.appendChild(grow);
      if (blocked !== null) {
        const why = document.createElement("p");
        why.className = "honesty";
        why.textContent = blocked;
        box.appendChild(why);
      }
    }
    cardHost.appendChild(box);
  };

  // Case-map overlay nodes for the shell's extra layer.
  const caseLayer = (): SceneNode[] => {
    const state = shell.store.current();
    if (state.terminal !== null || state.strategy === null) {
      return [];
    }
    const data = caseData(state, shell.ctx);
    if (data === null || !data.cells.available) {
      return [];
    }
    const view = shell.view();
    const out: SceneNode[] = [];
    let ci = 0;
    let gi = 0;
    for (const group of data.cells.groups) {
      const tint = caseFill(gi);
      gi += 1;
      for (const cell of group.cells) {
        out.push(
          node(`case-${ci}`, "casemap", "polygon", {
            class: tint.cls,
            points: pointsAttr(cell.poly, view),
            fill: tint.fill,
            opacity: "0.12",
            stroke: "#2B5F8A",
            "stroke-width": "1",
          }),
        );
        ci += 1;
      }
    }
    return out;
  };

  shell.onRender((state) => {
    paintPanels(state);
    const layer: SceneNode[] = [];
    if (shell.overlays().regions) {
      layer.push(...regionOverlayNodes(state, shell.ctx, shell.view()));
    }
    if (shell.overlays().casemap) {
      layer.push(...caseLayer());
    }
    shell.setExtraLayer(layer);
  });

  const timeline: TimelineHandle = mountTimeline(shell, timelineEl, {
    autoplayMs: shell.ctx.config.ui.autoplayMs,
    toast,
    onSampleStep: () => playSample(0),
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
    if (state.terminal !== null || state.strategy === null) {
      return;
    }
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
    dispatch(
      shell.store,
      shell.ctx,
      { kind: "place", owner: "breaker", at },
      toast,
    );
  };

  shell.svg.addEventListener("mousemove", onMove);
  shell.svg.addEventListener("mouseleave", onLeave);
  shell.svg.addEventListener("click", onClick);

  const onKey = (e: KeyboardEvent): void => {
    if (!document.contains(shell.svg)) {
      // Detached (test teardown without destroy) — self-remove.
      document.removeEventListener("keydown", onKey);
      return;
    }
    if (e.target instanceof HTMLInputElement) {
      return;
    }
    const k = e.key;
    // QA D5: Space on a focused button/link/select activates THAT control
    // (native behaviour); the global autoplay toggle only fires elsewhere.
    if (
      k === " " &&
      (e.target instanceof HTMLButtonElement ||
        e.target instanceof HTMLAnchorElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement)
    ) {
      return;
    }
    if (k === " ") {
      e.preventDefault();
      timeline.setAutoplay(!timeline.isAutoplay());
    } else if (k === "r" || k === "R") {
      boot();
    } else if (k === "1" || k === "2" || k === "3" || k === "4" || k === "5") {
      shell.cycleOverlay(Number(k));
    } else if (k === "c" || k === "C") {
      shell.toggleOverlay("casemap");
    } else if (k === "b" || k === "B") {
      toast("Branched here — your next placement starts a variation.");
    } else if (k === "m" || k === "M" || k === "Escape") {
      timeline.setAutoplay(false);
      destroy();
      shell.toEntry();
    }
  };
  document.addEventListener("keydown", onKey);

  function destroy(): void {
    timeline.setAutoplay(false);
    timeline.destroy();
    document.removeEventListener("keydown", onKey);
    shell.svg.removeEventListener("mousemove", onMove);
    shell.svg.removeEventListener("mouseleave", onLeave);
    shell.svg.removeEventListener("click", onClick);
    strategyEl.remove();
    whyEl.remove();
    invEl.remove();
    sampleRow.remove();
    timelineEl.remove();
    cardHost.remove();
    shell.setExtraLayer([]);
  }

  shell.setRestart(() => {
    boot();
  });
  boot();
  return { destroy };
}
