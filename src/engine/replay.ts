// engine/replay.ts — replay assembly + MoveSpec codec bridges (§15.5).
// The session layer owns store/tree/cursor primitives but cannot see
// strategy/ (§18.1), while the v2 wire format needs the full MoveSpec for
// uncovered maker-construction terminals. So the pure ReplayFile assembly
// lives here (engine sees strategy/): tree + cursor + launch params in,
// ReplayFile-shaped data out. The return type is this module's own
// structural interface (engine may not import replay/ even for types —
// tests prove assignability to ReplayFile). No store, no DOM, no I/O.
import type { Rat } from "../geometry/rat.ts";
import { normalizeBias } from "../game/turnorder.ts";
import type { Pt } from "../geometry/pt.ts";
import type {
  GameMode,
  GameState,
  MoveEvent,
  Player,
  StrategyStart,
  Terminal,
} from "../game/types.ts";
import type { SessionTree } from "../game/types.ts";
import type { MoveSpec, StrategyDef } from "../strategy/types.ts";
import { nodeOf } from "../strategy/runtime.ts";
import type { RuntimeCtx } from "./orchestrator.ts";

export { moveSpecFromJSON, moveSpecToJSON } from "../strategy/registry.ts";
export type { MoveSpecJSON } from "../strategy/types.ts";

export interface AssembledAction {
  kind: "init";
}

export interface AssembledPlace {
  kind: "place";
  owner: Player;
  at: Pt;
}

export interface AssembledSample {
  kind: "sample";
  caseId: string;
  at: Pt;
}

export interface AssembledTxn {
  txnId: number;
  parentTxnId: number | null;
  action: AssembledAction | AssembledPlace | AssembledSample;
  events: readonly MoveEvent[];
  beforeHash: string | null;
  afterHash: string;
  result: { kind: "committed" } | { kind: "terminal"; terminal: Terminal };
}

export interface AssembledReplay {
  format: "esmb-replay";
  // 2 for every monochromatic session (byte-identical to the pre-flag
  // format); 3 exactly when config.gameMode is present (bichromatic).
  version: 2 | 3 | 4;
  meta: { createdAt: string; app: string; appVersion: string; label?: string };
  config: {
    k: 3 | 4 | 5 | 6 | 7 | 8;
    mode: "proof" | "break" | "sandbox";
    gameMode?: GameMode;
    bias?: Rat;
    window: { xMin: Rat; yMin: Rat; xMax: Rat; yMax: Rat };
  };
  strategy: { id: string; version: string } | null;
  strategyStart: StrategyStart | null;
  transactions: AssembledTxn[];
  cursorTxnId: number;
  engineVersion: string;
  strategyVersion: string;
}

export interface AssembleOpts {
  k: 3 | 4 | 5 | 6 | 7 | 8;
  mode: "proof" | "break" | "sandbox";
  // Optional; absent === "monochromatic" (writes format v2 unchanged).
  gameMode?: GameMode;
  // Optional; absent (or 1:1) === unbiased. A bias other than 1:1 writes v4.
  bias?: Rat;
  window: { xMin: Rat; yMin: Rat; xMax: Rat; yMax: Rat };
  strategyId: string | null;
  strategyStart: StrategyStart | null;
  meta: { createdAt: string; app: string; appVersion: string; label?: string };
  engineVersion: string;
  cursorTxnId?: number;
}

