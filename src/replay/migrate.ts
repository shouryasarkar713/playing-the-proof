// replay/migrate.ts — explicit v2 <-> v3 replay migration (pure).
// v2 files are monochromatic by definition; v3 adds config.gameMode. The
// migration only relabels: no event, hash or terminal changes (a monochromatic
// state's hash does not depend on the flag), so a migrated file re-validates
// with identical state hashes.
import type { ReplayFile } from "./format.ts";

// Any file -> v3. A v2 file becomes gameMode "monochromatic"; v3 is returned as-is.
export function migrateReplayToV3(file: ReplayFile): ReplayFile {
  if (file.version === 3) {
    return file;
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

// v3 monochromatic -> v2 (the canonical writer form). Returns null when the
// file is bichromatic: that rule is not expressible in v2.
export function downgradeReplayToV2(file: ReplayFile): ReplayFile | null {
  if (file.version === 2) {
    return file;
  }
  if (file.config.gameMode === "bichromatic") {
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
