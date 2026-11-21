// viz/layers.ts — paint order per §17.2 (z). The case map (z 5) renders
// above holes but below points; points (6) with labels (7); ghosts (8) live.
export const LAYERS = [
  "window",
  "region",
  "strip",
  "reference",
  "hole",
  "casemap",
  "point",
  "label",
  "ghost",
] as const;

export type LayerName = (typeof LAYERS)[number];

export const LAYER_Z: Record<LayerName, number> = {
  window: 0,
  region: 1,
  strip: 2,
  reference: 3,
  hole: 4,
  casemap: 5,
  point: 6,
  label: 7,
  ghost: 8,
};
