// replay/validate.ts — the §15.3 reduction fold: re-reduce every
// transaction and compare semantics. Pure: no DOM, no file/blob, no
// clipboard, no local storage, no network. Imports engine/ (init, reduce),
// game/ (hash, seq, types), geometry/ (Rat) only (§18.1).
import { Rat } from "../geometry/rat.ts";
import { stateHash } from "../game/hash.ts";
import { withSeq } from "../game/types.ts";
import type {
  GameState,
  MoveEvent,
  RawEvent,
  Terminal,
  UserAction,
} from "../game/types.ts";
import { initSession } from "../engine/init.ts";
import type { InitRequest } from "../engine/init.ts";
import { reduceTransaction } from "../engine/orchestrator.ts";
import type { RuntimeCtx } from "../engine/orchestrator.ts";
import type { ReplayFile, ValidationIssue } from "./format.ts";

export interface FoldOk {
  states: Map<number, GameState>;
  cursor: number;
}

function issue(
  path: string,
  message: string,
  expected?: string,
  actual?: string,
): ValidationIssue {
  return {
    path,
    code: "semantic-divergence",
    message,
    ...(expected !== undefined ? { expected } : {}),
    ...(actual !== undefined ? { actual } : {}),
  };
}

function hashIssue(
  path: string,
  expected: string,
  actual: string,
): ValidationIssue {
  return {
    path,
    code: "hash-mismatch",
    message: "re-derived hash differs from the stored hash",
    expected,
    actual,
  };
}

