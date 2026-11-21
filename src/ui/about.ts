// ui/about.ts — the About page (Phase 17): citations, figure/data
// credits, the honesty statement, validation scope, and the k-strip
// disambiguation. Pure rendering over explain/about.ts data (the bodies
// are ClaimLint-covered test-side). Reachable from the entry screen;
// Back returns to entry (the store is already clear there).
import { ABOUT_SECTIONS, ABOUT_TITLE } from "../explain/about.ts";
import { focusEntryButton, makeModal } from "./modal.ts";
import type { Shell } from "./app.ts";

export function mountAbout(
  shell: Pick<Shell, "showEntry">,
  panels: HTMLElement,
): void {
  const host = document.createElement("div");
  host.id = "about";
  // v2 restyle: modal prose card (presentation-only wrapper).
  const card = document.createElement("div");
  card.className = "modal-card";
  // Corner close (same tested Back behavior; the mockup's m-close affordance).
  // First child so its sticky float pins top-right beside the title.
  const close = document.createElement("button");
  close.className = "m-close";
  close.setAttribute("aria-label", "Close About");
  close.textContent = "✕";
  close.addEventListener("click", () => {
    host.remove();
    shell.showEntry();
    focusEntryButton("About");
  });
  card.appendChild(close);
  const title = document.createElement("h1");
  title.textContent = ABOUT_TITLE;
  card.appendChild(title);
  for (const section of ABOUT_SECTIONS) {
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
    focusEntryButton("About");
  });
  card.appendChild(back);
  host.appendChild(card);
  panels.appendChild(host);
  makeModal(host, card, title, close, () => {
    host.remove();
    shell.showEntry();
    focusEntryButton("About");
  });
}
