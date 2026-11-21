// scripts/check-coverage.mjs — per-directory line-coverage gates (§27.4).
// Reads coverage/coverage-summary.json (vitest --coverage, json-summary)
// and asserts: geometry/ ≥ 95% lines; strategy/, game/, engine/ ≥ 90%.
// Other layers are deliberately un-gated (no meaningless UI inflation).
// Exits 1 on any breach (or a missing summary).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const GATES = [
  { dir: "geometry", min: 95 },
  { dir: "strategy", min: 90 },
  { dir: "game", min: 90 },
  { dir: "engine", min: 90 },
  { dir: "kstrip", min: 90 },
];

const summaryPath = resolve("coverage", "coverage-summary.json");
let summary;
try {
  summary = JSON.parse(readFileSync(summaryPath, "utf8"));
} catch {
  console.error(`check-coverage: cannot read ${summaryPath} — run vitest with --coverage first`);
  process.exit(1);
}

const agg = new Map();
for (const [file, entry] of Object.entries(summary)) {
  if (file === "total") {
    continue;
  }
  const m = /src[\\/]([^\\/]+)[\\/]/.exec(file);
  if (m === null) {
    continue;
  }
  const dir = m[1];
  const lines = entry.lines;
  if (lines === undefined) {
    continue;
  }
  const cur = agg.get(dir) ?? { total: 0, covered: 0 };
  cur.total += lines.total;
  cur.covered += lines.covered;
  agg.set(dir, cur);
}

let failed = false;
for (const gate of GATES) {
  const a = agg.get(gate.dir) ?? { total: 0, covered: 0 };
  const pct = a.total === 0 ? 100 : (100 * a.covered) / a.total;
  const ok = pct >= gate.min;
  if (!ok) {
    failed = true;
  }
  console.log(
    `${ok ? "PASS" : "FAIL"} ${gate.dir}/ lines ${pct.toFixed(2)}% (${a.covered}/${a.total}) — gate ≥ ${gate.min}%`,
  );
}
process.exit(failed ? 1 : 0);
