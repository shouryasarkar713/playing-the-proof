// viz/shapes.ts — SceneNode descriptor factories (pure data, no DOM).
// Keeps scene.ts declarative; the DOM materialization lives in ui/app.ts.
import type { LayerName } from "./layers.ts";
import type { SceneNode, ShapeKind } from "./scene.ts";

export function node(
  key: string,
  layer: LayerName,
  kind: ShapeKind,
  attrs: Readonly<Record<string, string>>,
  text?: string,
): SceneNode {
  return text === undefined
    ? { key, layer, kind, attrs }
    : { key, layer, kind, attrs, text };
}
