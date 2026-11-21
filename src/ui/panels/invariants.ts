// ui/panels/invariants.ts — Invariants panel: live pass/fail lamps from
// invariantStatuses (engine-owned re-evaluation).
import type { InvariantLamp } from "../../engine/describe.ts";

export function renderInvariants(el: HTMLElement, lamps: InvariantLamp[]): void {
  el.replaceChildren();
  const title = document.createElement("h3");
  title.textContent = "Invariants";
  el.appendChild(title);
  if (lamps.length === 0) {
    const p = document.createElement("p");
    p.textContent = "No invariants at this state.";
    el.appendChild(p);
    return;
  }
  const list = document.createElement("ul");
  for (const lamp of lamps) {
    const li = document.createElement("li");
    const mark = document.createElement("span");
    mark.className = lamp.passed ? "lamp pass" : "lamp fail";
    mark.textContent = lamp.passed ? "✓" : "✗";
    li.append(mark, document.createTextNode(` ${lamp.phase}:${lamp.id} — ${lamp.detail}`));
    list.appendChild(li);
  }
  el.appendChild(list);
}
