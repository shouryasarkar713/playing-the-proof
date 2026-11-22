// lab/classify.ts — the deterministic three-way classifier.
//
// Order of decisions (pure, total, no clock/random):
//   1. validate the parameters; invalid  -> NOT_COVERED (reasons say why)
//   2. collect the cited rows whose regime contains the configuration
//      (theoremCitations); any citation   -> THEOREM_BACKED
//   3. else, if the lab's bounded simulation covers the configuration
//      (k in [3,8], bias <= 16)           -> EXPERIMENTAL
//   4. else                               -> NOT_COVERED (+ nearest neighbours)
// The encoding selection NEVER changes the status; it only decides whether
// interactive replay is offered (encoding.replayOffered) and adds limitations.
//
// Bias monotonicity is not assumed anywhere: a regime is backed only where a
// source statement covers exactly that bias (see DISCREPANCIES D2-D5).
import { Rat } from "../geometry/rat.ts";
import { isIntegerRat, formatBias } from "./bias.ts";
import { ENCODING_REGISTRY, encodingApplies, encodingEntry, inVerifiedScope, isVerified } from "./encodings.ts";
import type { EncodingEntry } from "./encodings.ts";
import { SIM_K_MAX, SIM_K_MIN, SIM_MAX_BIAS_INT } from "./limits.ts";
import { sourceRow } from "./regimes.ts";
import type {
  BasisKind,
  Citation,
  EncodingInfo,
  LabConfig,
  LabConfigJSON,
  LabResult,
  LabStatus,
  Neighbour,
  SimulationAvailability,
} from "./types.ts";

const ZERO = Rat.ZERO;
const ONE = Rat.ONE;
const TWO = Rat.make(2n);

export function configToJSON(cfg: LabConfig): LabConfigJSON {
  return {
    model: cfg.model,
    k: cfg.k,
    bias: cfg.bias.toString(),
    rule: cfg.rule,
    encodingId: cfg.encodingId,
    structures: cfg.structures,
  };
}

export function validateConfig(cfg: LabConfig): string[] {
  const issues: string[] = [];
  if (cfg.model !== "online" && cfg.model !== "one-round") {
    issues.push(`unknown game model '${String(cfg.model)}'`);
  }
  if (cfg.rule !== "monochromatic" && cfg.rule !== "bichromatic") {
    issues.push(`unknown rule '${String(cfg.rule)}'`);
  }
  if (!Number.isInteger(cfg.k) || cfg.k < 3) {
    issues.push(`k = ${String(cfg.k)} is not a hole size (an integer >= 3 is required)`);
  }
  if (cfg.bias.isNeg()) {
    issues.push("bias must be >= 0");
  }
  if (!Number.isInteger(cfg.structures) || cfg.structures < 1) {
    issues.push("number of parallel structures must be an integer >= 1");
  }
  return issues;
}

// 3*ceil(2*lambda/(lambda-2)) - 1 with pure integer arithmetic (lambda >= 3).
export function thm10MinK(lambda: bigint): bigint {
  if (lambda < 3n) {
    throw new Error("thm10MinK: lambda must be an integer >= 3");
  }
  const ceil = (2n * lambda + (lambda - 2n) - 1n) / (lambda - 2n);
  return 3n * ceil - 1n;
}

function cite(rowId: string, basis: BasisKind, note: string): Citation {
  if (sourceRow(rowId) === undefined) {
    throw new Error(`lab: citation names unknown row ${rowId} — implementation error`);
  }
  return { rowId, basis, note };
}

