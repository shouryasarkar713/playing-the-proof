// strategy/strategies/k6/wide.ts — esmb-k6-wide (§24.5a): the opt-in
// experimental extension. Identical to esmb-k6 except k6:boot routes ALL
// inside-pentagon B0 (forced region and ears alike) into k6:pairing —
// behavior beyond the published Lemma 7 claim, empirically validated
// only (prototype B0:anywhere 800/800). Excluded from Gate D by
// construction. Derived status: experimental-extension.
import type { StrategyDef, StrategyNode } from "../../types.ts";
import { esmbK6, forcedExpr, p5HullExpr } from "./def.ts";

const WIDE_PAPER =
  "Das–Valla 2026, Lemma 7 (experimental extension — behavior beyond the published claim; empirically validated only)";

const wideBoot: StrategyNode = {
  ...(esmbK6.nodes["k6:boot"] as StrategyNode),
  id: "k6:boot",
  routes: [
    {
      case: "k6:b0:inside-forced",
      when: { kind: "region", expr: forcedExpr },
      target: "k6:pairing",
      bind: { B0: { kind: "last" } },
    },
    {
      // Experimental widening: ear B0 enters the construction (the core
      // def routes these to k6:immediate instead).
      case: "k6:b0:inside-h5",
      when: { kind: "region", expr: p5HullExpr },
      target: "k6:pairing",
      bind: { B0: { kind: "last" } },
    },
    {
      case: "k6:b0:outside-h5",
      when: { kind: "all" },
      target: "k6:immediate",
    },
  ],
  why: {
    headline: "Breaker answers from the 5-hole (experimental).",
    claims: [
      {
        tier: "strategy-rule",
        text: "Experimental extension: every inside-pentagon B0 enters the two-round construction (the core def extends immediately outside the forced zone instead).",
      },
      {
        tier: "theorem-cited",
        text: "Das–Valla Lemma 7 (experimental extension — beyond the published claim).",
        ref: WIDE_PAPER,
      },
    ],
    sourceRef: WIDE_PAPER,
  },
  sourceRef: WIDE_PAPER,
};

export const esmbK6Wide: StrategyDef = {
  ...esmbK6,
  id: "esmb-k6-wide",
  source: {
    paper: WIDE_PAPER,
    stepMap: { ...esmbK6.source.stepMap },
  },
  nodes: { ...esmbK6.nodes, "k6:boot": wideBoot },
};
