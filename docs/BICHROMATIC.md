# Bichromatic game mechanics

A mathematical change to the game model, not a colour scheme.

## Rule

* **Monochromatic (default, shipped game).** A winning k-hole may use points
  of either player; its hull contains no other point.
* **Bichromatic.** A winning k-hole is a convex k-subset of **Maker's** points
  whose convex hull contains no point of **any** colour in its interior.
  Breaker's points are interior blockers only and are never hole vertices
  (Džuklevski et al. §1; Aichholzer et al. Game 3: "a hole must not contain any
  points in its interior, regardless of their color").

## API (all pure)

| Where | Symbol | Purpose |
| --- | --- | --- |
| `game/types.ts` | `GameMode`, `GameState.gameMode?`, `SessionConfig.gameMode?` | The flag. **Absent means monochromatic**; only the literal `"bichromatic"` is ever stored, so monochromatic states are structurally and hash-wise unchanged. |
| `game/gamemode.ts` | `gameModeOf`, `isBichromatic`, `isGameMode`, `mayBeHoleVertex(mode, owner)`, `eligibleVertex(state)`, `vertexEligibleIds(state)` | Mode and vertex eligibility. |
| `game/gamemode.ts` | `findWinHoles`, `analyzeWinHoles`, `findNewWinHoles` | Ownership-aware replacements for `findKHoles` / `analyzeHoles` / `findNewKHoles` taking a `GameState`. Monochromatic calls delegate with identical arguments. |
| `game/gamemode.ts` | `checkWinningHole(state, hole)` → `{ok} \| {ok:false, reason: wrong-size \| unknown-point \| duplicate-vertex \| breaker-vertex \| not-a-hole}`, `isWinningHole`, `checkTerminalWitness` | Typed validation of a claimed winning hole; integrity rule I6. |
| `geometry/ownedholes.ts` | `findKHolesAmong`, `analyzeHolesAmong`, `findNewKHolesAmong`, `isHoleAmong`, `estimateHoleWorkAmong` | Colour-blind kernel taking an eligibility predicate; ineligible points still block. |
| `engine/init.ts` | `initSession({ config: { gameMode: "bichromatic" } })` | Sandbox sessions: accepted. Guided sessions: **refused** (`malformed-input`, detail `unsupported-game-mode …`) unless the strategy def declares `gameModes: ["bichromatic"]` and has a maker-move/computed-step entry (no `StrategyStart` bootstrap). Unknown `gameMode` values are rejected, never coerced. |
| `strategy/types.ts` | `StrategyDef.gameModes?` | Absent = `["monochromatic"]` (every shipped def). |
| `engine/replay.ts` | `AssembleOpts.gameMode?` | Writes format v3 when bichromatic. |
| `replay/migrate.ts` | `migrateReplayToV3`, `downgradeReplayToV2` | Explicit v2 ↔ v3 relabelling. |
| `explain/gamemode.ts` | `gameModeLabel`, `ruleCaption`, `witnessLabel`, `earlyWinHeadline`, `earlyWinClaimText` | Wording; ClaimLint-clean. |

UI wiring: the Sandbox carries a mono/bichromatic toggle that sets `gameMode` in the
session configuration, uses `analyzeWinHoles` for its hole sweep and shows `ruleCaption`;
bichromatic sandbox sessions export and load as replay format v3. The k-strip explorer
and the Parameter Laboratory present the bichromatic strategy through their own views.

## Audit of consumers

| Consumer | Before | Now |
| --- | --- | --- |
| `engine/pipeline.ts detectWinAfterPlacement` | all-point holes | `findNewWinHoles` / `analyzeWinHoles` (a Breaker placement never wins bichromatically) |
| `engine/orchestrator.ts` declared-win check, chain win after a Maker move | all-point | `findWinHoles` / `findNewWinHoles` |
| `engine/init.ts` entry chain | all-point | same wrappers |
| `strategy/eval.ts` (`holes` region, `enumerateHoles`), `verification/pipeline.ts` (`exists-k-hole`…) | all-point | `findWinHoles` / `analyzeWinHoles` |
| `engine/describe.ts` effect diff; terminal wording | all-point; "may be Breaker's own" | mode-aware; bichromatic wording |
| `game/hash.ts` | — | adds `gamemode:bichromatic` line **only** when bichromatic |
| `game/place.ts checkStateInvariants` | I1–I5a | + I6 (bichromatic maker-won witnesses genuine) |
| `replay/format.ts`, `validate.ts` | v2 | v2 (monochromatic, unchanged bytes) or v3 (`config.gameMode` required) |
| `session/*`, `game/legality.ts`, `viz/*` | colour-blind | unchanged (placement legality is owner-agnostic) |
| Strategy-internal classifiers/cell checks (`classifyB3`, `cellchecks`, `k6twins`, trapezoid, `orchestrator` 4-/5-hole searches) | all-point | **unchanged**: they encode monochromatic Das–Valla arguments, and a def must opt in via `gameModes`. |
| `ui/*` | — | **not touched** (integrator) |

## Replay format versioning

* v2: unchanged; monochromatic only; `config.gameMode` is **forbidden**.
* v3: `config.gameMode` is **required** (`monochromatic` or `bichromatic`).
  A bichromatic file cannot be expressed in v2, so an old reader rejects it with
  `bad-version` rather than replaying it under the wrong rule. Mono sessions are
  still written as v2.
* v2 → v3 is a lossless relabel (`gameMode: "monochromatic"`); every state hash
  is identical, and `downgradeReplayToV2` reproduces the original bytes
  (tested over all shipped `data/replays/` files).
* Tampering with `gameMode` changes the folded state hash and is caught by the
  hash chain.

## Support per surface

| Surface | Bichromatic | Notes |
| --- | --- | --- |
| Sandbox | yes | Rule toggle starts a fresh session with `gameMode`; hole analysis, count-all-k and the diagnostics line use the Maker-only rule; export/import/autosave use format v3 (v4 together with a bias). The Overmars-29 preset is disabled (its facts are monochromatic). |
| Hole detection (`findWinHoles`, `analyzeWinHoles`, `findNewWinHoles`, `checkWinningHole`) | yes | Ownership-aware kernel in `geometry/ownedholes.ts`; monochromatic calls take the unrestricted search. |
| k-strip executor / explorer | yes, only the verified configurations | Bichromatic Theorem 5 constructions listed in `docs/KSTRIP.md` (`kstrip-bichromatic`: `verified-guided`); other parameters are uncovered. |
| Parameter Lab | classification and simulation | Classifier covers both rules; the simulation uses the ownership-aware detector with simple policies (observation only). |
| Proof mode (esmb-k5, esmb-k6, k7, k8 walkthrough) | **no** | These are monochromatic Das–Valla constructions; `initSession` refuses a bichromatic guided session unless the def declares `gameModes`, and none does. |
| Break-the-Proof | **no** | Same strategies, same refusal. |

Also supported: guided sessions for test defs that declare `gameModes` (a
three-Maker-point k = 3 construction in the tests), typed witness validation,
integrity rule I6, replay v3 round trip and validation, wording.

Not supported: the shipped Das–Valla internals (4-/5-hole classifiers, twin
checks, cell checks) remain monochromatic. Bias (`docs/BIAS.md`) is orthogonal
to the rule and available wherever the sandbox is.

## Tests

`tests/game/gamemode.test.ts` (independent integer oracle, property tests: holes
equal the oracle; never a Breaker vertex; equal to monochromatic holes filtered
to Maker; incremental = full; adding a Breaker point never creates a hole),
`tests/engine/bichromatic.test.ts` (init, sandbox, guided win/blocked/fail-closed
gating, wording), `tests/replay/bichromatic.test.ts` (v3, tamper, migration).
Manual mutation results are in the final report of the work item (and
`docs/LAB_REGIMES.md` §7).
