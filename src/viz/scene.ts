// viz/scene.ts — pure scene descriptions + keyed diffing (§17.4).
//
// DOM-FREE by architecture (§31.2): this module produces descriptor data
// only ({key, layer, kind, attrs}); ui/app.ts materializes patches into the
// real SVG. Stable keys (`point-p7`, `hull`, `hole-0`, …) keep nodes pinned
// across frames — no unkeyed churn.
import type { Pt } from "../geometry/pt.ts";
import { pt } from "../geometry/pt.ts";
import { Rat } from "../geometry/rat.ts";
import { hull } from "../geometry/hull.ts";
import type { HoleAnalysis } from "../geometry/holes.ts";
import type { GameState, PlacedPoint, Rejection } from "../game/types.ts";
import type { LayerName } from "./layers.ts";
import { LAYERS } from "./layers.ts";
import { PALETTE } from "./palette.ts";
import { roundHalf, worldToScreen } from "./projection.ts";
import type { View } from "./projection.ts";
import { node } from "./shapes.ts";

export type ShapeKind =
  | "rect"
  | "circle"
  | "diamond"
  | "polygon"
  | "polyline"
  | "path"
  | "line"
  | "text";

export interface SceneNode {
  readonly key: string;
  readonly layer: LayerName;
  readonly kind: ShapeKind;
  readonly attrs: Readonly<Record<string, string>>;
  readonly text?: string;
}

export interface SceneDesc {
  readonly nodes: readonly SceneNode[];
}

export interface GhostSpec {
  readonly at: Pt;
  readonly rejection: Rejection | null;
}

export interface SceneInput {
  readonly state: GameState;
  readonly holes: HoleAnalysis;
  readonly showHull: boolean;
  readonly ghost: GhostSpec | null;
  readonly labels: boolean;
}

function pointsAttr(pts: readonly Pt[], view: View): string {
  return pts
    .map((p) => {
      const s = worldToScreen(p, view);
      return `${roundHalf(s.x)},${roundHalf(s.y)}`;
    })
    .join(" ");
}

function idToPt(state: GameState, id: string): Pt | null {
  for (const p of state.points) {
    if (p.id === id) {
      return p.pt;
    }
  }
  return null;
}

function holePolys(state: GameState, holes: HoleAnalysis): Pt[][] {
  const lists: ReadonlyArray<readonly string[]> =
    holes.kind === "exhaustive"
      ? holes.holes.map((h) => h.verts)
      : holes.kind === "witness-only"
        ? [holes.witness.verts]
        : [];
  const out: Pt[][] = [];
  for (const verts of lists) {
    const pts: Pt[] = [];
    let ok = true;
    for (const id of verts) {
      const p = idToPt(state, id);
      if (p === null) {
        ok = false;
        break;
      }
      pts.push(p);
    }
    if (ok) {
      out.push(pts);
    }
  }
  return out;
}

function pointNode(p: PlacedPoint, view: View): SceneNode {
  const s = worldToScreen(p.pt, view);
  const key = `point-${p.id}`;
  if (p.owner === "maker") {
    return node(key, "point", "circle", {
      class: "pt pt-maker",
      cx: String(s.x),
      cy: String(s.y),
      r: "6",
      fill: PALETTE.maker,
      stroke: "#ffffff",
      "stroke-width": "1.5",
    });
  }
  // Breaker diamond as a polygon quad (exact Rat offsets — no px math here).
  const h = Rat.make(11n).div(Rat.make(2n)).div(view.s);
  const cx = p.pt.x;
  const cy = p.pt.y;
  return node(key, "point", "polygon", {
    class: "pt pt-breaker",
    points: pointsAttr(
      [
        pt(cx, cy.sub(h)),
        pt(cx.add(h), cy),
        pt(cx, cy.add(h)),
        pt(cx.sub(h), cy),
      ],
      view,
    ),
    fill: PALETTE.breaker,
    stroke: "#ffffff",
    "stroke-width": "1.5",
  });
}

