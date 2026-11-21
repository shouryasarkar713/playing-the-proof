// lab/limits.ts — the envelope inside which the lab's bounded simulation is
// implemented. classify() consults it: a configuration outside every cited
// regime is EXPERIMENTAL exactly when it lies inside this envelope.
export const SIM_K_MIN = 3;
export const SIM_K_MAX = 8; // the engine's hole domain is k <= 8
export const SIM_MAX_POINTS = 64; // the engine's point cap (maxPoints)
// Bias envelope: with at most 64 points, bias above 16 leaves at most a few
// rounds of play and carries no information.
export const SIM_MAX_BIAS_INT = 16n;
export const SIM_DEFAULT_ROUNDS = 12;
export const SIM_DEFAULT_OPS_BUDGET = 3_000_000;
