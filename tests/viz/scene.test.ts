// @vitest-environment jsdom
// tests/viz/scene.test.ts — descriptor counts per layer, keyed diffing, and
// the DOM applier's key stability (no leaks, no unkeyed churn).
import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { analyzeHoles } from "../../src/geometry/holes.ts";
import { applyScene } from "../../src/ui/app.ts";
import {
  buildScene,
  diffScene,
  layerOrder,
} from "../../src/viz/scene.ts";
import type { SceneDesc } from "../../src/viz/scene.ts";
import { autoFit } from "../../src/viz/projection.ts";
import { sandboxState, withIds } from "../helpers.ts";

function P(x: number, y: number): Pt {
  return pt(Rat.make(BigInt(x)), Rat.make(BigInt(y)));
}

const EMPTY: SceneDesc = { nodes: [] };

describe("buildScene", () => {
  it("emits per-layer counts (window, hull, points, labels)", () => {
    const state = sandboxState([P(0, 0), P(4, 0), P(0, 4)]);
    const holes = analyzeHoles(withIds(state.points.map((p) => p.pt)), 5, {
      budget: 1000000,
    });
    const view = autoFit(
      state.points.map((p) => p.pt),
      800,
      600,
    );
    const scene = buildScene({ state, holes, showHull: true, ghost: null, labels: true }, view);
    const byLayer = new Map<string, number>();
    for (const n of scene.nodes) {
      byLayer.set(n.layer, (byLayer.get(n.layer) ?? 0) + 1);
    }
    expect(byLayer.get("window")).toBe(1);
    expect(byLayer.get("reference")).toBe(1); // hull polyline
    expect(byLayer.get("point")).toBe(3);
    expect(byLayer.get("label")).toBe(3);
    expect(byLayer.get("hole") ?? 0).toBe(0);
  });
});

describe("diffScene + applyScene (keyed, §17.4)", () => {
  const view = autoFit([P(0, 0), P(4, 0), P(0, 4), P(8, 8)], 800, 600);
  const sceneOf = (pts: Pt[]): SceneDesc => {
    const state = sandboxState(pts);
    const holes = analyzeHoles(withIds(pts), 5, { budget: 1000000 });
    return buildScene({ state, holes, showHull: true, ghost: null, labels: true }, view);
  };

  it("mount/update/unmount split on point add/remove", () => {
    const a = sceneOf([P(0, 0), P(4, 0), P(0, 4)]);
    const b = sceneOf([P(0, 0), P(4, 0), P(0, 4), P(8, 8)]);
    const patch = diffScene(a, b);
    expect(patch.mount.map((n) => n.key).sort()).toEqual(
      ["label-p4", "point-p4"].sort(),
    );
    // The fixed view pins existing nodes; only the hull polyline changes.
    expect(patch.update.map((n) => n.key)).toEqual(["hull"]);
    expect(patch.unmount).toEqual([]);
    const back = diffScene(b, a);
    expect([...back.unmount].sort()).toEqual(["label-p4", "point-p4"].sort());
    expect(back.update.map((n) => n.key)).toEqual(["hull"]);
    expect(back.mount).toEqual([]);
  });

  it("applier pins DOM nodes by key (no leaks, stable identity)", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const keys = new Map<string, SVGElement>();
    const a = sceneOf([P(0, 0), P(4, 0), P(0, 4)]);
    applyScene(svg, layerOrder(a.nodes), diffScene(EMPTY, a), keys);
    expect(svg.childElementCount).toBe(a.nodes.length);
    const p1 = keys.get("point-p1");
    expect(p1).toBeInstanceOf(SVGElement);
    const b = sceneOf([P(0, 0), P(4, 0), P(0, 4), P(8, 8)]);
    applyScene(svg, layerOrder(b.nodes), diffScene(a, b), keys);
    expect(svg.childElementCount).toBe(b.nodes.length);
    // Same key → same DOM node (no churn); new keys appended in z-order.
    expect(keys.get("point-p1")).toBe(p1);
    expect(keys.has("point-p4")).toBe(true);
    const c = sceneOf([P(0, 0), P(4, 0)]);
    applyScene(svg, layerOrder(c.nodes), diffScene(b, c), keys);
    expect(svg.childElementCount).toBe(c.nodes.length);
    expect(keys.has("point-p4")).toBe(false);
    expect(keys.get("point-p1")).toBe(p1);
  });
});
