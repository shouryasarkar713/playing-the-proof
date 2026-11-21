// session/navigate.ts — cursor-only navigation (§5.6). Moves the cursor,
// never a move: no events, no transactions, never enters the reducer.
import type { Store } from "./store.ts";
import type { NavigationOp } from "../game/types.ts";

export function navigate(store: Store, op: NavigationOp): void {
  if (op.kind === "goto") {
    // stateAtTxn validates (UnknownTxn on uncommitted ids); then move.
    store.stateAtTxn(op.txnId);
    store.setCursor(op.txnId);
    return;
  }
  if (op.kind === "undo") {
    const cursor = store.cursorTxnId();
    const parent = store.parentOf(cursor);
    if (parent === null) {
      return; // undo at txn 0 is a defined no-op (cursor stays 0)
    }
    store.setCursor(parent);
    return;
  }
  // branch: cursor ← atTxnId (committed only); the NEXT commit parents there.
  store.stateAtTxn(op.atTxnId);
  store.setCursor(op.atTxnId);
}
