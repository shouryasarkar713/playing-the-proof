// ui/modes/kstrip-worker.ts — runs one traced k-strip run off the main thread.
// Request: { params }. Response: { ok: true, run } (wire-encoded, see
// ui/wire.ts) or { ok: false, message }. The page terminates the worker to
// cancel; nothing is shared.
import { runExplorer } from "../kstrip-core.ts";
import type { ExplorerParams } from "../kstrip-core.ts";
import { encodeWire } from "../wire.ts";

interface WorkerScope {
  onmessage: ((ev: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (ev: MessageEvent): void => {
  try {
    const params = (ev.data as { params: ExplorerParams }).params;
    const run = runExplorer(params);
    scope.postMessage({ ok: true, run: encodeWire(run) });
  } catch (e) {
    scope.postMessage({ ok: false, message: e instanceof Error ? e.message : "run failed" });
  }
};
