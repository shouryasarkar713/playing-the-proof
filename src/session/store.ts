// session/store.ts — the in-memory Store (session/ is the ONLY mutable
// module; in-memory only: no I/O, no DOM, no timers — §18.1).
import { deepFreeze } from "../game/types.ts";
import type {
  ActionTransaction,
  GameState,
  MoveEvent,
  SessionSnapshot,
  SessionTree,
} from "../game/types.ts";

export class UnknownTxnError extends Error {
  readonly txnId: number;
  constructor(txnId: number) {
    super(`UnknownTxn: no committed transaction ${txnId}`);
    this.name = "UnknownTxnError";
    this.txnId = txnId;
  }
}

type Listener = (snap: SessionSnapshot) => void;

export class Store {
  private readonly txns = new Map<number, ActionTransaction>();
  private readonly states = new Map<number, GameState>();
  private readonly eventList: MoveEvent[] = [];
  private cursor: number | null = null;
  private txnCounter = 0;
  private eventCounter = 0;
  private readonly listeners = new Set<Listener>();

  nextTxnId(): number {
    const id = this.txnCounter;
    this.txnCounter += 1;
    return id;
  }

  nextEventOrdinal(): number {
    this.eventCounter += 1;
    return this.eventCounter;
  }

  // catchUpCounters (Phase-15 replay seam): after bulk-loading committed
  // history (resume/fork), advance the allocators past the loaded metadata
  // so later commits never reuse a txn id or event ordinal. Derives from
  // the stored data — no parameters to get out of sync.
  catchUpCounters(): void {
    let maxTxn = -1;
    for (const id of this.txns.keys()) {
      if (id > maxTxn) {
        maxTxn = id;
      }
    }
    let maxEv = 0;
    for (const ev of this.eventList) {
      if (ev.i > maxEv) {
        maxEv = ev.i;
      }
    }
    this.txnCounter = maxTxn + 1;
    this.eventCounter = maxEv;
  }

  lastEventOf(txnId: number): number | null {
    let last: number | null = null;
    for (const ev of this.eventList) {
      if (ev.txnId === txnId) {
        last = ev.i;
      }
    }
    return last;
  }

  afterHashOf(txnId: number): string {
    const txn = this.txns.get(txnId);
    if (txn === undefined) {
      throw new UnknownTxnError(txnId);
    }
    return txn.afterHash;
  }

  parentOf(txnId: number): number | null {
    const txn = this.txns.get(txnId);
    if (txn === undefined) {
      throw new UnknownTxnError(txnId);
    }
    return txn.parentTxnId;
  }

  // append: tree + states append; cursor = txn.txnId; publish. The ONLY
  // writer of committed history (called by commit()/startSession() only).
  append(txn: ActionTransaction, state: GameState): void {
    if (this.txns.has(txn.txnId)) {
      throw new Error(
        `Store.append: txn ${txn.txnId} already committed — implementation error`,
      );
    }
    this.txns.set(txn.txnId, deepFreeze(txn));
    this.states.set(txn.txnId, state);
    for (const ev of txn.events) {
      this.eventList.push(ev);
    }
    this.cursor = txn.txnId;
    this.publish();
  }

  setCursor(txnId: number): void {
    if (!this.states.has(txnId)) {
      throw new UnknownTxnError(txnId);
    }
    this.cursor = txnId;
    this.publish();
  }

  cursorTxnId(): number {
    if (this.cursor === null) {
      throw new Error("Store.cursorTxnId: no transaction committed yet");
    }
    return this.cursor;
  }

  // clear: empty a session while keeping subscribers (relaunch without
  // resubscribing every panel/timeline). Fresh-session numbering restarts.
  clear(): void {
    this.txns.clear();
    this.states.clear();
    this.eventList.length = 0;
    this.cursor = null;
    this.txnCounter = 0;
    this.eventCounter = 0;
  }

  // current() ≡ the cursor txn's finalized state (§5.6). Postcondition
  // (asserted): current().seq === cursorTxnId().
  current(): GameState {
    const id = this.cursorTxnId();
    const state = this.stateAtTxn(id);
    if (state.seq !== id) {
      throw new Error(
        `Store.current: seq ${state.seq} !== cursor ${id} — implementation error`,
      );
    }
    return state;
  }

  stateAtTxn(txnId: number): GameState {
    const state = this.states.get(txnId);
    if (state === undefined) {
      throw new UnknownTxnError(txnId);
    }
    return state;
  }

  tree(): SessionTree {
    return deepFreeze({
      events: [...this.eventList],
      transactions: [...this.txns.values()],
    });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // batch: bulk-load many committed transactions (replay resume)
  // with ONE publish at the end — subscribers (the shell renderer) otherwise
  // re-render, and re-analyse holes, once per appended transaction.
  private batchDepth = 0;
  private batchPending = false;
  batch(fn: () => void): void {
    this.batchDepth += 1;
    try {
      fn();
    } finally {
      this.batchDepth -= 1;
      if (this.batchDepth === 0 && this.batchPending) {
        this.batchPending = false;
        this.publish();
      }
    }
  }

  private publish(): void {
    if (this.batchDepth > 0) {
      this.batchPending = true;
      return;
    }
    const snap: SessionSnapshot = {
      state: this.current(),
      cursorTxnId: this.cursorTxnId(),
    };
    for (const listener of this.listeners) {
      listener(snap);
    }
  }
}
