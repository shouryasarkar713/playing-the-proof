// kstrip/spec/replay.ts — deterministic replay THROUGH THE SPEC PATH.
//
// Given a recorded move log, the spec interpreter is run with a policy that
// plays back the log's Breaker moves; Maker's moves are re-derived by the
// strategy. The log is accepted only if the regenerated log is byte-identical
// (canonical JSON; Rat fields serialise as "n/d"). A tampered Breaker move
// changes the board, so Maker's next move differs from the recorded one; an
// illegal Breaker move is rejected by the phase's allowed-response classes;
// a truncated or extended log is reported as such.
import type { BreakerDecision, BreakerPolicy, MoveLogEntry } from "../types.ts";
import { runSpec } from "./interpret.ts";
import type { SpecRunOptions } from "./interpret.ts";
import type { KStripSpec, SpecParams, SpecRun } from "./types.ts";

export function serializeLog(log: readonly MoveLogEntry[]): string {
  return JSON.stringify(log);
}

class LogExhausted extends Error {}

export function logPolicy(log: readonly MoveLogEntry[], name = "log-replay"): BreakerPolicy {
  const breakers = log.filter((e) => e.player === "breaker");
  let i = 0;
  return {
    name,
    choose(): BreakerDecision {
      const e = breakers[i];
      i += 1;
      if (e === undefined) {
        throw new LogExhausted("the log has fewer Breaker moves than the strategy needs");
      }
      return {
        point: e.ptFrame,
        reason: e.reason ?? { policy: name, code: "recorded", summary: e.note, target: null, data: {} },
      };
    },
  };
}

function firstDifference(a: readonly MoveLogEntry[], b: readonly MoveLogEntry[]): string {
  const n = a.length < b.length ? a.length : b.length;
  for (let i = 0; i < n; i += 1) {
    const x = a[i] as MoveLogEntry;
    const y = b[i] as MoveLogEntry;
    if (JSON.stringify(x) !== JSON.stringify(y)) {
      const field = (Object.keys(x) as (keyof MoveLogEntry)[]).find(
        (f) => JSON.stringify(x[f]) !== JSON.stringify(y[f]),
      );
      return `move ${x.n}: recorded ${field ?? "entry"} differs from the strategy's`;
    }
  }
  return a.length < b.length
    ? `the log stops after move ${a.length}; the strategy continues`
    : `the log has ${a.length - b.length} trailing moves the strategy does not make`;
}

// Re-run the strategy against the recorded Breaker moves and compare.
export function replaySpec(
  spec: KStripSpec,
  params: SpecParams,
  log: readonly MoveLogEntry[],
  opts: SpecRunOptions = {},
): SpecRun {
  let run: SpecRun;
  try {
    run = runSpec(spec, params, logPolicy(log), opts);
  } catch (e) {
    if (e instanceof LogExhausted) {
      return {
        specId: spec.id,
        specVersion: spec.version,
        outcome: {
          kind: "integrity-failure",
          scope: "replay",
          phase: null,
          predicate: "log-complete",
          message: e.message,
        },
        plan: [],
        certificates: [],
        runPre: [],
        runPost: [],
        result: null,
      };
    }
    throw e;
  }
  if (run.outcome.kind !== "completed" || run.result === null) {
    return run;
  }
  if (serializeLog(run.result.log) === serializeLog(log)) {
    return run;
  }
  return {
    ...run,
    outcome: {
      kind: "integrity-failure",
      scope: "replay",
      phase: null,
      predicate: "log-matches-strategy",
      message: firstDifference(log, run.result.log),
    },
  };
}
