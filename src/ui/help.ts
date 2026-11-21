// ui/help.ts — the Help page (Phase 19): rules, modes, legend, keyboard.
// Pure rendering over explain/help.ts data (bodies are ClaimLint-covered
// and golden-pinned test-side). Reachable from the entry screen; Back
// returns to entry (the store is already clear there).
import { HELP_SECTIONS, HELP_TITLE } from "../explain/help.ts";
import { focusEntryButton, makeModal } from "./modal.ts";
import type { Shell } from "./app.ts";

export function mountHelp(
  shell: Pick<Shell, "showEntry">,
  panels: HTMLElement,
): void {
  const host = document.createElement("div");
  host.id = "help";
  // v2 restyle: modal prose card (presentation-only wrapper).
  const card = document.createElement("div");
  card.className = "modal-card";
  // Corner close (same tested Back behavior; the mockup's m-close affordance).
  // First child so its sticky float pins top-right beside the title.
  const close = document.createElement("button");
  close.className = "m-close";
  close.setAttribute("aria-label", "Close Help");
  close.textContent = "✕";
  close.addEventListener("click", () => {
    host.remove();
    shell.showEntry();
    focusEntryButton("Help");
  });
  card.appendChild(close);
  const title = document.createElement("h1");
  title.textContent = HELP_TITLE;
  card.appendChild(title);
  for (const section of HELP_SECTIONS) {
    const h = document.createElement("h2");
    h.textContent = section.heading;
    card.appendChild(h);
    for (const para of section.body) {
      const p = document.createElement("p");
      p.textContent = para;
      card.appendChild(p);
    }
  }
  const back = document.createElement("button");
  back.textContent = "Back";
  back.addEventListener("click", () => {
    host.remove();
    shell.showEntry();
    focusEntryButton("Help");
  });
  card.appendChild(back);
  host.appendChild(card);
  panels.appendChild(host);
  makeModal(host, card, title, close, () => {
    host.remove();
    shell.showEntry();
    focusEntryButton("Help");
  });
}
