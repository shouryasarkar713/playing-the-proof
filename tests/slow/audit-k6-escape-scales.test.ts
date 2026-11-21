import { describe, expect, it } from "vitest";
import { checkPlacement } from "../../src/game/legality.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";
import { hull } from "../../src/geometry/hull.ts";
import { findKHoles } from "../../src/geometry/holes.ts";
import { mulberry32, testCtx } from "../helpers.ts";
import { ensureK6, forcedRegion, centroidOf, randomPentagon } from "../strategies/k6driver.ts";
ensureK6();
describe("audit slow: k6 escape across scales and B0 positions", () => { it("every game forms twins (parks at k6:r5:classify): scales 1e-5…5000, B0 sharp near forced-region boundary", { timeout: 3000000 }, () => {
  const rand = mulberry32(2718); const ctx = testCtx();
  const tally: Record<string, number> = {}; const bump = (k: string) => { tally[k] = (tally[k] ?? 0) + 1; };
  const notes: string[] = [];
  const N = Number(process.env["N"] ?? 100);
  for (let g = 0; g < N; g += 1) {
    const scales = [Rat.make(1n, 1000n), Rat.make(1n, 100000n), Rat.make(1n), Rat.make(1n, 10n), Rat.make(5000n)];
    const sc = scales[g % scales.length]!;
    const pent = hull([...randomPentagon(rand)].map((p) => pt(p.x.mul(sc), p.y.mul(sc))));
    const extras: Pt[] = [];
    const pts = [...pent, ...extras]; void extras;
    const store = new Store();
    const st = startSession({ kind: "guided", config: { mode: "break", window: ctx.config.window }, strategyId: "esmb-k6", mode: "break", strategyStart: { kind: "supplied", points: pts, selectedHole: [...pent] } }, ctx, store);
    if (st.status !== "accepted") { bump("boot-rejected:" + (st.error?.code ?? "?")); continue; }
    if (store.current().terminal) { bump("boot-terminal"); continue; }
    const fr = forcedRegion(pent);
    const pw = [1, 4, 10][g % 3]!;
    const wsx = fr.map(() => BigInt(Math.max(1, Math.round((Math.pow(rand(), pw) + 1e-5) * 1000000))));
    const tt = wsx.reduce((a, b) => a + b, 0n);
    let bx = Rat.ZERO, by = Rat.ZERO;
    fr.forEach((p, i) => { const w = Rat.make(wsx[i]!, tt); bx = bx.add(p.x.mul(w)); by = by.add(p.y.mul(w)); });
    const b0 = pt(bx, by); void centroidOf;
    if (checkPlacement(store.current(), b0, ctx.config.window) !== null) { bump("b0-illegal"); continue; }
    const act = { kind: "place" as const, owner: "breaker" as const, at: b0 };
    commit(reduceTransaction(store.current(), act, ctx), act, store, ctx);
    const c = store.current();
    const key = `scale${sc.toString()}:` + (c.terminal ? `afterB0:${c.terminal.kind}` : `parked:${c.strategy?.nodeId}`);
    bump(key);
    if (c.terminal?.kind === "strategy-integrity-failure" || c.terminal?.kind === "uncovered") {
      if (notes.length < 6) notes.push(`g${g} ${key} ${c.terminal.kind === "strategy-integrity-failure" ? c.terminal.report.failed.id + ": " + c.terminal.report.failed.detail : JSON.stringify(c.terminal.report).slice(0,160)} pts=${pts.map(p => p.x.toString()+","+p.y.toString()).join(" ")}`);
    }
    void findKHoles;
  }
  for (const key of Object.keys(tally)) {
    expect(key.endsWith("parked:k6:r5:classify")).toBe(true);
  }
  expect(Object.values(tally).reduce((a, b) => a + b, 0)).toBe(N);
  void notes;
}); });
