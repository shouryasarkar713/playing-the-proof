# Bias 1:s in the game engine

## Rule

Source (Džuklevski et al., §1): speeds sM:sB; for integer s Breaker places s
points per Maker point; non-integer speeds are ordered by the multiset
{i·sM} ∪ {i·sB} with ties in Maker's favour. As written that convention is
ambiguous (read literally, a larger s gives Breaker fewer moves; it does not say
who starts). The engine therefore implements one exact rule for every rational
s >= 0 — the project's convention, not a quotation:

> Maker moves first. After Maker's r-th point Breaker has placed exactly
> floor(s·r) points in total; Maker moves again as soon as Breaker has placed
> that many.

Equivalently Breaker's j-th point follows Maker's ceil(j/s)-th point (a tie goes
to Maker). s = 1 alternates; integer s gives s Breaker points per Maker point
(M B B M B B for s = 2); s = 3/2 gives M B M B B M B M B B; s = 1/2 gives
M M B M M B; s = 0 is Maker only. Round r starts with Maker's r-th point and
includes the Breaker block after it. Implementation: `game/turnorder.ts`.

## What changed in the engine

| Area | Behaviour |
| --- | --- |
| State/config | `GameState.bias?` and `SessionConfig.bias?` (exact `Rat`). **Absent means 1:1**; a stored 1:1 is normalised to absence. Accepted range 0 <= s <= 64, denominator <= 1000; otherwise `malformed-input`. |
| Turn function | `placePoint` sets `turn` from the owner counts (`nextMover`); unbiased states keep strict parity. |
| Invariants | I3 (stored turn = bias turn) and new I7 (owners follow the bias order exactly) apply to biased states only. |
| Legality | Biased sandbox sessions reject a placement by the player not to move (`wrong-turn`, detail `out-of-turn`). 1:1 sandbox keeps free owners. |
| Guided strategies | Refused with a typed error (`malformed-input`, detail `unsupported-bias`) for every bias other than 1:1, exactly like unsupported game modes: every shipped strategy encodes one Breaker point and one Maker reply. |
| Win/terminal | Unchanged (same detectors, either rule; bias and rule are orthogonal). |
| Hash | A `bias:n/d` line only when the bias differs from 1:1. |
| Counters | `sessionStats.round` counts Maker points when biased; unbiased keeps ceil(n/2). |
| Replay | Format **v4** adds `config.bias` (canonical "n/d", required in v4, forbidden in v2/v3; v4 also carries `gameMode`). The writer chooses the lowest expressive version: v2 monochromatic 1:1, v3 bichromatic 1:1, v4 any bias other than 1:1. Older readers reject v4 (`bad-version`). `replay/migrate.ts`: `migrateReplayToV4`, `migrateReplayToV3`, `downgradeReplayToV2` (null when biased or bichromatic). |
| Sandbox UI | "bias 1:" input (integers and fractions with denominator <= 12, 0..16) starts a fresh biased session; owner buttons show the player to move; k, rule, Reset, generator, export/import and autosave keep the bias; the Overmars-29 preset is disabled under a bias. |

## Which surface is which

| Surface | Bias | Mechanism |
| --- | --- | --- |
| Game engine / session / replay | any s in [0, 64] | `bias` state field, enforced turn order, format v4 |
| Sandbox | yes (UI range 0..16) | the engine rule above |
| Guided strategies (Proof, Break-the-Proof) | **no** (1:1 only) | refused with `unsupported-bias` |
| k-strip executor | the verified configurations of `docs/KSTRIP.md` | its own executor, not the engine turn order |
| Parameter Lab | classification for any rational s; simulation s <= 16 | the lab runner is a separate policy runner; it now uses the engine's quota rule (`breakerQuota`) for how many points Breaker places per round, but is not an engine session and never produces an engine replay |

A simulation parameter is not an engine capability: only the first two rows play
under the bias with enforced turns and replay.

## Evidence

* `tests/game/turnorder.test.ts`: the turn function against an independent
  oracle built from the explicit multiset (anchor ceil(j/s)), exhaustive grid
  n <= 24, d <= 12 plus property tests; named cases for s = 1, integers, s < 1,
  s = 0, non-integers; bounds and wire form.
* `tests/engine/bias.test.ts`: normalisation, hash line, range checks, guided
  refusal, enforced order, I3/I7, rounds, orthogonality with the bichromatic rule.
* `tests/replay/bias.test.ts`: v4 round trip and fold, tamper cases, version
  gating, migration over every shipped replay (hashes identical, bytes restored).
* `tests/ui/sandbox-bias.test.ts` (jsdom): control, validation, persistence across
  k/rule/reset/generator, export/import/autosave.
* Manual mutation testing of the new logic (28 mutants: comparison and
  boundary flips in the turn function and bounds, floor/quota, unit
  normalisation, I3/I7, out-of-turn check, guided refusal, replay version and
  field rules, writer version choice, fold, migration, round counter, UI range
  checks, forced owners, owner display, bias propagation, hash line): 28
  killed, 0 survived.
* Unchanged behaviour: the full default suite (goldens, shipped replays, hash
  tests) passes unmodified except the "wrong version" fixtures that used a now
  valid version number.

## Limits

* Non-integer bias follows the convention above; no theorem is inferred from it
  (discrepancy D5 in `docs/LAB_REGIMES.md`).
* The sandbox has no win/lose; bias there changes who may place and the round
  counter, nothing else.
* No guided strategy plays a biased game; a theorem-backed biased regime is
  reported by the Lab, replayed (where verified) only by the k-strip explorer.
