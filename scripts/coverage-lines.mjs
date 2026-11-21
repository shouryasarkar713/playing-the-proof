// scripts/coverage-lines.mjs — print uncovered statement lines per file
// for the gated layers (diagnostic helper for Phase-18 gate work).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const summary = JSON.parse(
  readFileSync(resolve("coverage", "coverage-final.json"), "utf8"),
);
const want = process.argv[2] !== undefined ? [process.argv[2]] : ["geometry", "strategy", "engine", "game"];
for (const [file, entry] of Object.entries(summary)) {
  const parts = file.split("src");
  if (parts.length < 2) {
    continue;
  }
  const rest = parts[1] ?? "";
  const dir = (rest.split(/[/\\]/).filter((p) => p !== "")[0] ?? "");
  if (!want.includes(dir)) {
    continue;
  }
  const uncovered = [];
  for (const [id, count] of Object.entries(entry.s)) {
    if (count === 0) {
      const loc = entry.statementMap[id];
      if (loc.start.line === loc.end.line) {
        uncovered.push(`${loc.start.line}`);
      } else {
        uncovered.push(`${loc.start.line}-${loc.end.line}`);
      }
    }
  }
  if (uncovered.length > 0) {
    console.log(`${dir}/${rest.split(/[/\\]/).filter((p) => p !== "").slice(1).join("/")} :: ${uncovered.join(",")}`);
  }
}
