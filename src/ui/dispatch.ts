// ui/dispatch.ts — the ONLY effectful entry (plus the launcher's
// startSession call and ui/replay-io, §15.5). Thin: reduce → commit →
// autosave; rejections surface as toasts; nothing else happens here.
import { reduceTransaction } from "../engine/orchestrator.ts";
import type { EngineResult, RuntimeCtx } from "../engine/orchestrator.ts";
import { commit } from "../session/commit.ts";
import type { Store } from "../session/store.ts";
import type { Rejection, UserAction } from "../game/types.ts";
import { OUT_OF_TURN_TEXT } from "../explain/bias.ts";
import { saveAutosave } from "./replay-io.ts";

export function dispatch(
  store: Store,
  ctx: RuntimeCtx,
  action: UserAction,
  toast: (message: string) => void,
): EngineResult {
  const r = reduceTransaction(store.current(), action, ctx);
  if (r.status === "rejected") {
    const rej = r.diagnostics.find((d) => d.kind === "rejection");
    toast(
      rej !== undefined && rej.kind === "rejection"
        ? rejectionText(rej.rejection)
        : "Illegal move.",
    );
    return r;
  }
  commit(r, action, store, ctx);
  // Autosave (§15.5 — after every committed transaction; failures disable
  // themselves with a single notice, never a crash).
  saveAutosave(store, ctx, toast);
  return r;
}

// §4.4 reason chips — math vs [UI] tags, never conflated.
export function rejectionText(rejection: Rejection): string {
  switch (rejection.reason) {
    case "outside-window":
      return "Outside this build's play window (UI convenience).";
    case "coincides-with-existing-point":
      return `Mathematical rule: points must differ (coincides with ${rejection.with}).`;
    case "collinear-with":
      return `Mathematical rule: no three collinear points (with ${rejection.pair[0]}, ${rejection.pair[1]}).`;
    case "ui-too-close":
      return "UI convenience: points too close to display.";
    case "wrong-turn":
      return rejection.detail === "game-over"
        ? "The game is over — rewind or start again."
        : rejection.detail === "point-cap"
          ? "Point cap reached (64 points) — the exact analysis is only specified up to that size."
          : rejection.detail === "out-of-turn"
            ? OUT_OF_TURN_TEXT
            : "Only Breaker places points here; Maker's replies are automatic.";
  }
}
