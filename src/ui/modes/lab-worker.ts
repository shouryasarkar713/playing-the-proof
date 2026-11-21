// ui/modes/lab-worker.ts — runs one bounded Parameter Lab simulation off the
// main thread. Request { cfg, settings } (wire-encoded), response
// { ok: true, result } or { ok: false, message }. The page terminates the
// worker to stop it.
import { runSimulation } from "../../lab/index.ts";
import type { LabConfig } from "../../lab/index.ts";
import type { LabSimSettings } from "../experiment-io.ts";
import { decodeWire, encodeWire } from "../wire.ts";

interface WorkerScope {
  onmessage: ((ev: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (ev: MessageEvent): void => {
  try {
    const d = ev.data as { cfg: unknown; settings: LabSimSettings };
    const cfg = decodeWire(d.cfg) as LabConfig;
    const result = runSimulation(cfg, {
      seed: d.settings.seed,
      makerPolicy: d.settings.makerPolicy,
      breakerPolicy: d.settings.breakerPolicy,
      maxRounds: d.settings.maxRounds,
      opsBudget: d.settings.opsBudget,
    });
    scope.postMessage({ ok: true, result: encodeWire(result) });
  } catch (e) {
    scope.postMessage({ ok: false, message: e instanceof Error ? e.message : "simulation failed" });
  }
};
