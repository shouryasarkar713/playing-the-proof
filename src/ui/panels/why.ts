// ui/panels/why.ts — the "Why does this move work?" panel (§13): headline
// (ARIA live), tier-chipped claims, threats, invariant notes, source ref.
import type { NodeExplanation } from "../../engine/describe.ts";

const TIER_LABEL: Record<string, string> = {
  "verified-geometry": "geometry",
  "strategy-rule": "strategy",
  "theorem-cited": "theorem",
  observed: "observed",
  uncovered: "uncovered",
};

export function renderWhy(el: HTMLElement, explanation: NodeExplanation | null): void {
  el.replaceChildren();
  el.setAttribute("aria-live", "polite");
  if (explanation === null) {
    const p = document.createElement("p");
    p.textContent = "No strategy active (sandbox).";
    el.appendChild(p);
    return;
  }
  const head = document.createElement("h3");
  head.textContent = explanation.headline;
  el.appendChild(head);
  const list = document.createElement("ul");
  for (const claim of explanation.claims) {
    const li = document.createElement("li");
    const chip = document.createElement("span");
    chip.className = `tier tier-${claim.tier}`;
    chip.textContent = TIER_LABEL[claim.tier] ?? claim.tier;
    li.append(chip, document.createTextNode(` ${claim.text}`));
    if (claim.ref !== undefined) {
      const ref = document.createElement("span");
      ref.className = "ref";
      ref.textContent = ` [${claim.ref}]`;
      li.appendChild(ref);
    }
    list.appendChild(li);
  }
  el.appendChild(list);
  if (explanation.evidence.length > 0) {
    const h = document.createElement("h4");
    h.textContent = "Evidence";
    el.appendChild(h);
    const ev = document.createElement("ul");
    for (const item of explanation.evidence) {
      const li = document.createElement("li");
      li.textContent = `${item.predicate}(${item.operands}) → ${item.result}`;
      ev.appendChild(li);
    }
    el.appendChild(ev);
  }
  if (explanation.threats.length > 0) {
    const h = document.createElement("h4");
    h.textContent = "Threats addressed";
    el.appendChild(h);
    const threats = document.createElement("ul");
    for (const claim of explanation.threats) {
      const li = document.createElement("li");
      li.textContent = `[${TIER_LABEL[claim.tier] ?? claim.tier}] ${claim.text}`;
      threats.appendChild(li);
    }
    el.appendChild(threats);
  }
  if (explanation.invariantNotes.length > 0) {
    const h = document.createElement("h4");
    h.textContent = "Invariants";
    el.appendChild(h);
    const notes = document.createElement("ul");
    for (const note of explanation.invariantNotes) {
      const li = document.createElement("li");
      li.textContent = `[${TIER_LABEL[note.tier] ?? note.tier}] ${note.text}`;
      notes.appendChild(li);
    }
    el.appendChild(notes);
  }
  const src = document.createElement("p");
  src.className = "source-ref";
  src.textContent = `Source: ${explanation.sourceRef} · node ${explanation.nodeId}`;
  el.appendChild(src);
}