// The cited rows whose regime contains cfg (cfg is assumed valid).
export function theoremCitations(cfg: LabConfig): Citation[] {
  const out: Citation[] = [];
  const s = cfg.bias;
  const k = cfg.k;
  const isInt = isIntegerRat(s);
  if (cfg.rule === "monochromatic") {
    if (k <= 6) {
      out.push(
        cite(
          "DER-MONO-SMALLK",
          "derived",
          `k = ${k} <= 6: every large enough point set has a ${k}-hole and the monochromatic rule lets Breaker's points count, so no bias helps Breaker`,
        ),
      );
    }
    if (cfg.model === "online") {
      if (s.cmp(ONE) >= 0) {
        if (s.equals(ONE)) {
          out.push(cite("DZ-T3", "proved", "monochromatic 1:1, every k"));
        }
        out.push(
          cite(
            "DZ-T4",
            "proved",
            isInt ? "monochromatic 1:s, integer s >= 1" : "monochromatic 1:s, real s >= 1 (proof reduces to ceil(s))",
          ),
        );
      } else if (s.cmp(ZERO) > 0) {
        out.push(cite("DV-T3", "proved", "Maker places more points than Breaker (ratio 1/s > 1), every k"));
      } else {
        out.push(cite("DER-MONO-S0", "derived", "Breaker places no points: reduction from the bichromatic Thm 5"));
      }
    }
    return out;
  }
  // ---- bichromatic ----
  if (cfg.model === "one-round") {
    if (s.cmp(TWO) < 0) {
      out.push(cite("DZ-T13", "proved", "one-round bichromatic, bias 1:(2-eps), Maker wins for large enough sets"));
    } else if (s.equals(TWO)) {
      out.push(cite("DZ-P7", "proved", "one-round bichromatic, bias exactly 1:2, Breaker wins"));
    } else {
      out.push(
        cite("DZ-P7", "stated", "one-round bichromatic, bias > 2: stated in the introduction; Prop. 7 proves exactly 2"),
      );
    }
    return out;
  }
  // bichromatic, online
  if (s.cmp(TWO) < 0) {
    out.push(cite("DZ-T5", "proved", "online bichromatic, 0 <= s < 2, every k >= 3"));
    if (s.equals(ONE) && (k === 4 || k === 5)) {
      out.push(cite("AI-T37", "stated", `Red–Green game: Maker builds a red convex ${k}-hole (extended abstract)`));
    }
    return out;
  }
  if (isInt && s.n >= 6n && s.n % 2n === 0n) {
    const lambda = s.n / 2n;
    if (BigInt(k) >= thm10MinK(lambda)) {
      out.push(
        cite(
          "DZ-T10",
          lambda <= 6n ? "proved" : "stated",
          lambda <= 6n
            ? `bias 1:${s.n} (lambda = ${lambda}), k >= ${thm10MinK(lambda)}: proof written for lambda in {3,4,5,6}`
            : `bias 1:${s.n} (lambda = ${lambda} >= 7), k >= ${thm10MinK(lambda)}: theorem stated, no proof given for lambda >= 7`,
        ),
      );
    }
  }
  if (isInt && s.n >= 12n && k >= 8) {
    out.push(
      cite(
        "DZ-T8",
        s.n === 12n ? "proved" : "stated",
        s.n === 12n
          ? "bias exactly 1:12, k >= 8"
          : "bias > 12: abstract/introduction say '12 or more'; Thm 8 proves exactly 12",
      ),
    );
  }
  return out;
}

const RANK: Record<BasisKind, number> = { derived: 0, stated: 1, proved: 2 };

function strongest(cs: readonly Citation[]): BasisKind | null {
  let best: BasisKind | null = null;
  for (const c of cs) {
    if (best === null || RANK[c.basis] > RANK[best]) {
      best = c.basis;
    }
  }
  return best;
}

export function simulationSupport(cfg: LabConfig): SimulationAvailability {
  if (validateConfig(cfg).length > 0) {
    return { available: false, reason: "invalid parameters", mustLabelObservationOnly: false };
  }
  if (cfg.k < SIM_K_MIN || cfg.k > SIM_K_MAX) {
    return {
      available: false,
      reason: `the exact-geometry engine supports k in [${SIM_K_MIN}, ${SIM_K_MAX}]`,
      mustLabelObservationOnly: false,
    };
  }
  if (cfg.bias.cmp(Rat.make(SIM_MAX_BIAS_INT)) > 0) {
    return {
      available: false,
      reason: `simulation bias is capped at 1:${String(SIM_MAX_BIAS_INT)} (64-point engine cap)`,
      mustLabelObservationOnly: false,
    };
  }
  return {
    available: true,
    reason:
      "bounded, seeded, interruptible exact-geometry simulation with simple Breaker policies (random-legal, greedy)",
    mustLabelObservationOnly: true,
  };
}

