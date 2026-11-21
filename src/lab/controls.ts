// lab/controls.ts — availableControls(): the parameter/action controls the lab
// can honour TODAY. Every entry names the implementation behind it; a control
// without an implementation must not be listed (a test enforces that every
// listed control's `implementedBy` module exists and exports the named symbol).
import { ENCODING_REGISTRY } from "./encodings.ts";
import { SIM_DEFAULT_OPS_BUDGET, SIM_DEFAULT_ROUNDS, SIM_K_MAX, SIM_MAX_BIAS_INT } from "./limits.ts";

export interface ControlOption {
  readonly value: string;
  readonly label: string;
  // For encoding options: whether choosing it can offer interactive replay.
  readonly note?: string;
}

export interface LabControl {
  readonly id: string;
  readonly label: string;
  readonly kind: "select" | "integer" | "rational" | "button";
  readonly options?: readonly ControlOption[];
  readonly min?: number;
  readonly max?: number;
  readonly default?: string | number;
  readonly implementedBy: { readonly module: string; readonly symbol: string };
  readonly help: string;
}

export function availableControls(): readonly LabControl[] {
  return [
    {
      id: "model",
      label: "Game model",
      kind: "select",
      options: [
        { value: "online", label: "Online / multi-round" },
        { value: "one-round", label: "One-round / offline" },
      ],
      default: "online",
      implementedBy: { module: "classify", symbol: "classify" },
      help: "Changes which theorems apply; the bichromatic intermediate regime is open only online.",
    },
    {
      id: "rule",
      label: "Winning-hole rule",
      kind: "select",
      options: [
        { value: "monochromatic", label: "Monochromatic (either player's points)" },
        { value: "bichromatic", label: "Bichromatic (Maker's points only)" },
      ],
      default: "monochromatic",
      implementedBy: { module: "classify", symbol: "classify" },
      help: "Bichromatic holes use Maker's points only; Breaker's points are blockers (game mode flag).",
    },
    {
      id: "k",
      label: "Target hole size k",
      kind: "integer",
      min: 3,
      max: 12,
      default: 5,
      implementedBy: { module: "classify", symbol: "classify" },
      help: `Classification accepts any integer k >= 3; simulation is implemented for k <= ${SIM_K_MAX}.`,
    },
    {
      id: "bias",
      label: "Bias 1:s",
      kind: "rational",
      default: "1",
      implementedBy: { module: "bias", symbol: "parseBias" },
      help: `Exact rational s >= 0 ("2", "5/2", "1.999"). Simulation is implemented for s <= ${String(SIM_MAX_BIAS_INT)}.`,
    },
    {
      id: "encoding",
      label: "Encoded strategy variant",
      kind: "select",
      options: [
        { value: "", label: "none" },
        ...ENCODING_REGISTRY.map((e) => ({
          value: e.id,
          label: e.label,
          note: e.availability,
        })),
      ],
      default: "",
      implementedBy: { module: "encodings", symbol: "ENCODING_REGISTRY" },
      help: "Interactive replay is offered only for verified encodings that match the exact game.",
    },
    {
      id: "structures",
      label: "Parallel structures t",
      kind: "integer",
      min: 1,
      default: 1,
      implementedBy: { module: "bounds", symbol: "monoRoundBound" },
      help: "Drives the published k-strip round bound (monochromatic, integer s). Does not change the status.",
    },
    {
      id: "simulate",
      label: "Run bounded simulation",
      kind: "button",
      implementedBy: { module: "simulate", symbol: "runSimulation" },
      help: `Seeded, interruptible, observation only (default ${SIM_DEFAULT_ROUNDS} rounds, ${SIM_DEFAULT_OPS_BUDGET} exact-geometry ops).`,
    },
    {
      id: "simulate.breakerPolicy",
      label: "Breaker policy",
      kind: "select",
      options: [
        { value: "random-legal", label: "Random legal point" },
        { value: "greedy", label: "Greedy (best of 16 by hole count)" },
      ],
      default: "random-legal",
      implementedBy: { module: "simulate", symbol: "runSimulation" },
      help: "Simple policy, not a published strategy.",
    },
    {
      id: "simulate.makerPolicy",
      label: "Maker policy",
      kind: "select",
      options: [
        { value: "random-legal", label: "Random legal point" },
        { value: "greedy", label: "Greedy (best of 16 by hole count)" },
      ],
      default: "random-legal",
      implementedBy: { module: "simulate", symbol: "runSimulation" },
      help: "Simple policy, not the k-strip or Das–Valla strategy.",
    },
    {
      id: "simulate.seed",
      label: "Seed",
      kind: "integer",
      min: 0,
      default: 1,
      implementedBy: { module: "simulate", symbol: "runSimulation" },
      help: "Same seed, same play.",
    },
  ];
}
