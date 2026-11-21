// tests/strategies/k7gate.ts — Week-7 gate runner: for a family of hexagons,
// every B0 arrangement cell, every post-A1 B1 arrangement cell, leaf claim
// verified by the independent oracle. Evidence lines are appended to
// K7_GATE_EVIDENCE (env) when set.
import { appendFileSync } from "node:fs";
import { testCtx } from "../helpers.ts";
import { mulberry } from "./k7driver.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import {
  extraPoint,
  flatHexagon,
  nearConcurrent,
  needleHexagon,
  rationalHexagon,
} from "./k7gen.ts";
import { randomHexagon } from "./k7driver.ts";
import { fullTree } from "./k7tree.ts";
import type { TreeStats } from "./k7tree.ts";

export type Family = "integer" | "rational" | "concurrent" | "flat" | "needle";

export function makeHex(family: Family, rand: () => number): Pt[] {
  switch (family) {
    case "integer":
      return randomHexagon(rand, 40, 1);
    case "rational":
      return rationalHexagon(rand);
    case "concurrent":
      return nearConcurrent(rand);
    case "flat":
      return flatHexagon(rand);
    case "needle":
      return needleHexagon(rand);
  }
}

export interface GateSummary {
  family: Family;
  hexagons: number;
  b0Cells: number;
  b0Inside: number;
  leaves: number;
  failures: string[];
  b0Cases: Record<string, number>;
}

export function runGate(
  family: Family,
  seed: number,
  hexagons: number,
  opts: {
    leaf: "engine" | "oracle6";
    b0Stride?: number;
    b1Stride?: number;
  },
): GateSummary {
  const rand = mulberry(seed);
  const ctx = testCtx();
  const sum: GateSummary = {
    family,
    hexagons,
    b0Cells: 0,
    b0Inside: 0,
    leaves: 0,
    failures: [],
    b0Cases: {},
  };
  for (let h = 0; h < hexagons; h += 1) {
    const hex = makeHex(family, rand);
    const extra = extraPoint(hex, rand);
    let st: TreeStats;
    try {
      st = fullTree(hex, [extra], ctx, { outsideCap: 2, ...opts });
    } catch (e) {
      sum.failures.push(
        `hex ${hex.map((p) => `(${p.x.toString()},${p.y.toString()})`).join("")} extra (${extra.x.toString()},${extra.y.toString()}): ${String(e)}`,
      );
      continue;
    }
    sum.b0Cells += st.b0Cells;
    sum.b0Inside += st.b0Inside;
    sum.leaves += st.leaves;
    for (const [k, v] of Object.entries(st.b0Cases)) {
      sum.b0Cases[k] = (sum.b0Cases[k] ?? 0) + v;
    }
    for (const f of st.failures) {
      sum.failures.push(
        `hex ${hex.map((p) => `(${p.x.toString()},${p.y.toString()})`).join("")} extra (${extra.x.toString()},${extra.y.toString()}): ${f}`,
      );
    }
  }
  const line = JSON.stringify({ seed, ...opts, ...sum, failures: sum.failures.length });
  const out = process.env["K7_GATE_EVIDENCE"];
  if (out !== undefined && out !== "") {
    appendFileSync(out, `${line}\n`);
  }
  return sum;
}
