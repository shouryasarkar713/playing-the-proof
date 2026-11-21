// ui/lab-core.ts — DOM-free helpers of the Parameter Lab mode. The status of
// a configuration is NEVER derived here: it is read from lab/classify.ts and
// only mapped to its display label.
import { Rat } from "../geometry/rat.ts";
import { parseBias, runSimulation } from "../lab/index.ts";
import type {
  LabConfig,
  LabStatus,
  SimResult,
  StoppedBy,
} from "../lab/index.ts";
import type { LabSimSettings } from "./experiment-io.ts";

export const STATUS_LABEL: Readonly<Record<LabStatus, string>> = {
  THEOREM_BACKED: "THEOREM-BACKED",
  EXPERIMENTAL: "EXPERIMENTAL",
  NOT_COVERED: "NOT COVERED",
};

export const STATUS_MEANING: Readonly<Record<LabStatus, string>> = {
  THEOREM_BACKED:
    "The selected model and parameters lie inside a regime established by a cited source statement. The lab reports the citation; it does not re-derive the result.",
  EXPERIMENTAL:
    "No cited statement covers this configuration in the selected game model. A bounded simulation exists, and whatever it prints is an observation of one sampled play.",
  NOT_COVERED:
    "No cited statement covers this configuration and no simulation exists for it (or the parameters are invalid). The nearest backed neighbours are listed instead of an extrapolation.",
};

export interface LabInputs {
  readonly model: string;
  readonly rule: string;
  readonly k: string;
  readonly bias: string;
  readonly encoding: string;
  readonly structures: string;
}

export function configFromInputs(
  i: LabInputs,
  bounds: { kMin: number; kMax: number },
): { ok: true; config: LabConfig } | { ok: false; message: string } {
  if (i.model !== "online" && i.model !== "one-round") {
    return { ok: false, message: "Choose a game model." };
  }
  if (i.rule !== "monochromatic" && i.rule !== "bichromatic") {
    return { ok: false, message: "Choose a winning-hole rule." };
  }
  const k = Number(i.k);
  if (!Number.isInteger(k) || k < bounds.kMin || k > bounds.kMax) {
    return { ok: false, message: `k must be an integer from ${bounds.kMin} to ${bounds.kMax}.` };
  }
  const bias = parseBias(i.bias);
  if (bias === null) {
    return { ok: false, message: 'The bias s must be a non-negative rational such as "2", "5/2" or "1.999".' };
  }
  if (bias.n > 10n ** 12n || bias.d > 10n ** 12n) {
    return { ok: false, message: "The bias is too large to display here." };
  }
  const structures = Number(i.structures);
  if (!Number.isInteger(structures) || structures < 1 || structures > 1_000_000) {
    return { ok: false, message: "t must be an integer from 1 to 1000000." };
  }
  return {
    ok: true,
    config: {
      model: i.model,
      rule: i.rule,
      k,
      bias,
      encodingId: i.encoding === "" ? null : i.encoding,
      structures,
    },
  };
}

export const STOP_TEXT: Readonly<Record<StoppedBy, string>> = {
  "maker-hole": "a Maker k-hole appeared in this sampled play",
  "rounds-complete": "the configured one-round play was carried out and the board was searched once",
  "max-rounds": "the round limit of the runner was reached before any hole appeared",
  "ops-budget": "the exact-geometry work budget of the runner ran out",
  interrupted: "the run was interrupted",
  "point-cap": "the 64-point engine cap was reached",
  "no-legal-point": "the policy found no legal point",
};

export function simKindText(kind: "completed" | "budgetExhausted"): string {
  return kind === "completed"
    ? "COMPLETED — the simulated play reached its own end."
    : "BUDGET EXHAUSTED — the run was cut off by a limit; this is not a finished play.";
}

export interface SimHandle {
  cancel(): void;
}

export function runLabSimAsync(
  cfg: LabConfig,
  settings: LabSimSettings,
  onDone: (r: SimResult) => void,
  onError: (m: string) => void,
  workerFactory: (() => Worker | null) | null,
  decode: (v: unknown) => SimResult,
  encodeCfg: (c: LabConfig) => unknown,
): SimHandle {
  let cancelled = false;
  const w = workerFactory === null ? null : workerFactory();
  if (w !== null) {
    w.onmessage = (ev: MessageEvent): void => {
      if (cancelled) {
        return;
      }
      w.terminate();
      const d = ev.data as { ok: boolean; result?: unknown; message?: string };
      if (d.ok && d.result !== undefined) {
        onDone(decode(d.result));
      } else {
        onError(d.message ?? "worker failed");
      }
    };
    w.onerror = (): void => {
      if (!cancelled) {
        w.terminate();
        onError("the worker failed to start");
      }
    };
    w.postMessage({ cfg: encodeCfg(cfg), settings });
    return {
      cancel(): void {
        cancelled = true;
        w.terminate();
      },
    };
  }
  const timer = setTimeout(() => {
    if (cancelled) {
      return;
    }
    try {
      onDone(
        runSimulation(cfg, {
          seed: settings.seed,
          makerPolicy: settings.makerPolicy,
          breakerPolicy: settings.breakerPolicy,
          maxRounds: settings.maxRounds,
          opsBudget: settings.opsBudget,
          shouldStop: () => cancelled,
        }),
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : "simulation failed");
    }
  }, 0);
  return {
    cancel(): void {
      cancelled = true;
      clearTimeout(timer);
    },
  };
}

export { Rat };
