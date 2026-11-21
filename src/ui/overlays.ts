// ui/overlays.ts — draws the strategy's declared region overlays (forced
// region, ears, hulls, the pre-B1 twins) and tints the case map per case
// (spec §11.3/§11.6/§17.2 — `node.show` was never drawn in guided
// modes). Presentation only; geometry comes from engine/describe.ts.
import { guidedOverlays } from "../engine/describe.ts";
import type { RuntimeCtx } from "../engine/orchestrator.ts";
import type { GameState } from "../game/types.ts";
import type { Pt } from "../geometry/pt.ts";
import { node } from "../viz/shapes.ts";
import { roundHalf, worldToScreen } from "../viz/projection.ts";
import type { View } from "../viz/projection.ts";
import type { SceneNode } from "../viz/scene.ts";

// Attribute fallbacks only: CSS classes (viz-ov-*) override with theme tokens.
const FALLBACK: Record<string, string> = {
  forced: "#A87E00",
  candidate: "#C5392B",
  protected: "#7A58A8",
  verify: "#1F7A4C",
  structure: "#6E6552",
  neutral: "#6E6552",
  illegal: "#A62B1E",
  twin: "#1F7A4C",
};

function pts(poly: readonly Pt[], view: View): string {
  return poly
    .map((q) => {
      const s = worldToScreen(q, view);
      return `${roundHalf(s.x)},${roundHalf(s.y)}`;
    })
    .join(" ");
}

export function regionOverlayNodes(
  state: GameState,
  ctx: RuntimeCtx,
  view: View,
): SceneNode[] {
  const out: SceneNode[] = [];
  const list = guidedOverlays(state, ctx) ?? [];
  let i = 0;
  for (const ov of list) {
    for (const poly of ov.polys) {
      const base = FALLBACK[ov.style] ?? "#6E6552";
      const n = node(`ov-${i}`, "region", "polygon", {
        class: `viz-ov viz-ov-${ov.style}`,
        points: pts(poly, view),
        fill: base,
        opacity: ov.style === "neutral" ? "0.05" : "0.14",
        stroke: base,
        "stroke-width": ov.style === "twin" ? "2" : "1",
        ...(ov.style === "twin" ? { "stroke-dasharray": "5 3" } : {}),
      });
      out.push(n);
      i += 1;
    }
  }
  return out;
}

// Case-map cell tint: one hue per case group (cycled), so cells of the same
// case read as one region.
const CASE_FILL = ["#C05621", "#2B5F8A", "#1F7A4C", "#7A58A8", "#A87E00"];
export function caseFill(groupIndex: number): { cls: string; fill: string } {
  const k = groupIndex % CASE_FILL.length;
  return { cls: `viz-casemap viz-case-${k}`, fill: CASE_FILL[k] as string };
}
