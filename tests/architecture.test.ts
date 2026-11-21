// tests/architecture.test.ts — Phase-7 layer: module allowlists (§18.1),
// the no-effects rule for pure layers, and the single-integrityReport rule.
// (The full §27.1 battery — strategy/verification import rules — lands with
// those modules in Phase 9.)
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...tsFiles(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

// Resolve a relative import to its top-level src module (or null for
// packages / deep-internal paths outside src).
function targetModule(file: string, spec: string): string | null {
  if (!spec.startsWith(".")) {
    return null;
  }
  const parts = join(dirname(file), spec).split(/[/\\]/);
  const srcIdx = parts.lastIndexOf("src");
  if (srcIdx < 0 || srcIdx + 1 >= parts.length) {
    return null;
  }
  return parts[srcIdx + 1] as string;
}

function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const mods: string[] = [];
  const re = /from\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const t = targetModule(file, m[1] as string);
    if (t !== null) {
      mods.push(t);
    }
  }
  return mods;
}

describe("module layering (§18.1)", () => {
  const allow: Record<string, string[]> = {
    geometry: ["geometry"],
    game: ["geometry", "game"],
    session: ["game", "engine", "session"],
    engine: [
      "geometry",
      "game",
      "engine",
      "strategy",
      "verification",
      "explain",
    ],
    strategy: ["geometry", "game", "strategy"],
    verification: ["geometry", "game", "strategy", "verification"],
    // Research / Parameter Lab: a pure leaf over the kernel and game values.
    lab: ["geometry", "game", "lab"],
    kstrip: ["geometry", "kstrip"],
  };

  it("only ui/ may import lab/", () => {
    for (const mod of readdirSync(SRC)) {
      if (mod === "ui" || mod === "lab" || !statSync(join(SRC, mod)).isDirectory()) {
        continue;
      }
      for (const file of tsFiles(join(SRC, mod))) {
        expect(importsOf(file).includes("lab"), `${file} imports lab/`).toBe(false);
      }
    }
  });

  it("each present module imports only strictly-lower-or-self layers", () => {
    for (const [mod, allowed] of Object.entries(allow)) {
      let saw = false;
      try {
        void statSync(join(SRC, mod));
        saw = true;
      } catch {
        saw = false;
      }
      if (!saw) {
        continue;
      }
      for (const file of tsFiles(join(SRC, mod))) {
        for (const target of importsOf(file)) {
          expect(
            allowed.includes(target),
            `${file} imports ${target} (allowed: ${allowed.join(",")})`,
          ).toBe(true);
        }
      }
    }
  });

  it("session/ reaches engine/ only (never strategy/verification/ui/viz)", () => {
    for (const file of tsFiles(join(SRC, "session"))) {
      for (const target of importsOf(file)) {
        expect(
          [
            "strategy",
            "verification",
            "explain",
            "viz",
            "ui",
            "replay",
          ].includes(target),
          `${file} imports forbidden ${target}`,
        ).toBe(false);
      }
    }
  });

  it("strategy/ and verification/ contain NO import of engine/", () => {
    for (const mod of ["strategy", "verification"]) {
      for (const file of tsFiles(join(SRC, mod))) {
        for (const target of importsOf(file)) {
          expect(target === "engine", `${file} imports forbidden engine/`).toBe(
            false,
          );
        }
      }
    }
  });

  it("module graph is acyclic (no upward imports, no cycles)", () => {
    const mods = [
      "geometry",
      "game",
      "session",
      "engine",
      "strategy",
      "verification",
      "explain",
      "viz",
      "ui",
      "replay",
      "kstrip",
    ];
    const edges = new Map<string, Set<string>>();
    for (const mod of mods) {
      edges.set(mod, new Set());
      try {
        void statSync(join(SRC, mod));
      } catch {
        continue;
      }
      for (const file of tsFiles(join(SRC, mod))) {
        for (const target of importsOf(file)) {
          if (target !== mod && mods.includes(target)) {
            edges.get(mod)?.add(target);
          }
        }
      }
    }
    // Depth-first cycle detection over present modules.
    const color = new Map<string, number>();
    const visit = (m: string, stack: string[]): void => {
      color.set(m, 1);
      for (const t of edges.get(m) ?? []) {
        const c = color.get(t) ?? 0;
        if (c === 1) {
          throw new Error(`import cycle: ${[...stack, m, t].join("→")}`);
        } else if (c === 0) {
          visit(t, [...stack, m]);
        }
      }
      color.set(m, 2);
    };
    for (const mod of mods) {
      if ((color.get(mod) ?? 0) === 0) {
        try {
          void statSync(join(SRC, mod));
        } catch {
          color.set(mod, 2);
          continue;
        }
        visit(mod, []);
      }
    }
  });
});

