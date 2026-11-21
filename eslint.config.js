// ESLint flat config. Encodes the §18.1 module layering as lint-enforced
// import-x/no-restricted-paths zones. Dependencies point strictly downward;
// no cycles. The §27.1 architecture test runs this config as a test.
import tseslint from "typescript-eslint";
import importX from "eslint-plugin-import-x";

const LOWER = {
  geometry:
    "geometry/ is L0: imports nothing outside geometry/ (§18.1).",
  game: "game/ is L1: imports geometry/ only (§18.1).",
  strategy:
    "strategy/ is L2: imports geometry/ + game/ only; never engine/ or verification/ (§18.1).",
  verification:
    "verification/ is L3: imports geometry/ + game/ + strategy/ only (§18.1).",
  explain:
    "explain/ is L4: imports game/ + strategy/ (+geometry) only (§18.1).",
  engine:
    "engine/ is L5: imports game/ + strategy/ + verification/ + explain/ (+geometry) only (§18.1).",
  session:
    "session/ is L6: imports game/ + engine/ only (§18.1).",
  replay:
    "replay/ is L7: imports engine/ + game/ (+geometry) only (§18.1).",
  kstrip:
    "kstrip/ is a headless math layer: imports geometry/ only and is imported by ui/ only.",
  viz: "viz/ is L8: imports game/ + strategy/ + verification/ (+geometry) only (§18.1).",
  // ui/ is L9 (top layer): unrestricted.
};

// lab/ (Research / Parameter Lab, pure): imports geometry/ + game/ only, and
// is importable by ui/ alone — no other layer may depend on it.
const LAB_MSG =
  "lab/ is a pure leaf: it imports geometry/ + game/ only, and only ui/ may import lab/.";
