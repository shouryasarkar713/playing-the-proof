import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import {
  conePolygon,
  dirToScreen,
  fitAniso,
  fromScreenAniso,
  halflineEnd,
  pointsAttr,
  regionPolygon,
  toScreenAniso,
} from "../../src/viz/aniso.ts";

const P = (x: number, y: number) => pt(Rat.make(BigInt(x)), Rat.make(BigInt(y)));

describe("anisotropic view", () => {
  const pts = [P(0, 0), P(100, 10000), P(50, 2500)];
  const v = fitAniso(pts, 800, 600, 28);

  it("fits both axes independently into the padded viewport", () => {
    const a = toScreenAniso(P(0, 0), v);
    const b = toScreenAniso(P(100, 10000), v);
    expect(a.x).toBeCloseTo(28, 5);
    expect(a.y).toBeCloseTo(600 - 28, 5);
    expect(b.x).toBeCloseTo(800 - 28, 5);
    expect(b.y).toBeCloseTo(28, 5);
    expect(v.sx).not.toBeCloseTo(v.sy, 3); // not uniform
  });

  it("is monotone (an affine map preserves order along each axis)", () => {
    const mid = toScreenAniso(P(50, 2500), v);
    expect(mid.x).toBeGreaterThan(28);
    expect(mid.y).toBeLessThan(600 - 28);
  });

  it("screen -> world is an exact rational on the requested grid", () => {
    const s = toScreenAniso(P(40, 4000), v);
    const back = fromScreenAniso(s.x, s.y, v, 4n);
    expect(back.x.d === 1n || back.x.d === 2n || back.x.d === 4n).toBe(true);
    expect(Number(back.x.n) / Number(back.x.d)).toBeCloseTo(40, 0);
    expect(Number(back.y.n) / Number(back.y.d)).toBeCloseTo(4000, -1);
  });

  it("degenerate inputs fall back to a usable view", () => {
    expect(fitAniso([], 300, 200).sx).toBeGreaterThan(0);
    const one = fitAniso([P(3, 3)], 300, 200);
    expect(Number.isFinite(one.sx)).toBe(true);
    const out = toScreenAniso(P(3, 3), one);
    expect(Number.isFinite(out.x)).toBe(true);
  });
});

describe("unbounded regions are extended past the viewport", () => {
  const box = { w: 800, h: 600 };

  it("regionPolygon extends both end vertices along the direction", () => {
    const chain = [
      { x: 100, y: 100 },
      { x: 200, y: 80 },
      { x: 300, y: 100 },
    ];
    const poly = regionPolygon(chain, { x: 0, y: 1 }, box);
    expect(poly.length).toBe(5);
    expect(poly[3]?.x).toBe(300);
    expect(poly[3]?.y).toBeGreaterThan(5000);
    expect(poly[4]?.x).toBe(100);
    expect(regionPolygon(chain, { x: 0, y: 0 }, box)).toEqual(chain);
    expect(regionPolygon([], { x: 0, y: 1 }, box)).toEqual([]);
  });

  it("a tilted direction keeps its slope", () => {
    const poly = regionPolygon([{ x: 100, y: 100 }], { x: 1, y: 2 }, box);
    const far = poly[1];
    expect(far).toBeDefined();
    expect(((far?.y ?? 0) - 100) / ((far?.x ?? 0) - 100)).toBeCloseTo(2, 6);
  });

  it("conePolygon is spanned by the ray and the direction from the apex", () => {
    const poly = conePolygon({ x: 100, y: 100 }, { x: 200, y: 90 }, { x: 0, y: 1 }, box);
    expect(poly.length).toBe(4);
    expect(poly[0]).toEqual({ x: 100, y: 100 });
    const a = poly[1];
    expect(((a?.y ?? 0) - 100) / ((a?.x ?? 0) - 100)).toBeCloseTo(-0.1, 6);
    expect(poly[3]?.x).toBe(100);
    expect(conePolygon({ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 1 }, box)).toEqual([{ x: 1, y: 1 }]);
  });

  it("halflineEnd, dirToScreen and pointsAttr", () => {
    const end = halflineEnd({ x: 10, y: 10 }, { x: 0, y: 1 }, box);
    expect(end.x).toBe(10);
    expect(end.y).toBeGreaterThan(5000);
    const d = dirToScreen({ x: Rat.make(1n, 2n), y: Rat.make(-1n) }, { ...v2(), sx: 4, sy: 2 });
    expect(d).toEqual({ x: 2, y: 2 });
    expect(pointsAttr([{ x: 1, y: 2 }, { x: 3.25, y: 4 }])).toBe("1.0,2.0 3.3,4.0");
  });
});

function v2() {
  return fitAniso([], 100, 100);
}
