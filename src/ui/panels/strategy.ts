// ui/panels/strategy.ts — Strategy panel: node/round/case, status badge
// (via engine statusBadge — Gate E; ui/ never touches strategy/).
import type { StatusBadge } from "../../engine/describe.ts";
import type { SessionStats } from "../../engine/describe.ts";
import type { GameState } from "../../game/types.ts";

export function renderStrategy(
  el: HTMLElement,
  state: GameState,
  stats: SessionStats,
  badge: StatusBadge | null,
): void {
  el.replaceChildren();
  const title = document.createElement("h3");
  title.textContent = "Strategy";
  el.appendChild(title);
  if (state.strategy === null) {
    const p = document.createElement("p");
    p.textContent = `Sandbox · k=${state.k} · ${stats.points} points`;
    el.appendChild(p);
    return;
  }
  const node = document.createElement("p");
  node.textContent = `Node ${state.strategy.nodeId} · round ${stats.round} · move ${stats.move} · turn ${state.turn}`;
  el.appendChild(node);
  if (state.strategy.lastCase !== null) {
    const c = document.createElement("p");
    c.textContent = `Case ${state.strategy.lastCase}`;
    el.appendChild(c);
  }
  if (badge !== null) {
    const badgeEl = document.createElement("p");
    badgeEl.className = "status-badge";
    badgeEl.textContent = badge.text;
    badgeEl.title = badge.title;
    el.appendChild(badgeEl);
  }
}
