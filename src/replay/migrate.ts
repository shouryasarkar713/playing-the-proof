// replay/migrate.ts — explicit replay format migration (pure).
//
//   v2  monochromatic, bias 1:1 (the original format)
//   v3  + config.gameMode (required)
//   v4  + config.bias (required, canonical "n/d")
//
// Every migration only relabels: no event, hash or terminal changes (a state
// whose game mode is monochromatic and whose bias is 1:1 hashes identically
// under every version), so a migrated file re-validates with identical state
// hashes. Upgrades are always possible; a downgrade is possible exactly when
// the session is expressible in the lower version.
import { Rat } from "../geometry/rat.ts";
import { isUnitBias } from "../game/turnorder.ts";
import type { ReplayFile } from "./format.ts";

function isUnit(file: ReplayFile): boolean {
  return isUnitBias(file.config.bias);
}

// Any file -> v3 (gameMode explicit). v2 gains gameMode "monochromatic"; v3 is
// returned as-is; a v4 file is accepted only when its bias is 1:1 (a biased
// session cannot be expressed in v3).
export function migrateReplayToV3(file: ReplayFile): ReplayFile {
  if (file.version === 3) {
    return file;
  }
  if (file.version === 4) {
    if (!isUnit(file)) {
      throw new Error("migrateReplayToV3: a biased session is not expressible in v3");
    }
    return {
      ...file,
      version: 3,
      config: {
        k: file.config.k,
        mode: file.config.mode,
        gameMode: file.config.gameMode ?? "monochromatic",
        window: file.config.window,
      },
    };
  }
  return {
    ...file,
    version: 3,
    config: {
      k: file.config.k,
      mode: file.config.mode,
      gameMode: "monochromatic",
      window: file.config.window,
    },
  };
}

// Any file -> v4 (gameMode and bias explicit; absent bias becomes 1/1).
export function migrateReplayToV4(file: ReplayFile): ReplayFile {
  if (file.version === 4) {
    return file;
  }
  return {
    ...file,
    version: 4,
    config: {
      k: file.config.k,
      mode: file.config.mode,
      gameMode: file.config.gameMode ?? "monochromatic",
      bias: Rat.ONE,
      window: file.config.window,
    },
  };
}

// -> v2 (the canonical writer form of a monochromatic 1:1 session), or null
// when the session is bichromatic or biased.
export function downgradeReplayToV2(file: ReplayFile): ReplayFile | null {
  if (file.version === 2) {
    return file;
  }
  if (file.config.gameMode === "bichromatic" || !isUnit(file)) {
    return null;
  }
  return {
    ...file,
    version: 2,
    config: {
      k: file.config.k,
      mode: file.config.mode,
      window: file.config.window,
    },
  };
}