function encodingInfo(
  cfg: LabConfig,
  registry: readonly EncodingEntry[],
): EncodingInfo {
  if (cfg.encodingId === null) {
    return {
      requested: null,
      applies: false,
      availability: "none",
      replayOffered: false,
      note: "no encoded strategy selected",
    };
  }
  const e = encodingEntry(cfg.encodingId, registry);
  if (e === undefined) {
    return {
      requested: cfg.encodingId,
      applies: false,
      availability: "none",
      replayOffered: false,
      note: `unknown encoding id '${cfg.encodingId}'`,
    };
  }
  const applies = encodingApplies(e, cfg);
  // An entry verified for listed configurations only is verified here only if
  // this exact configuration is listed; elsewhere it exists but is unverified.
  const scoped = applies && !inVerifiedScope(e, cfg);
  const availability = scoped && isVerified(e.availability) ? "exists-unverified" : e.availability;
  const replayOffered = applies && !scoped && isVerified(e.availability) && (e.replay ?? "proof") === "proof";
  let note: string;
  if (!applies) {
    note = `'${e.id}' is a construction for a different game (${e.rule}, online, ${e.k === "any" ? "any k" : `k = ${e.k}`}); it is ignored for this configuration`;
  } else if (scoped && isVerified(e.availability)) {
    note = `'${e.id}' matches this game but is verified only for its listed configurations and this one is not among them: the strategy is not extrapolated to it; no replay is offered`;
  } else if (e.availability === "none") {
    note = `'${e.id}' matches this game but no implementation exists yet; no replay is offered`;
  } else if (e.availability === "exists-unverified") {
    note = `'${e.id}' exists but is unverified: the theorem backs the regime, not this variant; no proof replay is offered`;
  } else if ((e.replay ?? "proof") === "explorer") {
    note = `'${e.id}' is ${e.availability} for this exact configuration: an exact run is available in the k-strip explorer; it is not an interactive replay of this game`;
  } else {
    note = `'${e.id}' is ${e.availability}`;
  }
  return {
    requested: cfg.encodingId,
    applies,
    availability: applies ? availability : "none",
    replayOffered,
    note,
  };
}

// ---- nearest theorem-backed neighbours ----

const BIAS_PROBES: readonly Rat[] = [
  Rat.make(0n),
  Rat.make(1n),
  Rat.make(19n, 10n),
  Rat.make(2n),
  Rat.make(6n),
  Rat.make(8n),
  Rat.make(10n),
  Rat.make(12n),
];
const K_PROBES: readonly number[] = [3, 4, 5, 6, 7, 8, 9, 11, 17];

interface Cand {
  cfg: LabConfig;
  changed: string[];
  kDist: number;
  bDist: Rat;
  cites: Citation[];
}

export function nearestNeighbours(cfg: LabConfig, max = 4): Neighbour[] {
  const cands: Cand[] = [];
  const push = (c: LabConfig, changed: string[]): void => {
    const cites = theoremCitations(c);
    if (cites.length === 0) {
      return;
    }
    cands.push({
      cfg: c,
      changed,
      kDist: c.k >= cfg.k ? c.k - cfg.k : cfg.k - c.k,
      bDist: c.bias.sub(cfg.bias).abs(),
      cites,
    });
  };
  const other = (m: LabConfig["model"]): LabConfig["model"] => (m === "online" ? "one-round" : "online");
  const otherRule = (r: LabConfig["rule"]): LabConfig["rule"] =>
    r === "monochromatic" ? "bichromatic" : "monochromatic";
  push({ ...cfg, model: other(cfg.model) }, ["model"]);
  push({ ...cfg, rule: otherRule(cfg.rule) }, ["rule"]);
  for (const b of BIAS_PROBES) {
    if (!b.equals(cfg.bias)) {
      push({ ...cfg, bias: b }, ["bias"]);
    }
  }
  for (const k of K_PROBES) {
    if (k !== cfg.k) {
      push({ ...cfg, k }, ["k"]);
    }
  }
  for (const b of BIAS_PROBES) {
    for (const k of K_PROBES) {
      if (!b.equals(cfg.bias) && k !== cfg.k) {
        push({ ...cfg, bias: b, k }, ["bias", "k"]);
      }
    }
  }
  cands.sort((a, b) => {
    if (a.changed.length !== b.changed.length) {
      return a.changed.length - b.changed.length;
    }
    if (a.kDist !== b.kDist) {
      return a.kDist - b.kDist;
    }
    const c = a.bDist.cmp(b.bDist);
    if (c !== 0) {
      return c;
    }
    const ja = JSON.stringify(configToJSON(a.cfg));
    const jb = JSON.stringify(configToJSON(b.cfg));
    return ja < jb ? -1 : ja > jb ? 1 : 0;
  });
  const out: Neighbour[] = [];
  const seen = new Set<string>();
  for (const c of cands) {
    const label = `${c.cfg.rule}, ${c.cfg.model}, k = ${c.cfg.k}, bias ${formatBias(c.cfg.bias)}`;
    if (seen.has(label)) {
      continue;
    }
    seen.add(label);
    out.push({
      label,
      config: configToJSON(c.cfg),
      changed: c.changed,
      citedRows: c.cites.map((x) => x.rowId),
    });
    if (out.length >= max) {
      break;
    }
  }
  return out;
}