export function buildScene(input: SceneInput, view: View): SceneDesc {
  const { state } = input;
  const nodes: SceneNode[] = [];
  nodes.push(
    node("window", "window", "rect", {
      class: "viz-window",
      x: "0",
      y: "0",
      width: String(view.w),
      height: String(view.h),
      fill: PALETTE.paper,
    }),
  );
  if (input.showHull && state.points.length >= 3) {
    const h = hull(state.points.map((p) => p.pt));
    if (h.length >= 3) {
      nodes.push(
        node("hull", "reference", "polyline", {
          class: "viz-hull",
          points: pointsAttr([...h, h[0] as Pt], view),
          fill: "none",
          stroke: PALETTE.structure,
          "stroke-width": "1.5",
        }),
      );
    }
  }
  const polys = holePolys(state, input.holes);
  polys.forEach((verts, i) => {
    nodes.push(
      node(`hole-${i}`, "hole", "polygon", {
        class: i === 0 ? "viz-hole primary" : "viz-hole",
        points: pointsAttr(verts, view),
        fill: "none",
        stroke: PALETTE.verify,
        "stroke-width": i === 0 ? "2.5" : "1",
        opacity: i === 0 ? "1" : "0.35",
      }),
    );
  });
  for (const p of state.points) {
    nodes.push(pointNode(p, view));
    if (input.labels) {
      // Label anchor: exact world offset (+9px screen-right, −7px screen-up
      // = +7/s world) projected exactly.
      const anchor = pt(
        p.pt.x.add(Rat.make(9n).div(view.s)),
        p.pt.y.add(Rat.make(7n).div(view.s)),
      );
      const s = worldToScreen(anchor, view);
      nodes.push(
        node(
          `label-${p.id}`,
          "label",
          "text",
          {
            class: "viz-label",
            x: String(s.x),
            y: String(s.y),
            fill: PALETTE.structure,
            "font-size": "11",
          },
          p.id,
        ),
      );
    }
  }
  if (input.ghost !== null) {
    const s = worldToScreen(input.ghost.at, view);
    const legal = input.ghost.rejection === null;
    nodes.push(
      node("ghost", "ghost", "circle", {
        class: legal ? "viz-ghost legal" : "viz-ghost illegal",
        cx: String(s.x),
        cy: String(s.y),
        r: "6",
        fill: legal ? PALETTE.maker : PALETTE.illegal,
        opacity: "0.55",
      }),
    );
    if (!legal) {
      const anchor = pt(
        input.ghost.at.x.add(Rat.make(10n).div(view.s)),
        input.ghost.at.y.sub(Rat.make(4n).div(view.s)),
      );
      const rs = worldToScreen(anchor, view);
      nodes.push(
        node(
          "ghost-reason",
          "ghost",
          "text",
          {
            class: "viz-ghost-reason",
            x: String(rs.x),
            y: String(rs.y),
            fill: PALETTE.illegal,
            "font-size": "11",
          },
          input.ghost.rejection?.reason ?? "illegal",
        ),
      );
    }
  }
  return { nodes };
}

export interface ScenePatch {
  readonly mount: readonly SceneNode[];
  readonly update: readonly SceneNode[];
  readonly unmount: readonly string[];
}

// diffScene (§17.4): keyed reconciliation — stable keys pin DOM nodes.
export function diffScene(prev: SceneDesc, next: SceneDesc): ScenePatch {
  const before = new Map(prev.nodes.map((n) => [n.key, n]));
  const after = new Map(next.nodes.map((n) => [n.key, n]));
  const mount: SceneNode[] = [];
  const update: SceneNode[] = [];
  const unmount: string[] = [];
  for (const n of next.nodes) {
    const old = before.get(n.key);
    if (old === undefined) {
      mount.push(n);
    } else if (
      old.layer !== n.layer ||
      old.kind !== n.kind ||
      old.text !== n.text ||
      JSON.stringify(old.attrs) !== JSON.stringify(n.attrs)
    ) {
      update.push(n);
    }
  }
  for (const n of prev.nodes) {
    if (!after.has(n.key)) {
      unmount.push(n.key);
    }
  }
  return { mount, update, unmount };
}

export function layerOrder(nodes: readonly SceneNode[]): SceneNode[] {
  const rank = new Map(LAYERS.map((name, i) => [name, i]));
  return [...nodes].sort(
    (a, b) => (rank.get(a.layer) as number) - (rank.get(b.layer) as number),
  );
}
