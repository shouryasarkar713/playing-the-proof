// ui/replay-io.ts — ALL replay file/discovery/clipboard/storage I/O (§15.5).
// The replay module stays pure; every effect lives here: Blob download,
// file picking, clipboard, localStorage autosave/resume. No geometry.
import {
  assembleReplayFile,
  strategyStartForExport,
} from "../engine/replay.ts";
import {
  parseReplayFile,
  serializeReplay,
  MAX_REPLAY_CHARS,
  utf8Bytes,
} from "../replay/format.ts";
import type { ReplayFile } from "../replay/format.ts";
import { validateReplay } from "../replay/validate.ts";
import type {
  ActionTransaction,
  GameMode,
  GameState,
} from "../game/types.ts";
import { gameModeOf } from "../game/gamemode.ts";
import { parseExperiment } from "../replay/experiment.ts";
import {
  looksLikeExperiment,
  replayKStripExperiment,
  replayLabExperiment,
} from "./experiment-io.ts";
import type { Store } from "../session/store.ts";
import type { RuntimeCtx } from "../engine/orchestrator.ts";
import type { Shell } from "./app.ts";
import pkg from "../../package.json";

const APP = "playing-the-proof";
const AUTOSAVE_PREFIX = "pp.autosave.v2.";

// Only the literal bichromatic flag is ever written (monochromatic sessions
// keep writing format v2, byte-identical to before the flag existed).
function gameModeField(state: GameState): { gameMode?: GameMode } {
  return gameModeOf(state) === "bichromatic"
    ? { gameMode: "bichromatic" }
    : {};
}

// resumeExperiment: k-strip / lab experiment files (replay/experiment.ts).
// The file is parsed under its caps, then RE-EXECUTED and compared with the
// recorded log / observation before a mode is mounted; a rejected file leaves
// the caller's screen untouched.
function resumeExperiment(
  shell: Shell,
  text: string,
  toast: (m: string) => void,
): boolean {
  const parsed = parseExperiment(text);
  if (!parsed.ok) {
    toast(
      `Experiment rejected: ${parsed.issues
        .slice(0, 3)
        .map((i) => `${i.code}${i.path === "" ? "" : ` at ${i.path}`}`)
        .join("; ")}`,
    );
    return false;
  }
  const file = parsed.file;
  if (file.kind === "kstrip") {
    const rep = replayKStripExperiment(file.kstrip);
    if (!rep.ok) {
      toast(`Experiment rejected: ${rep.issues.slice(0, 2).join("; ")}`);
      return false;
    }
    shell.startKStrip(file);
    return true;
  }
  const rep = replayLabExperiment(file.lab);
  if (!rep.ok) {
    toast(`Experiment rejected: ${rep.issues.join("; ")}`);
    return false;
  }
  shell.startLab(file);
  return true;
}

function stamp(label?: string): {
  createdAt: string;
  app: string;
  appVersion: string;
  label?: string;
} {
  return {
    createdAt: new Date().toISOString(),
    app: APP,
    appVersion: pkg.version,
    ...(label !== undefined ? { label } : {}),
  };
}

// exportSession: live store → canonical replay string. Guided sessions
// resume as break shells (proof and break share the break session mode;
// the states and tree are identical — only the panel set differs).
export function exportSession(shell: Shell, label?: string): string {
  const store = shell.store;
  const state = store.current();
  const txn0 = store.stateAtTxn(0);
  const strategyId = state.strategy?.strategyId ?? null;
  const file = assembleReplayFile(
    store.tree(),
    store.cursorTxnId(),
    {
      k: state.k,
      mode: state.mode,
      ...gameModeField(state),
      window: shell.ctx.config.window,
      strategyId,
      strategyStart: strategyStartForExport(txn0),
      meta: stamp(label),
      engineVersion: pkg.version,
    },
    shell.ctx,
  );
  return serializeReplay(file as ReplayFile);
}

