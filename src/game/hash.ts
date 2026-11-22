// game/hash.ts — canonical hashing: FNV-1a-64 over the §15.4 canonical
// serialization (explicit field order; "n/d" rationals; no timestamps, no
// floats, no key-order dependence). Pure.
import type { HoleAnalysis } from "../geometry/holes.ts";
import { isUnitBias } from "./turnorder.ts";
import type {
  Binding,
  GameState,
  Terminal,
} from "./types.ts";

const FNV_OFFSET = 14695981039346656037n;
const FNV_PRIME = 1099511628211n;
const MASK64 = 0xffffffffffffffffn;

function hashBytes(bytes: Uint8Array): bigint {
  let h = FNV_OFFSET;
  for (const byte of bytes) {
    h = (h ^ BigInt(byte)) * FNV_PRIME;
    h = h & MASK64;
  }
  return h;
}

function encodeBinding(value: Binding): string {
  if (typeof value === "string") {
    return `id:${value}`;
  }
  if (Array.isArray(value)) {
    return `[${value.map((id) => `id:${id}`).join(",")}]`;
  }
  return value.toString(); // Rat — always contains "/" ("n/d")
}

function encodeTerminal(terminal: Terminal): string {
  if (terminal.kind === "maker-won") {
    const holes = terminal.witness
      .map((hole) => hole.verts.join(","))
      .join(";");
    return `maker-won|${terminal.k}|${holes}|${terminal.nodeId}`;
  }
  if (terminal.kind === "strategy-integrity-failure") {
    const r = terminal.report;
    const f = r.failed;
    const analysis =
      f.analysis === undefined ? "" : JSON.stringify(analysisRecord(f.analysis));
    return `integrity|${r.failedAt}|${r.phase}|${f.id}|${f.kind}|${String(f.passed)}|${f.detail}|${analysis}|${r.stateHash}`;
  }
  const r = terminal.report;
  if (r.origin === "breaker-reply") {
    return `uncovered|breaker|${r.reason}|${r.at.nodeId}|${r.at.breakerPoint}|${r.detail}`;
  }
  return `uncovered|maker|${r.reason}|${r.at.nodeId}|${r.at.move.kind}|${r.detail}`;
}

// HoleAnalysis carries id-list holes only — JSON-safe by construction.
function analysisRecord(analysis: HoleAnalysis): unknown {
  switch (analysis.kind) {
    case "exhaustive":
      return {
        kind: analysis.kind,
        k: analysis.k,
        holes: analysis.holes.map((h) => ({ k: h.k, verts: [...h.verts] })),
      };
    case "witness-only":
      return {
        kind: analysis.kind,
        k: analysis.k,
        witness: {
          k: analysis.witness.k,
          verts: [...analysis.witness.verts],
        },
        stoppedBy: analysis.stoppedBy,
      };
    case "budget-exhausted":
      return {
        kind: analysis.kind,
        k: analysis.k,
        searched: analysis.searched,
      };
  }
}

export function canonicalStateString(state: GameState): string {
  const points = state.points
    .map((p) => `${p.id}|${p.owner}|${p.pt.x.toString()}|${p.pt.y.toString()}|${p.move}`)
    .join(";");
  const rt = state.strategy;
  const strategy =
    rt === null
      ? "null"
      : [
          rt.strategyId,
          rt.version,
          rt.nodeId,
          Object.keys(rt.vars)
            .sort()
            .map((name) => `${name}=${encodeBinding(rt.vars[name] as Binding)}`)
            .join(","),
          rt.lastCase ?? "",
        ].join("|");
  const terminal =
    state.terminal === null ? "null" : encodeTerminal(state.terminal);
  // The game mode contributes a line ONLY when bichromatic: monochromatic
  // states (the shipped game, every stored replay and golden) serialize
  // exactly as before the flag existed, so their hashes cannot move.
  const gameMode =
    state.gameMode === "bichromatic" ? ["gamemode:bichromatic"] : [];
  // Likewise the bias contributes a line ONLY when it differs from 1:1.
  const bias =
    state.bias !== undefined && !isUnitBias(state.bias)
      ? [`bias:${state.bias.toString()}`]
      : [];
  return [
    `seq:${state.seq}`,
    `k:${state.k}`,
    `mode:${state.mode}`,
    ...gameMode,
    ...bias,
    `points:${points}`,
    `turn:${state.turn}`,
    `terminal:${terminal}`,
    `strategy:${strategy}`,
  ].join("\n");
}

export function stateHash(state: GameState): string {
  const bytes = new TextEncoder().encode(canonicalStateString(state));
  return hashBytes(bytes).toString(16).padStart(16, "0");
}