// assembleReplayFile (§15.5 export assembly): pure data projection of the
// committed tree + launch params. States are never serialized (§5.6);
// events are the engine's recorded MoveEvents verbatim.
export function assembleReplayFile(
  tree: SessionTree,
  cursor: number,
  opts: AssembleOpts,
  ctx: RuntimeCtx,
): AssembledReplay {
  let strategy: { id: string; version: string } | null = null;
  let strategyVersion = "";
  let def: StrategyDef | null = null;
  if (opts.strategyId !== null) {
    const reg = ctx.strategies.get(opts.strategyId);
    if (reg === undefined) {
      throw new Error(
        `assembleReplayFile: unknown strategyId ${opts.strategyId} — implementation error`,
      );
    }
    strategy = { id: reg.def.id, version: reg.def.version };
    strategyVersion = reg.def.version;
    def = reg.def;
  }
  // Lowest format version that can express the session: v2 = monochromatic
  // 1:1, v3 = bichromatic 1:1, v4 = any bias other than 1:1 (carries both
  // gameMode and bias explicitly).
  const bias = normalizeBias(opts.bias);
  const bichromatic = opts.gameMode === "bichromatic";
  const version: 2 | 3 | 4 = bias !== undefined ? 4 : bichromatic ? 3 : 2;
  return {
    format: "esmb-replay",
    version,
    meta: { ...opts.meta },
    config: {
      k: opts.k,
      mode: opts.mode,
      ...(version >= 3
        ? { gameMode: bichromatic ? ("bichromatic" as const) : ("monochromatic" as const) }
        : {}),
      ...(bias !== undefined ? { bias } : {}),
      window: { ...opts.window },
    },
    strategy,
    strategyStart: opts.strategyStart,
    transactions: tree.transactions.map((t) => ({
      txnId: t.txnId,
      parentTxnId: t.parentTxnId,
      action: t.action,
      events: t.events,
      beforeHash: t.beforeHash,
      afterHash: t.afterHash,
      result:
        t.result.kind === "committed"
          ? { kind: "committed" as const }
          : { kind: "terminal" as const, terminal: expandTerminal(t.result.terminal, def) },
    })),
    cursorTxnId: opts.cursorTxnId ?? cursor,
    engineVersion: opts.engineVersion,
    strategyVersion,
  };
}

// expandTerminal: uncovered maker-construction reports carry the kind-only
// move ref at runtime; the wire form needs the full MoveSpec, resolved
// here from the def (fail-loud — live states always resolve).
function expandTerminal(terminal: Terminal, def: StrategyDef | null): Terminal {
  if (terminal.kind !== "uncovered" || terminal.report.origin !== "maker-construction") {
    return terminal;
  }
  if (def === null) {
    throw new Error("expandTerminal: maker-construction report without a def — implementation error");
  }
  const node = nodeOf(def, terminal.report.at.nodeId);
  if (node.move === undefined) {
    throw new Error(
      `expandTerminal: node ${terminal.report.at.nodeId} has no move — implementation error`,
    );
  }
  const move: MoveSpec = node.move;
  return {
    kind: "uncovered",
    report: {
      ...terminal.report,
      at: { nodeId: terminal.report.at.nodeId, move },
    },
  };
}

// strategyStartForExport (§15.5): k6 sessions must carry their §24.0b
// record, but committed states don't retain it. Re-derive an EQUIVALENT
// continue record from the txn-0 state (points/owners verbatim, selectedHole
// = the bound P5): canonical sorting is idempotent and P2 re-validates the
// same hole, so the re-derived record folds to the identical initial state.
// Returns null for non-bootstrap sessions (k5/fixture/sandbox).
export function strategyStartForExport(txn0: GameState): StrategyStart | null {
  const rt = txn0.strategy;
  if (rt === null) {
    return null;
  }
  // The bound start hole is P{k-1} (esmb-k6: P5, esmb-k7: P6).
  const p5 = rt.vars[`P${txn0.k - 1}`];
  if (!Array.isArray(p5)) {
    return null;
  }
  const byId = new Map(txn0.points.map((p) => [p.id, p.pt]));
  const hole: Pt[] = [];
  for (const id of p5) {
    const q = byId.get(id);
    if (q === undefined) {
      return null;
    }
    hole.push(q);
  }
  return {
    kind: "continue",
    points: txn0.points.map((p) => p.pt),
    owners: txn0.points.map((p) => p.owner),
    selectedHole: hole,
  };
}