describe("purity boundary (§18.1, §31.2)", () => {
  const EFFECTS = [
    "document",
    "localStorage",
    "sessionStorage",
    "FileReader",
    "Blob",
    "fetch(",
    "setTimeout",
    "setInterval",
    "requestAnimationFrame",
    "XMLHttpRequest",
    "WebSocket",
    "indexedDB",
    "postMessage",
  ];

  it("no effect tokens under any pure layer (geometry/game/session/engine/strategy/verification/replay/viz/explain)", () => {
    for (const mod of [
      "geometry",
      "game",
      "session",
      "engine",
      "strategy",
      "verification",
      "replay",
      "viz",
      "explain",
      "kstrip",
    ]) {
      for (const file of tsFiles(join(SRC, mod))) {
        const text = readFileSync(file, "utf8");
        for (const token of EFFECTS) {
          expect(
            text.includes(token),
            `${file} contains effect token ${token}`,
          ).toBe(false);
        }
      }
    }
  });
});

describe("single integrityReport implementation (§10.9, v1.2.8)", () => {
  it("exactly one `export function integrityReport` exists repo-wide", () => {
    let count = 0;
    const hits: string[] = [];
    for (const file of tsFiles(SRC)) {
      const text = readFileSync(file, "utf8");
      if (/export function integrityReport\b/.test(text)) {
        count += 1;
        hits.push(file);
      }
    }
    expect(hits).toEqual([join(SRC, "game", "integrity.ts")]);
    expect(count).toBe(1);
  });

  it("CheckResult/IntegrityReport/VerificationResult defined once, imports point downward", () => {
    const homes = new Map<string, string[]>();
    for (const file of tsFiles(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const name of [
        "CheckResult",
        "IntegrityReport",
        "VerificationResult",
      ]) {
        if (new RegExp(`(interface|type|class)\\s+${name}\\b`).test(text)) {
          const list = homes.get(name) ?? [];
          list.push(file);
          homes.set(name, list);
        }
      }
    }
    for (const [name, files] of homes) {
      expect(files, `${name} defined in ${files.join(",")}`).toEqual([
        join(SRC, "game", "integrity.ts"),
      ]);
    }
    expect(homes.size).toBe(3);
  });

  it("strategy/ performs NO invariant verification (v1.2.9 ownership)", () => {
    // The enforceable core: no verifier call sites and no direct checker
    // invocations anywhere under strategy/ (structural walks of spec FIELDS
    // in registry.ts — G-validation and the codec — are data traversal,
    // never evaluation; evaluation lives in verification/ alone).
    for (const file of tsFiles(join(SRC, "strategy"))) {
      const text = readFileSync(file, "utf8");
      expect(
        /checkPre|checkPost/.test(text),
        `${file} references node verification`,
      ).toBe(false);
      expect(/\.check\(/.test(text), `${file} invokes a checker`).toBe(false);
    }
  });
});

describe("tier separation (§27.1, Phase 18)", () => {
  it("slow tier is a separate project excluded from verify (no drift)", async () => {
    const mod = (await import("../vitest.config.ts")) as {
      default: {
        test?: {
          projects?: Array<{
            test?: { name?: string; include?: string[]; exclude?: string[] };
          }>;
        };
      };
    };
    const projects = mod.default.test?.projects ?? [];
    expect(projects.length).toBe(2);
    const def = projects[0]?.test;
    const slow = projects[1]?.test;
    expect(def?.name).toBe("default");
    expect(def?.include).toContain("tests/**/*.test.ts");
    expect(def?.exclude).toContain("tests/slow/**");
    expect(slow?.name).toBe("slow");
    expect(slow?.include).toContain("tests/slow/**/*.test.ts");
    // The default project must not accidentally include slow files, and
    // the slow project must not leak into the default glob.
    expect(def?.include?.some((g) => g.includes("slow")) ?? false).toBe(false);
  });
});