export function downloadReplay(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// pickReplayFile: OS file picker → text, with the §30 2 MB cap enforced
// at the size level (before reading a single byte into memory). The
// optional toast reports the rejection; resolve(null) otherwise means the
// user cancelled. The paste/autosave paths get the same cap inside
// parseReplayFile (defense in depth).
export function pickReplayFile(
  toast?: (message: string) => void,
): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("cancel", () => resolve(null));
    input.addEventListener("change", () => {
      const f = input.files?.[0];
      if (f === undefined) {
        resolve(null);
        return;
      }
      if (f.size > MAX_REPLAY_CHARS) {
        toast?.(`Replay rejected: file exceeds the 2 MB cap (${f.size} bytes)`);
        resolve(null);
        return;
      }
      f.text().then(
        (text) => resolve(text),
        () => resolve(null),
      );
    });
    input.click();
  });
}

// Phase-4 closure: the toast lists the problems themselves (first three) —
// there is no separate details view.
function issueSummary(
  issues: ReadonlyArray<{ code: string; path: string }>,
): string {
  const n = issues.length;
  const shown = issues
    .slice(0, 3)
    .map((i) => `${i.code}${i.path === "" ? "" : ` at ${i.path}`}`)
    .join("; ");
  return `${n} replay problem${n === 1 ? "" : "s"}: ${shown}${n > 3 ? `; +${n - 3} more` : ""}`;
}

// resumeSession: parse → fold-validate → mount a fresh shell of the right
// shape → graft the validated history (transactions + fold states) and move
// the cursor. Returns false (with a toast) on any failure; the live session
// is untouched until validation passes.
export function resumeSession(
  shell: Shell,
  text: string,
  toast: (m: string) => void,
): boolean {
  if (looksLikeExperiment(text)) {
    return resumeExperiment(shell, text, toast);
  }
  const parsed = parseReplayFile(text);
  if (!parsed.ok) {
    toast(
      `Replay rejected: ${issueSummary(parsed.issues)}`,
    );
    return false;
  }
  const validated = validateReplay(parsed.file, shell.ctx);
  if (!validated.ok) {
    toast(
      `Replay rejected: ${issueSummary(validated.issues)}`,
    );
    return false;
  }
  const file = parsed.file;
  // Audit (replay audit #5): the session's window is the FILE's window —
  // it validated under it, and re-export must write the same one (else a
  // resumed out-of-default-window session exports a self-invalid file).
  // showEntry() restores the default for the next fresh session.
  (shell.ctx.config as { window: typeof file.config.window }).window =
    file.config.window;
  if (file.strategy === null) {
    shell.startSandbox(file.config.k, file.config.gameMode === "bichromatic" ? "bichromatic" : "monochromatic");
  } else {
    shell.startBreak(file.strategy.id, file.strategyStart ?? undefined);
  }
  const store = shell.store;
  store.clear();
  let dropped = false;
  // ONE publish for the whole load (audit / replay audit #4).
  store.batch(() => {
    for (const t of file.transactions) {
      const st = validated.states.get(t.txnId);
      if (st === undefined) {
        dropped = true;
        return;
      }
      const txn: ActionTransaction = {
        txnId: t.txnId,
        parentTxnId: t.parentTxnId,
        action: t.action,
        events: t.events,
        beforeHash: t.beforeHash,
        afterHash: t.afterHash,
        // the stored outcome is NOT trusted into the live session (its
        // uncovered MoveSpec is compared by kind only); rebuild it from the
        // re-derived state so nothing unvalidated reaches the store.
        result:
          st.terminal === null
            ? { kind: "committed" }
            : { kind: "terminal", terminal: st.terminal },
      };
      store.append(txn, st);
    }
    store.catchUpCounters();
    store.setCursor(validated.cursor);
  });
  if (dropped) {
    toast(
      "Replay rejected: fold dropped a transaction — implementation error",
    );
    return false;
  }
  shell.render();
  return true;
}

