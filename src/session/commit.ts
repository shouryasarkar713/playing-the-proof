// session/commit.ts — the ONLY writer of transaction metadata (uses the
// game-layer withSeq for SeqFinalization, §5.5). In-memory only. Called by
// ui/dispatch only (§10.8).
import { stateHash } from "../game/hash.ts";
import { withSeq } from "../game/types.ts";
import type {
  ActionTransaction,
  Diagnostic,
  GameState,
  MoveEvent,
  UserAction,
} from "../game/types.ts";
import {
  committedStateAdmissible,
  CommitGateError,
} from "../engine/orchestrator.ts";
import type {
  EngineResult,
  RuntimeCtx,
} from "../engine/orchestrator.ts";
import { initSession } from "../engine/init.ts";
import type {
  BootstrapError,
  InitRequest,
} from "../engine/init.ts";
import type { Store } from "./store.ts";

export interface StartResult {
  status: "accepted" | "rejected";
  txn?: ActionTransaction;
  state?: GameState;
  error?: BootstrapError;
  diagnostics: readonly Diagnostic[];
}

// withSeq re-exported from game/types.ts (its Phase-15 home) for
// compatibility.
export { withSeq } from "../game/types.ts";

// commit (§10.8): gate → allocate → finalize seq → metadata → append.
export function commit(
  result: EngineResult,
  action: UserAction,
  store: Store,
  ctx: RuntimeCtx,
): ActionTransaction {
  if (result.status !== "accepted" || result.nextState === undefined) {
    throw new Error("commit: result not accepted — implementation error");
  }
  const admission = committedStateAdmissible(result.nextState, ctx);
  if (!admission.ok) {
    throw new CommitGateError(admission);
  }
  const txnId = store.nextTxnId();
  const parentTxnId = store.cursorTxnId();
  if (result.nextState.seq !== parentTxnId) {
    throw new Error(
      `commit: reducer seq ${result.nextState.seq} !== parent ${parentTxnId} — implementation error`,
    );
  }
  if (
    store.afterHashOf(parentTxnId) !==
    stateHash(store.stateAtTxn(parentTxnId))
  ) {
    throw new Error("commit: parent hash-chain mismatch — implementation error");
  }
  const finalState = withSeq(result.nextState, txnId);
  const parentLast = store.lastEventOf(parentTxnId);
  const ordinals = result.events.map(() => store.nextEventOrdinal());
  const events: MoveEvent[] = result.events.map((e, idx) => ({
    ...e,
    i: ordinals[idx] as number,
    txnId,
    indexInTxn: idx + 1,
    parent: idx > 0 ? (ordinals[idx - 1] as number) : parentLast,
  }));
  const txn: ActionTransaction = {
    txnId,
    parentTxnId,
    action,
    events,
    beforeHash: store.afterHashOf(parentTxnId),
    afterHash: stateHash(finalState),
    result:
      result.outcome !== undefined && result.outcome.kind === "terminal"
        ? { kind: "terminal", terminal: result.outcome.terminal }
        : { kind: "committed" },
  };
  store.append(txn, finalState);
  return txn;
}

// startSession (§10.8): txn-0 creation — pure initSession, then the commit
// gate in txn-0 form, then append with ZERO events and beforeHash null.
export function startSession(
  request: InitRequest,
  ctx: RuntimeCtx,
  store: Store,
): StartResult {
  const r = initSession(request, ctx);
  if (r.status === "rejected" || r.state === undefined) {
    if (r.error === undefined) {
      throw new Error(
        "startSession: rejection without error — implementation error",
      );
    }
    return {
      status: "rejected",
      error: r.error,
      diagnostics: r.diagnostics,
    };
  }
  if (r.state.seq !== 0) {
    throw new Error("startSession: engine seq is not 0 — implementation error");
  }
  const admission = committedStateAdmissible(r.state, ctx);
  if (!admission.ok) {
    throw new CommitGateError(admission);
  }
  const txnId = store.nextTxnId();
  const finalState = withSeq(r.state, txnId);
  const txn: ActionTransaction = {
    txnId,
    parentTxnId: null,
    action: { kind: "init" },
    events: [],
    beforeHash: null,
    afterHash: stateHash(finalState),
    result:
      finalState.terminal !== null
        ? { kind: "terminal", terminal: finalState.terminal }
        : { kind: "committed" },
  };
  store.append(txn, finalState);
  return { status: "accepted", txn, state: finalState, diagnostics: [] };
}
