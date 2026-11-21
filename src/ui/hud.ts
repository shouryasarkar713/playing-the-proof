// ui/hud.ts — the dev HUD (§10.7, Phase 19): mounted only when the URL
// query contains "debug" (e.g. `npm run dev -- --open --url "?debug"` or
// by appending ?debug). Shows mode, node, point count, state hash, last
// render milliseconds, and max coordinate bit-length (§29 profiling
// hooks). Read-only diagnostics; never drives the session.
export interface HudStats {
  mode: string;
  node: string;
  points: number;
  hash: string;
  renderMs: number;
  maxBits: number;
}

export function hudEnabled(search: string): boolean {
  return search.includes("debug");
}

export function formatHud(stats: HudStats): string {
  return (
    `mode ${stats.mode} · node ${stats.node} · ` +
    `${stats.points} pts · hash ${stats.hash} · ` +
    `${stats.renderMs.toFixed(1)} ms/frame · max ${stats.maxBits} bits`
  );
}

export function mountHud(
  panels: HTMLElement,
  read: () => HudStats,
): { update(): void; element: HTMLElement } {
  const el = document.createElement("div");
  el.id = "hud";
  panels.appendChild(el);
  return {
    element: el,
    update(): void {
      if (!document.contains(el)) {
        return;
      }
      el.textContent = formatHud(read());
    },
  };
}
