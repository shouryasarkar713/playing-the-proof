// kstrip/spec public API: the declarative KStripSpec, its validator, the
// interpreter, replay and the machine-readable tables.
export type { Expr, ExprEnv, ExprVar } from "./expr.ts";
export { evalCount, evalExpr, exprVars, showExpr, ExprError } from "./expr.ts";
export * from "./types.ts";
export { KSTRIP_SPECS, SPEC_BICHROMATIC, SPEC_MONO_1_1, SPEC_MONO_1_S, specById } from "./specs.ts";
export {
  PHASE_PREDICATES,
  PHASE_PREDICATE_INDEX,
  RUN_PREDICATES,
  RUN_PREDICATE_INDEX,
} from "./predicates.ts";
export type { PhaseEnv, PredicateDef, RunEnv, Verdict } from "./predicates.ts";
export { biasOf, breakerTotalOf, evalPhase, inDomain, planFromSpec, planRounds, selectPhases } from "./plan.ts";
export { validateSpec, validateSpecCached } from "./validate.ts";
export type { SpecIssue } from "./validate.ts";
export { certificateFailures, runSpec } from "./interpret.ts";
export type { SpecRunOptions } from "./interpret.ts";
export { logPolicy, replaySpec, serializeLog } from "./replay.ts";
export { certificateTable, specTable } from "./table.ts";
export type { CertificateRow, PhaseRow, PredicateRow, SpecTable } from "./table.ts";
