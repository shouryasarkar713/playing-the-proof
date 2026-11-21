// tests/ui/worker-protocol.test.ts — the request/response protocol of the
// explorer and lab workers, exercised with an in-process stand-in for Worker
// (the real workers are checked in the production-build browser pass).
import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { runSimulation } from "../../src/lab/index.ts";
import type { LabConfig, SimResult } from "../../src/lab/index.ts";
import { runExplorer, runExplorerAsync } from "../../src/ui/kstrip-core.ts";
import type { ExplorerParams, ExplorerRun } from "../../src/ui/kstrip-core.ts";
import { configFromInputs, runLabSimAsync } from "../../src/ui/lab-core.ts";
import { decodeWire, encodeWire } from "../../src/ui/wire.ts";

class FakeWorker {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  terminated = false;
  private readonly handler: (data: unknown) => unknown;
  private readonly fail: boolean;
  constructor(handler: (data: unknown) => unknown, fail = false) {
    this.handler = handler;
    this.fail = fail;
  }
  postMessage(data: unknown): void {
    setTimeout(() => {
      if (this.terminated) return;
      if (this.fail) {
        this.onerror?.({});
        return;
      }
      this.onmessage?.({ data: this.handler(JSON.parse(JSON.stringify(data))) } as MessageEvent);
    }, 0);
  }
  terminate(): void {
    this.terminated = true;
  }
}

const P: ExplorerParams = { variant: "mono-1:1", k: 3, t: 1, s: null, policy: "strategy-aware", seed: 1 };

describe("explorer worker protocol", () => {
  const handler = (data: unknown): unknown => {
    const params = (data as { params: ExplorerParams }).params;
    return { ok: true, run: encodeWire(runExplorer(params)) };
  };

  it("returns the same run through the wire encoding", async () => {
    const w = new FakeWorker(handler);
    const run = await new Promise<ExplorerRun>((res, rej) => {
      runExplorerAsync(P, res, rej, () => w as unknown as Worker, (v) => decodeWire(v) as ExplorerRun);
    });
    const direct = runExplorer(P);
    expect(run.status).toBe("completed");
    expect(run.log.map((e) => e.pt.x.toString() + e.pt.y.toString())).toEqual(
      direct.log.map((e) => e.pt.x.toString() + e.pt.y.toString()),
    );
    expect(w.terminated).toBe(true);
  });

  it("cancel terminates the worker and nothing is delivered", async () => {
    const w = new FakeWorker(handler);
    let delivered = false;
    const h = runExplorerAsync(P, () => (delivered = true), () => (delivered = true), () => w as unknown as Worker, (v) => v as ExplorerRun);
    h.cancel();
    await new Promise((r) => setTimeout(r, 20));
    expect(w.terminated).toBe(true);
    expect(delivered).toBe(false);
  });

  it("a worker that fails to start is reported, and the Worker-less fallback still runs", async () => {
    const w = new FakeWorker(handler, true);
    const err = await new Promise<string>((res) => {
      runExplorerAsync(P, () => res("done"), res, () => w as unknown as Worker, (v) => v as ExplorerRun);
    });
    expect(err).toBe("the worker failed to start");
    const run = await new Promise<ExplorerRun>((res, rej) => {
      runExplorerAsync(P, res, rej, null);
    });
    expect(run.status).toBe("completed");
  });

  it("a worker error message is surfaced", async () => {
    const w = new FakeWorker(() => ({ ok: false, message: "boom" }));
    const msg = await new Promise<string>((res) => {
      runExplorerAsync(P, () => res("done"), res, () => w as unknown as Worker, (v) => v as ExplorerRun);
    });
    expect(msg).toBe("boom");
  });
});

describe("lab worker protocol", () => {
  const cfg: LabConfig = { model: "online", rule: "bichromatic", k: 7, bias: Rat.make(2n), encodingId: null, structures: 1 };
  const settings = { seed: 2, makerPolicy: "random-legal", breakerPolicy: "random-legal", maxRounds: 3, opsBudget: 3_000_000 } as const;

  it("returns the same observation through the wire encoding", async () => {
    const w = new FakeWorker((data) => {
      const d = data as { cfg: unknown; settings: typeof settings };
      const c = decodeWire(d.cfg) as LabConfig;
      return { ok: true, result: encodeWire(runSimulation(c, d.settings)) };
    });
    const res = await new Promise<SimResult>((ok, bad) => {
      runLabSimAsync(cfg, settings, ok, bad, () => w as unknown as Worker, (v) => decodeWire(v) as SimResult, (c) => encodeWire(c));
    });
    const direct = runSimulation(cfg, settings);
    expect(res.kind).toBe(direct.kind);
    if (res.kind !== "unsupported" && direct.kind !== "unsupported") {
      expect(res.observed.transcript).toEqual(direct.observed.transcript);
      expect(res.notAGuarantee).toBe(true);
    }
  });

  it("fallback (no Worker) honours cancel before the run starts", async () => {
    let delivered = false;
    const h = runLabSimAsync(cfg, settings, () => (delivered = true), () => (delivered = true), null, (v) => v as SimResult, (c) => c);
    h.cancel();
    await new Promise((r) => setTimeout(r, 20));
    expect(delivered).toBe(false);
  });
});

describe("lab input validation", () => {
  const ok = { model: "online", rule: "monochromatic", k: "5", bias: "1", encoding: "", structures: "1" };
  const bounds = { kMin: 3, kMax: 12 };
  it("accepts valid input and maps the encoding", () => {
    const r = configFromInputs({ ...ok, encoding: "esmb-k5" }, bounds);
    expect(r.ok && r.config.encodingId).toBe("esmb-k5");
    expect(r.ok && r.config.bias.toString()).toBe("1/1");
  });
  it("rejects each invalid field with its own message", () => {
    for (const [patch, frag] of [
      [{ model: "x" }, "game model"],
      [{ rule: "x" }, "rule"],
      [{ k: "2" }, "k must"],
      [{ k: "5.5" }, "k must"],
      [{ bias: "-1" }, "bias"],
      [{ bias: "1/0" }, "bias"],
      [{ bias: "99999999999999999999" }, "too large"],
      [{ structures: "0" }, "t must"],
    ] as const) {
      const r = configFromInputs({ ...ok, ...patch }, bounds);
      expect(r.ok, JSON.stringify(patch)).toBe(false);
      if (!r.ok) expect(r.message).toContain(frag);
    }
  });
});
