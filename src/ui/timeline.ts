// ui/timeline.ts — transaction-granular timeline: txn rows, cursor,
// branch chips (siblings), transport (reset/undo/forward/to-end/autoplay).
// Navigation is cursor-only (never a move); autoplay delegates stepping to
// the mode via onSampleStep.
import { navigate } from "../session/navigate.ts";
import type { Store } from "../session/store.ts";

export interface TimelineHooks {
  onSampleStep: (() => void) | null;
  autoplayMs: number;
  toast: (message: string) => void;
  fork: (() => void) | null;
  exportAll?: () => void; // export the whole transaction tree (not just the prefix)
  menu?: () => void; // QA D10: visible exit to the mode menu
}

export interface TimelineHandle {
  destroy(): void;
  setAutoplay(on: boolean): void;
  isAutoplay(): boolean;
}

export function mountTimeline(
  shell: {
    store: Store;
    svg: SVGSVGElement;
    render(): void;
    reset(): void;
  },
  el: HTMLElement,
  hooks: TimelineHooks,
): TimelineHandle {
  let timer: ReturnType<typeof setInterval> | null = null;
  let destroyed = false;

  const stop = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const stepBack = (): void => {
    stop();
    let cursor: number | null = null;
    try {
      cursor = shell.store.cursorTxnId();
    } catch {
      return; // empty session: nothing to undo yet.
    }
    void cursor;
    navigate(shell.store, { kind: "undo" });
  };

  const stepForward = (): void => {
    let cursor: number | null = null;
    try {
      cursor = shell.store.cursorTxnId();
    } catch {
      return; // empty session: nothing to step into yet.
    }
    const tree = shell.store.tree();
    const child = tree.transactions.find((t) => t.parentTxnId === cursor);
    if (child !== undefined) {
      stop();
      navigate(shell.store, { kind: "goto", txnId: child.txnId });
    }
  };

  const toEnd = (): void => {
    let cursor: number | null = null;
    try {
      cursor = shell.store.cursorTxnId();
    } catch {
      return; // empty session: nothing to advance to yet.
    }
    for (;;) {
      const tree = shell.store.tree();
      const child = tree.transactions.find((t) => t.parentTxnId === cursor);
      if (child === undefined) {
        break;
      }
      cursor = child.txnId;
    }
    stop();
    if (cursor !== null) {
      navigate(shell.store, { kind: "goto", txnId: cursor });
    }
  };

  const tick = (): void => {
    if (destroyed || hooks.onSampleStep === null) {
      stop();
      return;
    }
    hooks.onSampleStep();
  };

  const handle: TimelineHandle = {
    destroy() {
      destroyed = true;
      stop();
      el.replaceChildren();
    },
    setAutoplay(on: boolean) {
      stop();
      if (on && hooks.onSampleStep !== null) {
        timer = setInterval(tick, hooks.autoplayMs > 0 ? hooks.autoplayMs : 0);
      }
    },
    isAutoplay() {
      return timer !== null;
    },
  };

  const mkBtn = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.textContent = label;
    b.title = title;
    b.setAttribute("aria-label", title); // QA D7: glyph-only buttons need a name
    b.addEventListener("click", onClick);
    return b;
  };

  const bar = document.createElement("div");
  bar.className = "timeline-bar";
  bar.append(
    mkBtn("⟲", "Reset (R)", () => {
      stop();
      shell.reset();
    }),
    mkBtn("◀", "Step back (←)", stepBack),
    mkBtn("▶", "Step forward (→)", stepForward),
    mkBtn("⏭", "To end", toEnd),
  );
  if (hooks.onSampleStep !== null) {
    const play = mkBtn("⏯", "Autoplay (Space)", () =>
      handle.setAutoplay(!handle.isAutoplay()),
    );
    bar.appendChild(play);
  }
  const fork = hooks.fork;
  if (fork !== null) {
    bar.appendChild(mkBtn("⤴", "Fork replay at cursor", () => fork()));
  }
  const exportAll = hooks.exportAll;
  if (exportAll !== undefined) {
    bar.appendChild(mkBtn("⤓", "Export the whole session as a replay file", () => exportAll()));
  }
  const menu = hooks.menu;
  if (menu !== undefined) {
    const mb = mkBtn("☰", "Back to the mode menu (Esc / M)", () => menu());
    mb.append(" Menu");
    bar.appendChild(mb);
  }
  el.appendChild(bar);

  const rows = document.createElement("div");
  rows.className = "timeline-rows";
  el.appendChild(rows);
  const chips = document.createElement("div");
  chips.className = "branch-chips";
  el.appendChild(chips);

  const paint = (): void => {
    const tree = shell.store.tree();
    let cursor: number | null = null;
    try {
      cursor = shell.store.cursorTxnId();
    } catch {
      // Empty session (pre-boot): no rows yet; the store subscription
      // repaints after the first commit.
      rows.replaceChildren();
      chips.replaceChildren();
      return;
    }
    rows.replaceChildren();
    for (const txn of tree.transactions) {
      const row = document.createElement("button");
      row.className = txn.txnId === cursor ? "txn current" : "txn";
      const n = txn.events.length;
      row.textContent = `t${txn.txnId} (${n} event${n === 1 ? "" : "s"})${txn.result.kind === "terminal" ? " ★" : ""}`;
      row.addEventListener("click", () => {
        stop();
        navigate(shell.store, { kind: "goto", txnId: txn.txnId });
      });
      rows.appendChild(row);
    }
    chips.replaceChildren();
    const cursorTxn = tree.transactions.find((t) => t.txnId === cursor);
    const siblings = tree.transactions.filter(
      (t) => t.parentTxnId === (cursorTxn?.parentTxnId ?? null),
    );
    if (siblings.length > 1) {
      for (const sib of siblings) {
        const chip = document.createElement("button");
        chip.className = sib.txnId === cursor ? "chip current" : "chip";
        chip.textContent = `branch t${sib.txnId}`;
        chip.addEventListener("click", () => {
          stop();
          navigate(shell.store, { kind: "goto", txnId: sib.txnId });
        });
        chips.appendChild(chip);
      }
    }
  };
  paint();
  const unsub = shell.store.subscribe(() => paint());

  const onKey = (e: KeyboardEvent): void => {
    if (!document.contains(shell.svg)) {
      document.removeEventListener("keydown", onKey);
      return;
    }
    if (e.target instanceof HTMLInputElement) {
      return;
    }
    if (e.key === "ArrowLeft") {
      stepBack();
    } else if (e.key === "ArrowRight") {
      stepForward();
    }
  };
  document.addEventListener("keydown", onKey);
  const baseDestroy = handle.destroy.bind(handle);
  handle.destroy = () => {
    document.removeEventListener("keydown", onKey);
    unsub();
    baseDestroy();
  };
  return handle;
}
