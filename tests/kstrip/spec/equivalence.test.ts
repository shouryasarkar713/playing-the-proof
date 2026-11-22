// The equivalence / regression proof: for every verified configuration and
// every shipped Breaker policy, the declarative spec interpreter produces the
// SAME run as the reference executor runKStrip — byte-identical move logs
// (canonical JSON), statuses, messages, levels, checks, claims.
import { describe, expect, it } from "vitest";
import { runSpec, KSTRIP_SPECS, serializeLog } from "../../../src/kstrip/spec/index.ts";
import { POLICIES, configsOf, fingerprint, legacy, paramsOf } from "./helpers.ts";

describe("spec interpreter == runKStrip (byte-identical)", () => {
  for (const spec of KSTRIP_SPECS) {
    for (const cfg of configsOf(spec)) {
      for (const [pname, mk] of POLICIES) {
        const label = `${spec.id} k=${cfg.k} t=${cfg.t}${cfg.s === undefined ? "" : ` s=${cfg.s}`} ${pname}`;
        it(label, () => {
          const ref = legacy(spec, cfg, mk());
          const run = runSpec(spec, paramsOf(cfg), mk());
          expect(ref.status, ref.message).toBe("completed");
          expect(run.outcome, JSON.stringify(run.outcome)).toEqual({ kind: "completed" });
          expect(run.result).not.toBeNull();
          const res = run.result as NonNullable<typeof run.result>;
          expect(serializeLog(res.log)).toBe(serializeLog(ref.log));
          expect(fingerprint(res)).toBe(fingerprint(ref));
          // every certificate passed, one per executed phase
          expect(run.certificates.every((c) => c.ok)).toBe(true);
          expect(run.certificates.length).toBe(run.plan.length);
          expect(run.runPost.every((r) => r.ok)).toBe(true);
        }, 600000);
      }
    }
  }
});