const labZones = [
  ...[
    "geometry",
    "game",
    "strategy",
    "verification",
    "explain",
    "engine",
    "session",
    "replay",
    "viz",
  ].map((t) => ({ target: `src/${t}`, from: "src/lab/**", message: LAB_MSG })),
  ...[
    "strategy",
    "verification",
    "explain",
    "engine",
    "session",
    "replay",
    "viz",
    "ui",
  ].map((f) => ({ target: "src/lab", from: `src/${f}/**`, message: LAB_MSG })),
];

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", ".claude/**"],
  },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    plugins: {
      "import-x": importX,
    },
    rules: {
      // Underscore-prefixed args are intentionally reserved (e.g. Phase-9
      // ctx params on normative signatures).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      // Zone semantics (verified against the plugin source): `target`
      // matches the IMPORTING file, `from` the forbidden import origin.
      // Dependencies point strictly downward (§18.1).
      "import-x/no-restricted-paths": [
        "error",
        {
          zones: [
            ...labZones,
            { target: "src/geometry", from: "src/game/**", message: LOWER.geometry },
            { target: "src/geometry", from: "src/session/**", message: LOWER.geometry },
            { target: "src/geometry", from: "src/engine/**", message: LOWER.geometry },
            { target: "src/geometry", from: "src/strategy/**", message: LOWER.geometry },
            { target: "src/geometry", from: "src/verification/**", message: LOWER.geometry },
            { target: "src/geometry", from: "src/explain/**", message: LOWER.geometry },
            { target: "src/geometry", from: "src/viz/**", message: LOWER.geometry },
            { target: "src/geometry", from: "src/ui/**", message: LOWER.geometry },
            { target: "src/geometry", from: "src/replay/**", message: LOWER.geometry },

            { target: "src/game", from: "src/session/**", message: LOWER.game },
            { target: "src/game", from: "src/engine/**", message: LOWER.game },
            { target: "src/game", from: "src/strategy/**", message: LOWER.game },
            { target: "src/game", from: "src/verification/**", message: LOWER.game },
            { target: "src/game", from: "src/explain/**", message: LOWER.game },
            { target: "src/game", from: "src/viz/**", message: LOWER.game },
            { target: "src/game", from: "src/ui/**", message: LOWER.game },
            { target: "src/game", from: "src/replay/**", message: LOWER.game },

            { target: "src/strategy", from: "src/session/**", message: LOWER.strategy },
            { target: "src/strategy", from: "src/engine/**", message: LOWER.strategy },
            { target: "src/strategy", from: "src/verification/**", message: LOWER.strategy },
            { target: "src/strategy", from: "src/explain/**", message: LOWER.strategy },
            { target: "src/strategy", from: "src/viz/**", message: LOWER.strategy },
            { target: "src/strategy", from: "src/ui/**", message: LOWER.strategy },
            { target: "src/strategy", from: "src/replay/**", message: LOWER.strategy },

            { target: "src/verification", from: "src/session/**", message: LOWER.verification },
            { target: "src/verification", from: "src/engine/**", message: LOWER.verification },
            { target: "src/verification", from: "src/explain/**", message: LOWER.verification },
            { target: "src/verification", from: "src/viz/**", message: LOWER.verification },
            { target: "src/verification", from: "src/ui/**", message: LOWER.verification },
            { target: "src/verification", from: "src/replay/**", message: LOWER.verification },

            { target: "src/explain", from: "src/session/**", message: LOWER.explain },
            { target: "src/explain", from: "src/engine/**", message: LOWER.explain },
            { target: "src/explain", from: "src/verification/**", message: LOWER.explain },
            { target: "src/explain", from: "src/viz/**", message: LOWER.explain },
            { target: "src/explain", from: "src/ui/**", message: LOWER.explain },
            { target: "src/explain", from: "src/replay/**", message: LOWER.explain },

            { target: "src/engine", from: "src/session/**", message: LOWER.engine },
            { target: "src/engine", from: "src/viz/**", message: LOWER.engine },
            { target: "src/engine", from: "src/ui/**", message: LOWER.engine },
            { target: "src/engine", from: "src/replay/**", message: LOWER.engine },

            { target: "src/session", from: "src/geometry/**", message: LOWER.session },
            { target: "src/session", from: "src/strategy/**", message: LOWER.session },
            { target: "src/session", from: "src/verification/**", message: LOWER.session },
            { target: "src/session", from: "src/explain/**", message: LOWER.session },
            { target: "src/session", from: "src/viz/**", message: LOWER.session },
            { target: "src/session", from: "src/ui/**", message: LOWER.session },
            { target: "src/session", from: "src/replay/**", message: LOWER.session },

            { target: "src/replay", from: "src/session/**", message: LOWER.replay },
            { target: "src/replay", from: "src/strategy/**", message: LOWER.replay },
            { target: "src/replay", from: "src/verification/**", message: LOWER.replay },
            { target: "src/replay", from: "src/explain/**", message: LOWER.replay },
            { target: "src/replay", from: "src/viz/**", message: LOWER.replay },
            { target: "src/replay", from: "src/ui/**", message: LOWER.replay },

            { target: "src/viz", from: "src/session/**", message: LOWER.viz },
            { target: "src/viz", from: "src/engine/**", message: LOWER.viz },
            { target: "src/viz", from: "src/explain/**", message: LOWER.viz },
            { target: "src/viz", from: "src/ui/**", message: LOWER.viz },
            { target: "src/viz", from: "src/replay/**", message: LOWER.viz },

            // kstrip/: headless math layer, imports geometry/ only; only ui/ may import it.
            { target: "src/kstrip", from: "src/game/**", message: LOWER.kstrip },
            { target: "src/kstrip", from: "src/session/**", message: LOWER.kstrip },
            { target: "src/kstrip", from: "src/engine/**", message: LOWER.kstrip },
            { target: "src/kstrip", from: "src/strategy/**", message: LOWER.kstrip },
            { target: "src/kstrip", from: "src/verification/**", message: LOWER.kstrip },
            { target: "src/kstrip", from: "src/explain/**", message: LOWER.kstrip },
            { target: "src/kstrip", from: "src/viz/**", message: LOWER.kstrip },
            { target: "src/kstrip", from: "src/ui/**", message: LOWER.kstrip },
            { target: "src/kstrip", from: "src/replay/**", message: LOWER.kstrip },
            { target: "src/geometry", from: "src/kstrip/**", message: LOWER.kstrip },
            { target: "src/game", from: "src/kstrip/**", message: LOWER.kstrip },
            { target: "src/session", from: "src/kstrip/**", message: LOWER.kstrip },
            { target: "src/engine", from: "src/kstrip/**", message: LOWER.kstrip },
            { target: "src/strategy", from: "src/kstrip/**", message: LOWER.kstrip },
            { target: "src/verification", from: "src/kstrip/**", message: LOWER.kstrip },
            { target: "src/explain", from: "src/kstrip/**", message: LOWER.kstrip },
            { target: "src/viz", from: "src/kstrip/**", message: LOWER.kstrip },
            { target: "src/replay", from: "src/kstrip/**", message: LOWER.kstrip },
          ],
        },
      ],
    },
  },
  {
    // Test stubs implement normative signatures (classifiers, checkers):
    // underscore-prefixed args are intentionally reserved, as under src/.
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Phase 2 Done: predicates are used everywhere, never reimplemented —
    // only geometry/predicates.ts may define the orient formula.
    // §31.2 exactness: floating-point geometry (Math.*) lives only in
    // viz/projection.ts (the one-way rule) — nowhere else under src/.
    files: ["src/**/*.ts"],
    ignores: ["src/geometry/predicates.ts", "src/viz/projection.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Identifier[name='cross']",
          message:
            "orient lives in geometry/predicates.ts only (Phase 2 Done).",
        },
        {
          selector: "MemberExpression[object.name='Math']",
          message:
            "floating-point geometry lives in viz/projection.ts only (§31.2).",
        },
      ],
    },
  },
);
