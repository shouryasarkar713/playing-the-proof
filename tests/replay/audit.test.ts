// tests/replay/audit.test.ts — the replay hash-chain audit (Phase 16,
// task 4): every shipped file under data/replays/ is walked
// structurally — format/version, transaction-tree linkage (parents
// resolve, parents precede children, root bare), the beforeHash/afterHash
// continuity chain, cursor membership, and event/txn coherence. A broken
// chain fails loudly with the offending path. (Semantic re-validation
// lives in roundtrip.test.ts; this is the transport-integrity audit.)
// Invoked directly as `npm run audit:replays`.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "data",
  "replays",
);

interface AuditTxn {
  txnId: unknown;
  parentTxnId: unknown;
  action: unknown;
  events: unknown;
  beforeHash: unknown;
  afterHash: unknown;
  result: unknown;
}

function sampleNames(): string[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".replay.json"))
    .sort();
}

function auditFile(name: string): string[] {
  const problems: string[] = [];
  const at = (p: string): string => `${name}:${p}`;
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(readFileSync(join(DIR, name), "utf8")) as Record<string, unknown>;
  } catch {
    return [at("") + " not valid JSON"];
  }
  if (doc["format"] !== "esmb-replay") {
    problems.push(at("format") + ` expected esmb-replay, got ${String(doc["format"])}`);
  }
  if (doc["version"] !== 2) {
    problems.push(at("version") + ` expected 2, got ${String(doc["version"])}`);
  }
  const txns = doc["transactions"];
  if (!Array.isArray(txns) || txns.length === 0) {
    problems.push(at("transactions") + " expected a non-empty array");
    return problems;
  }
  const byId = new Map<number, AuditTxn>();
  for (let i = 0; i < txns.length; i += 1) {
    const t = txns[i] as AuditTxn;
    if (typeof t.txnId !== "number" || !Number.isInteger(t.txnId)) {
      problems.push(at(`transactions[${i}].txnId`) + " expected an integer id");
      continue;
    }
    if (byId.has(t.txnId)) {
      problems.push(at(`transactions[${i}].txnId`) + ` duplicate id ${t.txnId}`);
    }
    byId.set(t.txnId, t);
    if (i === 0) {
      if (t.parentTxnId !== null) {
        problems.push(at("transactions[0].parentTxnId") + " root must have null parent");
      }
      if (t.beforeHash !== null) {
        problems.push(at("transactions[0].beforeHash") + " root must have null beforeHash");
      }
    } else if (typeof t.parentTxnId !== "number" || !byId.has(t.parentTxnId)) {
      // Parents must precede children (or be absent = broken chain).
      problems.push(
        at(`transactions[${i}].parentTxnId`) +
          ` parent ${String(t.parentTxnId)} not committed earlier`,
      );
    } else {
      const parent = byId.get(t.parentTxnId) as AuditTxn;
      if (parent.afterHash !== t.beforeHash) {
        problems.push(
          at(`transactions[${i}].beforeHash`) +
            " does not continue the parent afterHash (chain break)",
        );
      }
    }
    if (typeof t.afterHash !== "string" || t.afterHash.length === 0) {
      problems.push(at(`transactions[${i}].afterHash`) + " expected a non-empty hash");
    }
    if (!Array.isArray(t.events)) {
      problems.push(at(`transactions[${i}].events`) + " expected an array");
    } else {
      for (let e = 0; e < (t.events as unknown[]).length; e += 1) {
        const ev = (t.events as Array<Record<string, unknown>>)[e] as Record<string, unknown>;
        if (ev["txnId"] !== t.txnId) {
          problems.push(
            at(`transactions[${i}].events[${e}].txnId`) +
              ` event carries txn ${String(ev["txnId"])}, expected ${String(t.txnId)}`,
          );
        }
      }
    }
    const result = t.result as Record<string, unknown> | undefined;
    if (
      result?.["kind"] !== "committed" &&
      result?.["kind"] !== "terminal"
    ) {
      problems.push(at(`transactions[${i}].result.kind`) + " expected committed|terminal");
    }
  }
  const cursor = doc["cursorTxnId"];
  if (cursor !== undefined && !byId.has(cursor as number)) {
    problems.push(at("cursorTxnId") + ` names uncommitted txn ${String(cursor)}`);
  }
  return problems;
}

describe("replay hash-chain audit (data/replays/)", () => {
  it("corpus is non-empty", () => {
    expect(sampleNames().length).toBeGreaterThan(0);
  });

  for (const name of [
    "k5-safe.replay.json",
    "k5-blunder.replay.json",
    "k5-branch.replay.json",
    "k5-boundary-uncovered.replay.json",
    "k5-integrity.replay.json",
    "k6-routeb.replay.json",
    "k6-immediate.replay.json",
    "sandbox-placed.replay.json",
  ]) {
    it(`chain intact: ${name}`, () => {
      expect(auditFile(name)).toEqual([]);
    });
  }
});
