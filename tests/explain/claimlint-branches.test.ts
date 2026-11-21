// every ClaimLint branch has a test that fails when the branch is wrong
// (mutation survivors 27b/27c + the two forbidden phrases of §26F that were
// missing) + a scan of the user-visible string literals in src/ui.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { lintSources, lintStrings } from "../../src/explain/claimlint.ts";

describe("ClaimLint branches", () => {
  it("forbidden words hit; plain clean prose does not", () => {
    expect(lintStrings(["This move proves the theorem."]).map((h) => h.word)).toContain("proves");
    expect(lintStrings(["Maker always wins."]).map((h) => h.word)).toContain("always");
    expect(lintStrings(["A 5-hole exists among these five points."])).toEqual([]);
  });

  it("the two §26F phrases that were unencoded now hit", () => {
    expect(lintStrings(["Therefore the theorem holds for this configuration."]).length).toBeGreaterThan(0);
    expect(lintStrings(["The app establishes that Maker wins."]).length).toBeGreaterThan(0);
  });

  it("theorem-cited exemption needs a NON-EMPTY ref (27b)", () => {
    const text = "Maker guarantees a hole (Lemma 6).";
    expect(lintSources([{ text, tier: "theorem-cited", ref: "Das–Valla 2026, Lemma 6" }])).toEqual([]);
    expect(lintSources([{ text, tier: "theorem-cited", ref: "" }]).length).toBeGreaterThan(0);
    expect(lintSources([{ text, tier: "theorem-cited", ref: null }]).length).toBeGreaterThan(0);
    expect(lintSources([{ text, tier: "theorem-cited" }]).length).toBeGreaterThan(0);
    expect(lintSources([{ text, tier: "strategy-rule", ref: "x" }]).length).toBeGreaterThan(0);
  });

  it("'exhaustive'/'complete' need an explicit finite scope in the same sentence (27c)", () => {
    expect(lintStrings(["The check is exhaustive."]).map((h) => h.word)).toEqual(["exhaustive"]);
    expect(lintStrings(["The search is complete."]).map((h) => h.word)).toEqual(["complete"]);
    expect(lintStrings(["Exhaustive over 12 points."])).toEqual([]);
    expect(lintStrings(["A complete enumeration within the play window."])).toEqual([]);
    // scope in ANOTHER sentence does not count
    expect(lintStrings(["The check is exhaustive. It ran over 12 points."]).length).toBeGreaterThan(0);
  });
});

function walk(dir: string, out: string[]): void {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
}

describe("user-visible string literals in src/ui and src/engine/describe.ts", () => {
  it("contain no forbidden claim word outside the whitelist", () => {
    const files: string[] = [];
    walk("src/ui", files);
    files.push("src/engine/describe.ts");
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      // string / template literals of prose length (>= 3 words), excluding imports
      const re = /(["`])((?:\.|(?!\1)[^\\n]){18,})\1/g;
      for (const m of text.matchAll(re)) {
        const lit = m[2] as string;
        if (!/\s\S+\s\S+/.test(lit) || /^[./@]/.test(lit) || lit.includes("=>")) continue;
        for (const h of lintStrings([lit])) hits.push(`${f}: "${h.word}" in ${lit.slice(0, 70)}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
