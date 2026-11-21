// session/sessionTree.ts — pure SessionTree operations (append-only history).
import { UnknownTxnError } from "./store.ts";
import type { ActionTransaction, SessionTree } from "../game/types.ts";

export function emptyTree(): SessionTree {
  return { events: [], transactions: [] };
}

export function txnById(
  tree: SessionTree,
  txnId: number,
): ActionTransaction | null {
  for (const txn of tree.transactions) {
    if (txn.txnId === txnId) {
      return txn;
    }
  }
  return null;
}

export function childrenOf(
  tree: SessionTree,
  parentTxnId: number | null,
): ActionTransaction[] {
  return tree.transactions.filter((t) => t.parentTxnId === parentTxnId);
}

// Root-to-txn chain (for timeline history); unknown id throws UnknownTxn.
export function chainTo(
  tree: SessionTree,
  txnId: number,
): ActionTransaction[] {
  const chain: ActionTransaction[] = [];
  let cur: number | null = txnId;
  while (cur !== null) {
    const txn = txnById(tree, cur);
    if (txn === null) {
      throw new UnknownTxnError(txnId);
    }
    chain.unshift(txn);
    cur = txn.parentTxnId;
  }
  return chain;
}
