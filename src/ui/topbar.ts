// ui/topbar.ts — minimal chrome: title, mode label, strategy badge text.
export function mountTopbar(
  el: HTMLElement,
  opts: { mode: string; strategy: string; status: string | null },
): void {
  el.replaceChildren();
  const title = document.createElement("span");
  title.className = "app-title";
  title.textContent = "Playing the Proof";
  el.appendChild(title);
  const mode = document.createElement("span");
  mode.className = "mode-label";
  mode.textContent = opts.mode;
  el.appendChild(mode);
  const strat = document.createElement("span");
  strat.className = "strategy-label";
  strat.textContent = opts.strategy;
  el.appendChild(strat);
  if (opts.status !== null) {
    const badge = document.createElement("span");
    badge.className = "status-badge";
    badge.textContent = opts.status;
    el.appendChild(badge);
  }
}
