// kstrip/spec/table.ts — machine-readable phase / invariant tables of a
// KStripSpec and of a finished run (for display layers; pure data, strings).
import { showExpr } from "./expr.ts";
import { PHASE_PREDICATE_INDEX, RUN_PREDICATE_INDEX } from "./predicates.ts";
import type { KStripSpec, PredRef, SpecRun } from "./types.ts";

export interface PredicateRow {
  readonly id: string;
  readonly describe: string;
}

export interface PhaseRow {
  readonly id: string;
  readonly kind: string;
  readonly levels: string;
  readonly primitive: string;
  readonly summary: string;
  readonly units: string;
  readonly inputStrips: string;
  readonly makerMoves: string;
  readonly breakerAllowance: string;
  readonly transition: string;
  readonly pairing: string | null;
  readonly candidateRegions: string | null;
  readonly extensionMove: string | null;
  readonly survivorSelection: string | null;
  readonly allowedResponses: readonly string[];
  readonly pre: readonly PredicateRow[];
  readonly post: readonly PredicateRow[];
}

export interface SpecTable {
  readonly specId: string;
  readonly title: string;
  readonly variant: string;
  readonly theorem: string;
  readonly version: string;
  readonly sRule: string;
  readonly verified: readonly string[];
  readonly runPre: readonly PredicateRow[];
  readonly runPost: readonly PredicateRow[];
  readonly phases: readonly PhaseRow[];
}

function rows(refs: readonly PredRef[], phase: boolean): PredicateRow[] {
  return refs.map((r) => ({
    id: r.id,
    describe: (phase ? PHASE_PREDICATE_INDEX.get(r.id) : RUN_PREDICATE_INDEX.get(r.id))?.describe ?? "(unknown predicate)",
  }));
}

export function specTable(spec: KStripSpec): SpecTable {
  return {
    specId: spec.id,
    title: spec.title,
    variant: spec.variant,
    theorem: spec.theorem,
    version: spec.version,
    sRule: spec.sRule,
    verified: spec.verified.map(
      (v) => `k=${v.k}, t in {${v.t.join(", ")}}${v.s === undefined ? "" : `, s in {${v.s.join(", ")}}`}`,
    ),
    runPre: rows(spec.runPre, false),
    runPost: rows(spec.runPost, false),
    phases: spec.phases.map((ph) => ({
      id: ph.id,
      kind: ph.kind,
      levels: ph.when.kind === "eq" ? `level = ${ph.when.level}` : `level >= ${ph.when.level}`,
      primitive: ph.primitive,
      summary: ph.summary,
      units: showExpr(ph.units),
      inputStrips: showExpr(ph.inputStrips),
      makerMoves: showExpr(ph.makerMoves),
      breakerAllowance: showExpr(ph.breakerAllowance),
      transition:
        ph.transition.kind === "terminal"
          ? "terminal"
          : `recurse: level ${showExpr(ph.transition.level)}, need ${showExpr(ph.transition.need)}`,
      pairing: ph.pairing,
      candidateRegions: ph.candidateRegions,
      extensionMove: ph.extensionMove,
      survivorSelection: ph.survivorSelection,
      allowedResponses: ph.allowedResponses,
      pre: rows(ph.pre, true),
      post: rows(ph.post, true),
    })),
  };
}

export interface CertificateRow {
  readonly level: number;
  readonly phaseId: string;
  readonly need: number;
  readonly units: number;
  readonly makerMoves: number;
  readonly breakerMoves: number;
  readonly delivered: number;
  readonly logFrom: number;
  readonly logTo: number;
  readonly ok: boolean;
  readonly pre: readonly { readonly id: string; readonly ok: boolean; readonly detail: string }[];
  readonly post: readonly { readonly id: string; readonly ok: boolean; readonly detail: string }[];
}

// One row per executed phase, bottom of the recursion first.
export function certificateTable(run: SpecRun): CertificateRow[] {
  return run.certificates.map((c) => ({
    level: c.level,
    phaseId: c.phaseId,
    need: c.need,
    units: c.units,
    makerMoves: c.makerMoves,
    breakerMoves: c.breakerMoves,
    delivered: c.delivered,
    logFrom: c.logFrom,
    logTo: c.logTo,
    ok: c.ok,
    pre: c.pre,
    post: c.post,
  }));
}
