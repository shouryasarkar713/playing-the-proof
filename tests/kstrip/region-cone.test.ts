import { describe, expect, it } from "vitest";
import {
  StripRegion,
  coneContains,
  coneSectionTop,
  extendStrip,
  extensionCone,
  interiorsDisjoint,
  isCap,
  isCup,
  isStrip,
  parallel,
  sharedHalfline,
  DOWN,
  frameOf,
  fromFrame,
  toFrame,
} from "../../src/kstrip/index.ts";
import { eqPt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";
import { P, R } from "./helpers.ts";

const CAP3 = [P(0, 0), P(2, 2), P(4, 0)];

describe("StripRegion / isStrip", () => {
  it("classifies exactly: interior / boundary / exterior (unbounded below)", () => {
    const r = StripRegion.make(CAP3);
    if (!r.ok) throw new Error("bad");
    const c = r.region;
    expect(c.classify(P(2, 1))).toBe("interior");
    expect(c.classify(P(2, -1000000))).toBe("interior"); // unbounded: never a box
    expect(c.classify(P(2, 2))).toBe("boundary"); // vertex
    expect(c.classify(P(1, 1))).toBe("boundary"); // on an edge
    expect(c.classify(P(2, 3))).toBe("exterior");
    expect(c.classify(P(0, -5))).toBe("boundary"); // left ray
    expect(c.classify(P(4, -7))).toBe("boundary"); // right ray
    expect(c.classify(P(0, 1))).toBe("exterior"); // above a vertex
    expect(c.classify(P(-1, -5))).toBe("exterior");
    expect(c.classify(P(5, -5))).toBe("exterior");
    expect(c.describe().kind).toBe("polygon-with-rays");
  });

  it("failure codes name the failing predicate", () => {
    const S = [...CAP3, P(2, 1), P(3, 5), P(0, -3), P(10, 10)];
    const code = (pts: ReturnType<typeof P>[], s = S) => {
      const r = isStrip(pts, s);
      return r.ok ? "ok" : r.reason.code;
    };
    expect(code([])).toBe("empty-set");
    expect(code([P(9, 9)])).toBe("vertex-not-in-S");
    expect(code(CAP3)).toBe("interior-point"); // (2,1) inside
    expect(code(CAP3, [...CAP3, P(0, -3)])).toBe("boundary-point");
    expect(code([P(0, 0), P(0, 5)], [P(0, 0), P(0, 5)])).toBe("shared-projection");
    expect(code([P(0, 0), P(0, 0)], [P(0, 0)])).toBe("duplicate-vertex");
    const cup = [P(0, 0), P(2, -2), P(4, 0)];
    expect(code(cup, cup)).toBe("not-cap");
    const col = [P(0, 0), P(1, 1), P(2, 2)];
    expect(code(col, col)).toBe("not-cap"); // collinear: strictness convention
    expect(code(CAP3, CAP3)).toBe("ok");
  });

  it("k=1: the halfline must be free of other points", () => {
    expect(isStrip([P(1, 1)], [P(1, 1), P(1, 5), P(2, -9)]).ok).toBe(true);
    expect(isStrip([P(1, 1)], [P(1, 1), P(1, -5)]).ok).toBe(false);
  });

  it("general direction (tilted, upward) agrees with the frame shear", () => {
    const v = { x: R(1, 3), y: R(-1) };
    const f = frameOf(v);
    const p = P("7/5", "-3/7");
    expect(eqPt(fromFrame(f, toFrame(f, p)), p)).toBe(true);
    const up = frameOf({ x: R(1), y: R(2) });
    expect(eqPt(fromFrame(up, toFrame(up, p)), p)).toBe(true);
    // a point sweeping along v from a vertex stays on the boundary
    const S = [P(0, 0), P(2, 2), P(4, 0)];
    const reg = StripRegion.make(S, v);
    // the sheared image of a cap is not a cap for this v necessarily; but the
    // vertex+t*v ray is boundary whenever the strip is valid
    if (reg.ok) {
      const q = P("1/3", "-1");
      expect(reg.region.classify(q)).not.toBe("exterior");
    }
    // cup is a strip for the UPWARD direction
    const cup = [P(0, 0), P(2, -2), P(4, 0)];
    expect(isStrip(cup, cup, { x: R(0), y: R(1) }).ok).toBe(true);
    expect(isStrip(cup, cup, DOWN).ok).toBe(false);
  });

  it("caps and cups (Definition 1)", () => {
    expect(isCap(CAP3)).toBe(true);
    expect(isCup(CAP3)).toBe(false);
    expect(isCup([P(0, 0), P(1, -1), P(2, 0)])).toBe(true);
    expect(isCap([P(0, 0), P(0, 1), P(2, 0)])).toBe(false); // equal x
  });

  it("parallel / interior-disjoint / shared halfline", () => {
    const a = StripRegion.make([P(0, 0), P(1, 1)]);
    const b = StripRegion.make([P(3, 0), P(4, 1)]);
    const c = StripRegion.make([P(1, 1), P(2, 0)]);
    const d = StripRegion.make([P(0, 5), P(2, 4)]);
    if (!a.ok || !b.ok || !c.ok || !d.ok) throw new Error("bad");
    expect(parallel(a.region, b.region).ok).toBe(true);
    expect(parallel(a.region, c.region).ok).toBe(false); // share the halfline below (1,1)
    expect(interiorsDisjoint(a.region, c.region)).toBe(true);
    expect(sharedHalfline(a.region, c.region)).not.toBeNull();
    expect(sharedHalfline(a.region, b.region)).toBeNull();
    expect(parallel(a.region, d.region).ok).toBe(false);
    expect(interiorsDisjoint(a.region, d.region)).toBe(false);
    const tilted = StripRegion.make([P(10, 0), P(11, 1)], { x: R(1), y: R(-1) });
    if (!tilted.ok) throw new Error("bad");
    expect(parallel(a.region, tilted.region).ok).toBe(false); // different v
  });
});

describe("extension cones", () => {
  // P = (0,0),(2,2),(4,2)?  use a clean cap: L+ is y = 2 (horizontal)
  const strip = [P(0, 0), P(2, 2), P(4, 2)];

  it("C+ boundary: edge-line point is degenerate, just below ok, above rejected", () => {
    const S = strip;
    expect(extendStrip(strip, S, P(6, 1)).ok).toBe(true);
    const onLine = extendStrip(strip, S, P(6, 2));
    expect(onLine.ok).toBe(false);
    if (!onLine.ok) expect(onLine.reason.code).toBe("degenerate");
    const above = extendStrip(strip, S, P(6, 3));
    expect(above.ok).toBe(false);
    if (!above.ok) expect(above.reason.code).toBe("above-edge-line");
    const cone = extensionCone(strip, S, DOWN, "plus");
    if (!cone.ok) throw new Error("bad");
    expect(cone.cone.stop.kind).toBe("edge-line");
    expect(coneContains(cone.cone, P(6, 2))).toBe(true);
    expect(coneContains(cone.cone, P(6, 2), "open")).toBe(false);
    expect(coneContains(cone.cone, P(4, -5))).toBe(true); // vertical side closed
    expect(coneContains(cone.cone, P(4, -5), "open")).toBe(false);
    expect(coneContains(cone.cone, P(3, -5))).toBe(false);
  });

  it("C+ blocked by a point q: stopping ray through q, exact section", () => {
    const q = P(5, -1);
    const S = [...strip, q];
    const cr = extensionCone(strip, S, DOWN, "plus");
    if (!cr.ok) throw new Error("bad");
    expect(cr.cone.stop.kind).toBe("blocked");
    if (cr.cone.stop.kind === "blocked") expect(eqPt(cr.cone.stop.blocker, q)).toBe(true);
    // ray from (4,2) through (5,-1): slope -3; section at x=6: 2 - 6 = -4
    expect(coneSectionTop(cr.cone, R(6)).equals(R(-4))).toBe(true);
    const blocked = extendStrip(strip, S, P(6, 0));
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.reason.code).toBe("cone-blocked");
      expect(blocked.reason.blocker !== undefined && eqPt(blocked.reason.blocker, q)).toBe(true);
      expect(blocked.reason.stillStrip).toBe(false); // q really lies under the segment
    }
    expect(extendStrip(strip, S, P(6, -5)).ok).toBe(true);
    // the blocker itself extends the strip
    expect(extendStrip(strip, S, q).ok).toBe(true);
  });

  it("a blocker FARTHER than p does not obstruct p (cone is sufficient, not necessary)", () => {
    const S = [...strip, P(9, -30)]; // steep far point: blocks the cone for x>...
    const r = extendStrip(strip, S, P(6, 1));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason.code).toBe("cone-blocked");
      expect(r.reason.stillStrip).toBe(true);
    }
  });

  it("C- is symmetric (clockwise) with L- through s1,s2", () => {
    // L- : y = x ; cone {x <= 0, y <= x}
    const S = strip;
    expect(extendStrip(strip, S, P(-2, -3)).ok).toBe(true);
    const above = extendStrip(strip, S, P(-2, -1));
    expect(above.ok).toBe(false);
    if (!above.ok) expect(above.reason.code).toBe("above-edge-line");
    const q = P(-3, -5); // slope 5/3 > 1: steeper than L-, so it blocks
    const cr = extensionCone(strip, [...S, q], DOWN, "minus");
    if (!cr.ok) throw new Error("bad");
    expect(cr.cone.stop.kind).toBe("blocked");
    const r = extendStrip(strip, [...S, q], P(-6, -12));
    expect(r.ok).toBe(true); // below the ray y = (5/3)x (= -10 at x=-6)
    const r2 = extendStrip(strip, [...S, q], P(-6, -8));
    expect(!r2.ok && r2.reason.code).toBe("cone-blocked");
  });

  it("typed reasons: wrong side, p in P, not a strip, k=1 convention", () => {
    const S = strip;
    const w = extendStrip(strip, S, P(3, -9));
    expect(!w.ok && w.reason.code).toBe("p-wrong-side");
    const i = extendStrip(strip, S, P(2, 2));
    expect(!i.ok && i.reason.code).toBe("p-in-P");
    const bad = extendStrip(strip, [...S, P(1, 0)], P(6, 1));
    expect(!bad.ok && bad.reason.code).toBe("not-a-strip");
    // k = 1: horizontal limiting ray (implemented convention)
    const one = [P(0, 0)];
    expect(extendStrip(one, one, P(5, -1)).ok).toBe(true);
    const up = extendStrip(one, one, P(5, 1));
    expect(!up.ok && up.reason.code).toBe("above-edge-line");
    const c1 = extensionCone(one, one, DOWN, "plus");
    expect(c1.ok && c1.cone.stop.kind).toBe("horizontal-convention");
  });

  it("every positive answer is re-verified: new strip passes Definition 2", () => {
    const S = [...strip, P(5, -1)];
    const r = extendStrip(strip, S, P(6, -5));
    if (!r.ok) throw new Error("bad");
    expect(isStrip(r.vertices, [...S, P(6, -5)]).ok).toBe(true);
    expect(r.vertices.length).toBe(4);
    expect(Rat.ONE.equals(Rat.ONE)).toBe(true);
  });
});