function limitationsFor(cfg: LabConfig, cites: readonly Citation[], status: LabStatus): string[] {
  const out: string[] = [];
  for (const c of cites) {
    const row = sourceRow(c.rowId);
    if (row !== undefined && row.note !== "") {
      out.push(`${c.rowId}: ${row.note}`);
    }
    if (c.basis === "stated") {
      out.push(`${c.rowId}: the source states this regime but its written proof covers only part of the range`);
    }
    if (c.basis === "derived") {
      out.push(`${c.rowId}: derived by elementary deduction from the cited statements, not quoted from a source theorem`);
    }
  }
  if (!isIntegerRat(cfg.bias)) {
    out.push("non-integer bias: the sources' ordering convention for non-integer speeds is not fixed precisely (D5)");
  }
  if (status !== "THEOREM_BACKED") {
    out.push("no cited statement covers this configuration in the selected game model");
  }
  return out;
}

export function classify(
  cfg: LabConfig,
  registry: readonly EncodingEntry[] = ENCODING_REGISTRY,
): LabResult {
  const invalid = validateConfig(cfg);
  const enc = encodingInfo(cfg, registry);
  const sim = simulationSupport(cfg);
  const json = configToJSON(cfg);
  if (invalid.length > 0) {
    return {
      status: "NOT_COVERED",
      config: json,
      citations: [],
      basis: null,
      verification: "none",
      encoding: enc,
      limitations: ["invalid parameters: no regime applies"],
      neighbours: [],
      simulation: sim,
      reasons: invalid,
      invalid,
    };
  }
  const cites = theoremCitations(cfg);
  if (cites.length > 0) {
    const basis = strongest(cites) as BasisKind;
    const verification =
      basis === "proved"
        ? "published theorem; the lab asserts the regime and never claims to re-prove it"
        : basis === "stated"
          ? "published statement with a partial written proof; the lab asserts only what the source states"
          : "derived inference from cited statements (see citation notes)";
    return {
      status: "THEOREM_BACKED",
      config: json,
      citations: cites,
      basis,
      verification,
      encoding: enc,
      limitations: limitationsFor(cfg, cites, "THEOREM_BACKED"),
      neighbours: [],
      simulation: sim,
      reasons: [`inside a cited regime: ${cites.map((c) => c.rowId).join(", ")}`],
      invalid: [],
    };
  }
  const status: LabStatus = sim.available ? "EXPERIMENTAL" : "NOT_COVERED";
  return {
    status,
    config: json,
    citations: [],
    basis: null,
    verification: "none",
    encoding: enc,
    limitations: limitationsFor(cfg, [], status),
    neighbours: nearestNeighbours(cfg),
    simulation: sim,
    reasons: [
      "outside every cited regime in the selected game model",
      sim.available
        ? "a bounded simulation exists: its output is an observation, never a guarantee"
        : `no simulation: ${sim.reason}`,
    ],
    invalid: [],
  };
}