// Canonical comparison: Rat → "n/d", object keys sorted, arrays ordered.
function norm(v: unknown): unknown {
  if (v instanceof Rat) {
    return v.toString();
  }
  if (Array.isArray(v)) {
    return v.map(norm);
  }
  if (typeof v === "object" && v !== null) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      out[k] = norm((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

// stripEventMetadata (§5.8): the RawEvent projection — drop session
// metadata (i, txnId, indexInTxn, parent), compare semantics only.
export function stripEventMetadata(ev: MoveEvent): RawEvent {
  const { owner, at, appliedPoint, nodeAfter, stateHash: hash } = ev;
  return {
    owner,
    at,
    appliedPoint,
    ...(ev.caseId !== undefined ? { caseId: ev.caseId } : {}),
    nodeAfter,
    stateHash: hash,
  };
}

function terminalsMatch(regenerated: Terminal, stored: Terminal): boolean {
  if (regenerated.kind !== stored.kind) {
    return false;
  }
  if (regenerated.kind === "maker-won" && stored.kind === "maker-won") {
    return (
      regenerated.k === stored.k &&
      regenerated.nodeId === stored.nodeId &&
      sameValue(
        regenerated.witness.map((h) => [...h.verts]),
        stored.witness.map((h) => [...h.verts]),
      )
    );
  }
  if (
    regenerated.kind === "strategy-integrity-failure" &&
    stored.kind === "strategy-integrity-failure"
  ) {
    return sameValue(regenerated.report, stored.report);
  }
  if (regenerated.kind === "uncovered" && stored.kind === "uncovered") {
    const r = regenerated.report;
    const s = stored.report;
    if (r.origin !== s.origin || r.detail !== s.detail) {
      return false;
    }
    if (r.origin === "breaker-reply" && s.origin === "breaker-reply") {
      return (
        r.reason === s.reason &&
        r.at.nodeId === s.at.nodeId &&
        r.at.breakerPoint === s.at.breakerPoint
      );
    }
    if (
      r.origin === "maker-construction" &&
      s.origin === "maker-construction"
    ) {
      // The runtime report carries the kind-only move ref; the stored move
      // is the full MoveSpec — compare kind only (noted in format.ts
      // projection; the fold never consumes the move).
      const rk = (r.at.move as { kind?: unknown }).kind;
      const sk = (s.at.move as { kind?: unknown }).kind;
      return r.reason === s.reason && r.at.nodeId === s.at.nodeId && rk === sk;
    }
    return false;
  }
  return false;
}

function requestFrom(file: ReplayFile): InitRequest {
  // Only a v3 bichromatic file carries a non-default rule into the fold; v2
  // files (and v3 "monochromatic") fold with NO gameMode, exactly as before.
  const modeField =
    file.config.gameMode === "bichromatic"
      ? { gameMode: "bichromatic" as const }
      : {};
  if (file.strategy === null) {
    return {
      kind: "sandbox",
      config: {
        mode: file.config.mode as "sandbox",
        ...modeField,
        window: file.config.window,
      },
      k: file.config.k as 3 | 4 | 5 | 6 | 7 | 8,
    };
  }
  return {
    kind: "guided",
    config: {
      mode: file.config.mode as "proof" | "break",
      ...modeField,
      window: file.config.window,
    },
    strategyId: file.strategy.id,
    mode: file.config.mode as "proof" | "break",
    ...(file.strategyStart !== undefined && file.strategyStart !== null
      ? { strategyStart: file.strategyStart }
      : {}),
  };
}

export function validateReplay(
  file: ReplayFile,
  ctx: RuntimeCtx,
): ({ ok: true } & FoldOk) | { ok: false; issues: ValidationIssue[] } {
  // Invariant 5 (registry-dependent): coupling + versions. Structural
  // invariants 1–4 already hold (parse); the fold below is invariant 6.
  const issues: ValidationIssue[] = [];
  if ((file.strategy === null) !== (file.config.mode === "sandbox")) {
    issues.push({
      path: "strategy",
      code: "bad-strategy-coupling",
      message: "strategy must be null exactly for sandbox sessions",
    });
  }
  if (file.strategy !== null) {
    const reg = ctx.strategies.get(file.strategy.id);
    if (reg === undefined) {
      issues.push({
        path: "strategy.id",
        code: "bad-strategy-coupling",
        message: `unknown strategyId '${file.strategy.id}'`,
      });
    } else {
      if (reg.def.k !== file.config.k) {
        issues.push({
          path: "config.k",
          code: "bad-strategy-coupling",
          message: "config.k must equal the strategy def's k",
          expected: String(reg.def.k),
          actual: String(file.config.k),
        });
      }
      const entry = reg.def.nodes[reg.def.entry];
      const wantsStart =
        entry !== undefined && entry.role === "classify-breaker";
      if ((file.strategyStart !== null) !== wantsStart) {
        issues.push({
          path: "strategyStart",
          code: "bad-strategy-coupling",
          message:
            "strategyStart must be non-null exactly for classify-breaker entries",
        });
      }
      if (file.strategyVersion !== reg.def.version) {
        issues.push({
          path: "strategyVersion",
          code: "version-mismatch",
          message:
            "replay recorded against a different strategy version — no silent reinterpretation",
          expected: reg.def.version,
          actual: file.strategyVersion,
        });
      }
    }
  } else if (file.strategyStart !== null) {
    issues.push({
      path: "strategyStart",
      code: "bad-strategy-coupling",
      message: "sandbox sessions carry no strategyStart",
    });
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  // The file's window IS the session window (recorded at export); the fold
  // re-reduces under it. Other config (notably analysis budgets) stays
  // validator-local policy: a budget too small to reproduce an exhaustive
  // original surfaces as honest divergence.
  // Sandbox replays (no strategy): the ONLY budget-dependent output of a
  // sandbox reduction is the analysis-note diagnostic, which the fold
  // discards and no hash covers — so the exhaustive per-placement hole sweep
  // (≈0.3–0.8 s each at 30–40 points: a CPU DoS on a crafted file, replay
  // audit #1) is skipped with budget 0. Guided replays keep the validator's
  // budget: strategy enumerations depend on it (honest divergence).
  const foldCtx: RuntimeCtx = {
    ...ctx,
    config: {
      ...ctx.config,
      window: file.config.window,
      ...(file.strategy === null ? { analysis: { budgetOps: 0 } } : {}),
    },
  };
  // Invariant 6: the fold.
  const states = new Map<number, GameState>();
  const init = initSession(requestFrom(file), foldCtx);
  if (init.status !== "accepted" || init.state === undefined) {
    return {
      ok: false,
      issues: [
        {
          path: "transactions[0]",
          code: "semantic-divergence",
          message: `initSession rejected the file's launch parameters: ${init.status === "rejected" ? (init.error?.code ?? "unknown") : "no state"}`,
        },
      ],
    };
  }
  const t0 = file.transactions[0];
  if (t0 === undefined) {
    return {
      ok: false,
      issues: [
        {
          path: "transactions",
          code: "bad-tree-shape",
          message: "no transactions",
        },
      ],
    };
  }
  const final0 = withSeq(init.state, t0.txnId);
  if (stateHash(final0) !== t0.afterHash) {
    return {
      ok: false,
      issues: [
        hashIssue(`transactions[0].afterHash`, t0.afterHash, stateHash(final0)),
      ],
    };
  }
  if (t0.events.length !== 0) {
    return {
      ok: false,
      issues: [
        issue(
          `transactions[0].events`,
          "txn 0 carries zero events",
          "[]",
          `${t0.events.length} events`,
        ),
      ],
    };
  }
  const terminalKind = (t: Terminal | null): string =>
    t === null ? "committed" : t.kind;
  if (
    terminalKind(final0.terminal) !==
    (t0.result.kind === "committed" ? "committed" : t0.result.terminal.kind)
  ) {
    return {
      ok: false,
      issues: [
        issue(
          `transactions[0].result`,
          "result kind differs from the re-derived terminal",
        ),
      ],
    };
  }
  if (t0.result.kind === "terminal") {
    if (
      final0.terminal === null ||
      !terminalsMatch(final0.terminal, t0.result.terminal)
    ) {
      return {
        ok: false,
        issues: [
          issue(
            `transactions[0].result`,
            "P3-terminal bootstrap result differs from re-derivation",
          ),
        ],
      };
    }
  }
  states.set(t0.txnId, final0);
  for (let ti = 1; ti < file.transactions.length; ti += 1) {
    const txn = file.transactions[ti] as (typeof file.transactions)[number];
    const base = `transactions[${ti}]`;
    const parent = states.get(txn.parentTxnId as number);
    if (parent === undefined) {
      return {
        ok: false,
        issues: [
          {
            path: `${base}.parentTxnId`,
            code: "bad-tree-shape",
            message:
              "parent state not folded (file order violates parents-before-children)",
          },
        ],
      };
    }
    const action =
      txn.action.kind === "init" ? null : (txn.action as UserAction);
    if (action === null) {
      return {
        ok: false,
        issues: [
          {
            path: `${base}.action`,
            code: "semantic-divergence",
            message: "only txn 0 may carry init",
          },
        ],
      };
    }
    const r = reduceTransaction(parent, action, foldCtx);
    if (r.status !== "accepted" || r.nextState === undefined) {
      return {
        ok: false,
        issues: [
          issue(`${base}`, "re-reduction rejected a committed transaction"),
        ],
      };
    }
    const final = withSeq(r.nextState, txn.txnId);
    if (stateHash(final) !== txn.afterHash) {
      return {
        ok: false,
        issues: [
          hashIssue(`${base}.afterHash`, txn.afterHash, stateHash(final)),
        ],
      };
    }
    // a Proof-mode `sample` action carries the case label the user
    // picked; the engine only uses its point. The label is display metadata,
    // so it must equal the re-derived classification (else a doctored file
    // could mislabel the timeline/attack log without touching any hash).
    if (action.kind === "sample") {
      const firstCase = (r.events[0] as RawEvent | undefined)?.caseId;
      if (firstCase !== action.caseId) {
        return {
          ok: false,
          issues: [
            {
              path: `${base}.action.caseId`,
              code: "semantic-divergence",
              message: "sample caseId differs from the re-derived classification",
              expected: String(firstCase),
              actual: action.caseId,
            },
          ],
        };
      }
    }
    // Stripped-event semantic comparison (count, order, every field).
    if (r.events.length !== txn.events.length) {
      return {
        ok: false,
        issues: [
          issue(
            `${base}.events`,
            "event count differs from re-derivation",
            `${txn.events.length} stored`,
            `${r.events.length} re-derived`,
          ),
        ],
      };
    }
    for (let ei = 0; ei < r.events.length; ei += 1) {
      const regen = r.events[ei] as RawEvent;
      const stored = stripEventMetadata(txn.events[ei] as MoveEvent);
      if (!sameValue(regen, stored)) {
        return {
          ok: false,
          issues: [
            {
              path: `${base}.events[${ei}]`,
              code: "semantic-divergence",
              message:
                "stored event differs from re-derivation (metadata stripped)",
              expected: JSON.stringify(stored),
              actual: JSON.stringify(regen),
            },
          ],
        };
      }
    }
    // Outcome: committed vs terminal (+ terminal match).
    const storedTerminal =
      txn.result.kind === "terminal" ? txn.result.terminal : null;
    const regenTerminal = final.terminal;
    if (
      (storedTerminal === null) !== (regenTerminal === null) ||
      (storedTerminal !== null &&
        regenTerminal !== null &&
        !terminalsMatch(regenTerminal, storedTerminal))
    ) {
      return {
        ok: false,
        issues: [issue(`${base}.result`, "outcome differs from re-derivation")],
      };
    }
    states.set(txn.txnId, final);
  }
  // Cursor: explicit, else the largest txnId.
  let cursor = -1;
  for (const t of file.transactions) {
    if (t.txnId > cursor) {
      cursor = t.txnId;
    }
  }
  if (file.cursorTxnId !== undefined) {
    if (!states.has(file.cursorTxnId)) {
      return {
        ok: false,
        issues: [
          {
            path: "cursorTxnId",
            code: "bad-tree-shape",
            message: "cursor names no committed txn",
          },
        ],
      };
    }
    cursor = file.cursorTxnId;
  }
  return { ok: true, states, cursor };
}
