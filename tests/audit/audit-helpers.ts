// tests/audit/audit-helpers.ts — shared scaffolding for the independent
// engine/session/replay audit tests (replay-*.test.ts, lifecycle-*.test.ts).
// Not a test file itself. Evidence is written with node:fs (vitest swallows
// console.log) to AUDIT_EVIDENCE_DIR (default: <os tmp>/ptp-audit-evidence).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import type { UserAction } from "../../src/game/types.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import type { RuntimeCtx } from "../../src/engine/orchestrator.ts";
import type { InitRequest } from "../../src/engine/init.ts";
import { assembleReplayFile, strategyStartForExport } from "../../src/engine/replay.ts";
import { serializeReplay } from "../../src/replay/format.ts";
import type { ReplayFile } from "../../src/replay/format.ts";
import { testCtx } from "../helpers.ts";

export const REPLAY_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "data",
  "replays",
);

export const EVIDENCE_DIR =
  process.env["AUDIT_EVIDENCE_DIR"] ?? join(tmpdir(), "ptp-audit-evidence");

export function evidence(name: string, value: unknown): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(
    join(EVIDENCE_DIR, `${name}.json`),
    JSON.stringify(value, null, 2),
    "utf8",
  );
}

export function readEvidence(name: string): unknown {
  return JSON.parse(readFileSync(join(EVIDENCE_DIR, `${name}.json`), "utf8"));
}

export function readReplayText(name: string): string {
  return readFileSync(join(REPLAY_DIR, name), "utf8");
}

export function replayDoc(name: string): Record<string, unknown> {
  return JSON.parse(readReplayText(name)) as Record<string, unknown>;
}

export function txnsOf(doc: Record<string, unknown>): Record<string, unknown>[] {
  return doc["transactions"] as Record<string, unknown>[];
}

export function P(x: number, y: number): Pt {
  return pt(Rat.make(BigInt(x)), Rat.make(BigInt(y)));
}

export function newSession(
  request: InitRequest,
  ctx: RuntimeCtx = testCtx(),
): { store: Store; ctx: RuntimeCtx } {
  const store = new Store();
  const started = startSession(request, ctx, store);
  if (started.status !== "accepted") {
    throw new Error("audit-helpers: session start rejected");
  }
  return { store, ctx };
}

export function sandboxRequest(ctx: RuntimeCtx, k: 3 | 4 | 5 | 6 | 7 | 8 = 5): InitRequest {
  return { kind: "sandbox", config: { mode: "sandbox", window: ctx.config.window }, k };
}

export function guidedRequest(ctx: RuntimeCtx, strategyId: string): InitRequest {
  return {
    kind: "guided",
    config: { mode: "break", window: ctx.config.window },
    strategyId,
    mode: "break",
  };
}

// reduce + commit one user action (no autosave, no UI).
export function step(store: Store, ctx: RuntimeCtx, action: UserAction): ReturnType<typeof reduceTransaction> {
  const r = reduceTransaction(store.current(), action, ctx);
  if (r.status === "accepted") {
    commit(r, action, store, ctx);
  }
  return r;
}

export function exportText(store: Store, ctx: RuntimeCtx, label = "audit"): string {
  const state = store.current();
  const file = assembleReplayFile(
    store.tree(),
    store.cursorTxnId(),
    {
      k: state.k,
      mode: state.mode,
      window: ctx.config.window,
      strategyId: state.strategy?.strategyId ?? null,
      strategyStart: strategyStartForExport(store.stateAtTxn(0)),
      meta: { createdAt: "2026-01-01T00:00:00.000Z", app: "audit", appVersion: "0.0.0", label },
      engineVersion: "0.0.0",
    },
    ctx,
  );
  return serializeReplay(file as ReplayFile);
}

// Deterministic non-collinear integer-grid points for sandbox games.
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