// forkSession: the root-to-cursor prefix chain as its own replay download
// (adversarial-regression artifact, §12.6/§27). Prefix chains preserve all
// linkage invariants, so the artifact re-validates by construction.
export function forkSession(
  shell: Shell,
  toast: (m: string) => void,
  label?: string,
): void {
  try {
    const store = shell.store;
    const cursor = store.cursorTxnId();
    const chain = new Set<number>();
    let c: number | null = cursor;
    for (;;) {
      if (c === null) {
        break;
      }
      chain.add(c);
      c = store.parentOf(c);
    }
    const state = store.current();
    const txn0 = store.stateAtTxn(0);
    const strategyId = state.strategy?.strategyId ?? null;
    const tree = shell.store.tree();
    const file = assembleReplayFile(
      {
        events: tree.events.filter((e) => chain.has(e.txnId)),
        transactions: tree.transactions.filter((t) => chain.has(t.txnId)),
      },
      cursor,
      {
        k: state.k,
        mode: state.mode,
        ...gameModeField(state),
        window: shell.ctx.config.window,
        strategyId,
        strategyStart: strategyStartForExport(txn0),
        meta: stamp(label ?? `fork at t${cursor}`),
        engineVersion: pkg.version,
      },
      shell.ctx,
    );
    downloadReplay(
      `playing-the-proof-fork-t${cursor}.replay.json`,
      serializeReplay(file as ReplayFile),
    );
    toast(`Fork downloaded: playing-the-proof-fork-t${cursor}.replay.json`);
  } catch {
    toast("Fork failed — implementation error");
  }
}

// ---- autosave (ui/dispatch calls saveAutosave after every commit) ----

function autosaveKey(mode: string, strategyId: string | null): string {
  return `${AUTOSAVE_PREFIX}${mode}.${strategyId ?? "sandbox"}`;
}

let autosaveAlive = true;
let autosaveWarned = false;

export function saveAutosave(
  store: Store,
  ctx: RuntimeCtx,
  toast: (m: string) => void,
): void {
  if (!autosaveAlive) {
    return;
  }
  try {
    if (typeof localStorage === "undefined") {
      autosaveAlive = false;
      return;
    }
    const state: GameState = store.current();
    const txn0 = store.stateAtTxn(0);
    const strategyId = state.strategy?.strategyId ?? null;
    const file = assembleReplayFile(
      store.tree(),
      store.cursorTxnId(),
      {
        k: state.k,
        mode: state.mode,
        ...gameModeField(state),
        window: ctx.config.window,
        strategyId,
        strategyStart: strategyStartForExport(txn0),
        meta: stamp(
          `autosave ${state.mode}${strategyId === null ? "" : ` ${strategyId}`} t${store.cursorTxnId()}`,
        ),
        engineVersion: pkg.version,
      },
      ctx,
    );
    const serialized = serializeReplay(file as ReplayFile);
    // Audit (replay audit #11): never write an autosave the loader
    // would refuse (2 MB cap) — skip it with one notice instead.
    if (utf8Bytes(serialized) > MAX_REPLAY_CHARS) {
      toast("Autosave skipped: this session exceeds the 2 MB replay cap.");
      return;
    }
    localStorage.setItem(autosaveKey(state.mode, strategyId), serialized);
  } catch {
    autosaveAlive = false;
    if (!autosaveWarned) {
      autosaveWarned = true;
      toast("Autosave disabled: storage unavailable.");
    }
  }
}

export interface AutosaveEntry {
  key: string;
  label: string;
  mode: string;
  strategy: string | null;
}

export function listAutosaves(): AutosaveEntry[] {
  const out: AutosaveEntry[] = [];
  try {
    if (typeof localStorage === "undefined") {
      return out;
    }
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key === null || !key.startsWith(AUTOSAVE_PREFIX)) {
        continue;
      }
      const raw = localStorage.getItem(key);
      if (raw === null) {
        continue;
      }
      try {
        const doc = JSON.parse(raw) as {
          meta?: { label?: string };
          config?: { mode?: string };
          strategy?: { id?: string } | null;
        };
        out.push({
          key,
          label: typeof doc.meta?.label === "string" ? doc.meta.label : key,
          mode: typeof doc.config?.mode === "string" ? doc.config.mode : "?",
          strategy: doc.strategy?.id ?? null,
        });
      } catch {
        continue;
      }
    }
  } catch {
    return out;
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : 1));
}

export function readAutosave(key: string): string | null {
  try {
    if (typeof localStorage === "undefined") {
      return null;
    }
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
