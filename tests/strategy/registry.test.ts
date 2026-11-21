// tests/strategy/registry.test.ts — G1–G11 rejection fixtures, codec
// round-trip + no-function walk, classifyFour unit vectors, statuses.
import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import {
  classifyFour,
  effectiveStatus,
  hydrateStrategyDef,
  recordValidationCheck,
  registerClassifier,
  registerStrategy,
  RegistrationError,
  serializeStrategyDef,
  strategies,
} from "../../src/strategy/registry.ts";
import type { PtExpr, RegionExpr, StrategyDef } from "../../src/strategy/types.ts";
import { fixtureTriangle } from "../../src/strategy/strategies/fixtureTriangle.ts";
import { esmbK5 } from "../../src/strategy/strategies/k5/def.ts";
import { esmbK6 } from "../../src/strategy/strategies/k6/def.ts";
import { esmbK6Wide } from "../../src/strategy/strategies/k6/wide.ts";
import { ensureK5 } from "../strategies/k5driver.ts";
import { ensureK6 } from "../strategies/k6driver.ts";
import { P } from "./scaffolding.ts";
import { testConfig } from "../helpers.ts";

// Registrations (classifiers, checkers, shipped defs) arrive via the
// idempotent ensure fns — no manual register calls (import order would
// double-register).
ensureK5();
ensureK6();

function tinyDef(overrides: Partial<StrategyDef>): StrategyDef {
  return {
    id: "td-tiny",
    k: 3,
    version: "0.0.0",
    source: { paper: "test", stepMap: {} },
    entry: "entry",
    nodes: {
      entry: {
        id: "entry",
        role: "maker-move",
        next: "end",
        move: {
          kind: "fixed",
          at: [{ kind: "const", x: Rat.make(0n), y: Rat.make(0n) }],
        },
        show: [],
        why: { headline: "t", claims: [], sourceRef: "t" },
        sourceRef: "t",
      },
      end: {
        id: "end",
        role: "terminal",
        show: [],
        why: { headline: "t", claims: [], sourceRef: "t" },
        sourceRef: "t",
      },
    },
    ...overrides,
  };
}

describe("G1–G11 rejection fixtures (§27.1)", () => {
  it("accepts the [FIX] triangle def", () => {
    const rs = registerStrategy(fixtureTriangle, "fixture");
    expect(rs.def.id).toBe("fixture-triangle");
    expect(effectiveStatus(rs)).toBe("fixture");
  });

  it("G3 rejects a dangling next", () => {
    const def = tinyDef({});
    (def.nodes["entry"] as { next: string }).next = "nope";
    expect(() => registerStrategy(def, "fixture")).toThrowError(
      /G3/,
    );
  });

  it("G6 rejects a classify-free cycle", () => {
    const def = tinyDef({
      nodes: {
        entry: {
          id: "entry",
          role: "computed-step",
          next: "c2",
          compute: {
            kind: "select-twin-pair",
            anchorVar: "A",
            binds: { twinA: "T1", twinB: "T2" },
          },
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
        c2: {
          id: "c2",
          role: "computed-step",
          next: "entry",
          compute: {
            kind: "select-twin-pair",
            anchorVar: "A",
            binds: { twinA: "T1", twinB: "T2" },
          },
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
      },
    });
    expect(() => registerStrategy(def, "fixture")).toThrowError(/G6/);
  });

  it("G7 rejects a classify node without catch-all", () => {
    const def = tinyDef({
      nodes: {
        entry: {
          id: "entry",
          role: "classify-breaker",
          routes: [
            {
              case: "t:only",
              when: { kind: "region", expr: { kind: "window" } },
              target: "end",
            },
          ],
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
        end: {
          id: "end",
          role: "maker-move",
          next: "entry",
          move: {
            kind: "fixed",
            at: [{ kind: "const", x: Rat.make(0n), y: Rat.make(0n) }],
          },
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
      },
    });
    expect(() => registerStrategy(def, "fixture")).toThrowError(/G7/);
  });

  it("G10 rejects an unbound var", () => {
    const def = tinyDef({});
    const entry = def.nodes["entry"];
    if (entry?.role !== "maker-move") {
      throw new Error("test setup");
    }
    entry.move = {
      kind: "fixed",
      at: [{ kind: "anchor", v: "ZZZ" }],
    };
    expect(() => registerStrategy(def, "fixture")).toThrowError(/G10/);
  });

  it("G4 rejects a terminal node carrying pre/post", () => {
    const def = tinyDef({});
    const end = def.nodes["end"];
    if (end === undefined) {
      throw new Error("test setup");
    }
    end.post = [{ kind: "exists-k-hole", k: 3 }];
    expect(() => registerStrategy(def, "fixture")).toThrowError(/G4/);
  });

  it("G3 rejects a route target of role classify-breaker", () => {
    const def = tinyDef({
      nodes: {
        entry: {
          id: "entry",
          role: "classify-breaker",
          routes: [
            { case: "t:x", when: { kind: "all" }, target: "mid" },
          ],
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
        mid: {
          id: "mid",
          role: "classify-breaker",
          routes: [{ case: "t:y", when: { kind: "all" }, target: "end" }],
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
        end: {
          id: "end",
          role: "maker-move",
          next: "entry",
          move: {
            kind: "fixed",
            at: [{ kind: "const", x: Rat.make(0n), y: Rat.make(0n) }],
          },
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
      },
    });
    expect(() => registerStrategy(def, "fixture")).toThrowError(/G3/);
  });

  it("G8 rejects an unknown checkerId", () => {
    const def = tinyDef({});
    (def.nodes["entry"] as { post?: unknown }).post = [
      { kind: "custom", checkerId: "nope", args: {}, describe: "x" },
    ];
    // NOTE: checker ids resolve against verification/invariants.ts; the
    // registry only checks structural well-formedness of args here.
    // Unknown checkerId fails at RUNTIME (checkPre/checkPost), not here.
    expect(() => registerStrategy(def, "fixture")).not.toThrow();
  });

  it("SER rejects a function-valued field", () => {
    const def = tinyDef({});
    (def as unknown as Record<string, unknown>)["hack"] = () => 1;
    expect(() => registerStrategy(def, "fixture")).toThrowError(/SER/);
  });

  it("G11 rejects k=4 and non-fixture k=3", () => {
    const k4 = tinyDef({ id: "td-k4" });
    (k4 as unknown as { k: number }).k = 4;
    expect(() => registerStrategy(k4, "core")).toThrowError(/G11/);
    const k3core = tinyDef({ id: "td-k3core" });
    expect(() => registerStrategy(k3core, "core")).toThrowError(/G11/);
    const k5fix = tinyDef({ id: "td-k5fix", k: 5 });
    expect(() => registerStrategy(k5fix, "fixture")).toThrowError(/G11/);
  });

  it("G9 rejects an on.tag outside resultTags", () => {
    const def = tinyDef({
      nodes: {
        entry: {
          id: "entry",
          role: "classify-breaker",
          routes: [
            {
              case: "t:bad",
              when: {
                kind: "classifier",
                classifierId: "classifyFour",
                inputs: { pts: { kind: "last-n", n: 4 } },
                on: { tag: "nope" },
              },
              target: "end",
            },
            { case: "t:all", when: { kind: "all" }, target: "end" },
          ],
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
        end: {
          id: "end",
          role: "maker-move",
          next: "entry",
          move: {
            kind: "fixed",
            at: [{ kind: "const", x: Rat.make(0n), y: Rat.make(0n) }],
          },
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
      },
    });
    expect(() => registerStrategy(def, "fixture")).toThrowError(/G9/);
  });

  it("RegistrationError carries its code", () => {
    try {
      registerStrategy(tinyDef({ id: "td-code-check" }), "core");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(RegistrationError);
      expect((e as RegistrationError).code).toBe("G11");
    }
  });
});

describe("codec round-trip + no-function walk (§5.7)", () => {
  it("hydrate(serialize(d)) is canonically equal", () => {
    const wire = serializeStrategyDef(fixtureTriangle);
    const json = JSON.stringify(wire);
    expect(json).toContain('"5/2"');
    const back = hydrateStrategyDef(JSON.parse(json) as never);
    expect(JSON.stringify(serializeStrategyDef(back))).toBe(json);
    // Spot-check: A2 consts survived as rationals.
    const after = back.nodes["after-b1"];
    expect(after?.role).toBe("maker-move");
  });

  it("hydrate rejects malformed rationals", () => {
    const wire = serializeStrategyDef(fixtureTriangle);
    const raw = JSON.parse(JSON.stringify(wire)) as {
      nodes: { entry: { move: { at: Array<{ x: string; y: string }> } } };
    };
    raw.nodes.entry.move.at[0] = { x: "3/0", y: "0/1" };
    expect(() => hydrateStrategyDef(raw as never)).toThrow();
  });

  it("registerStrategy rejects function-valued defs (SER walk)", () => {
    const def = tinyDef({ id: "td-fn-check" });
    const entry = def.nodes["entry"];
    if (entry?.role !== "maker-move" || entry.move?.kind !== "fixed") {
      throw new Error("registry: fixture shape changed — test bug");
    }
    entry.move.at = [
      { kind: "const", x: Rat.make(0n), y: Rat.make(0n) },
      (() => ({ kind: "const", x: Rat.make(0n), y: Rat.make(0n) })) as never,
    ];
    expect(() => registerStrategy(def, "fixture")).toThrowError(/SER/);
  });

  it("shipped defs round-trip byte-identically (esmb-k5, esmb-k6, wide)", () => {
    for (const def of [esmbK5, esmbK6, esmbK6Wide]) {
      const json = JSON.stringify(serializeStrategyDef(def));
      const back = hydrateStrategyDef(JSON.parse(json) as never);
      expect(JSON.stringify(serializeStrategyDef(back))).toBe(json);
    }
  });

  it("rich def round-trips every codec arm (Phase 18)", () => {
    const c0: PtExpr = { kind: "const", x: Rat.make(0n), y: Rat.make(0n) };
    const c1: PtExpr = { kind: "const", x: Rat.make(4n), y: Rat.make(0n) };
    const half: RegionExpr = {
      kind: "halfplane",
      thru: [c0, c1],
      side: "left",
    };
    const def: StrategyDef = {
      id: "td-rich",
      k: 3,
      version: "0.0.0",
      source: { paper: "test", stepMap: {} },
      entry: "entry",
      nodes: {
        entry: {
          id: "entry",
          role: "maker-move",
          next: "C",
          placeBind: "V",
          move: {
            kind: "fixed",
            at: [
              c0,
              { kind: "mid", a: c0, b: c1 },
              { kind: "reflect", src: c0, over: [c0, c1] },
              { kind: "offset", from: c0, by: [Rat.make(1n), Rat.make(2n)] },
            ],
          },
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
        C: {
          id: "C",
          role: "classify-breaker",
          routes: [
            { case: "t:half", when: { kind: "region", expr: half }, target: "M" },
            {
              case: "t:hull",
              when: { kind: "region", expr: { kind: "hull", of: { kind: "last-n", n: 1 } } },
              target: "M",
            },
            {
              case: "t:inter",
              when: {
                kind: "region",
                expr: { kind: "intersect", of: [{ kind: "window" }, { kind: "all" }] },
              },
              target: "M",
            },
            {
              case: "t:holes",
              when: { kind: "region", expr: { kind: "holes", k: 3 } },
              target: "M",
            },
            {
              case: "t:clf",
              when: {
                kind: "classifier",
                classifierId: "classifyFour",
                inputs: {
                  a: { kind: "last-n", n: 2 },
                  b: { kind: "var", v: "V" },
                  c: { kind: "points", of: [{ kind: "anchor", v: "V" }] },
                },
                on: { tag: "convex" },
              },
              target: "M",
            },
            { case: "t:any", when: { kind: "all" }, target: "M" },
          ],
          pre: [
            { kind: "exists-k-hole", k: 3, where: { kind: "window" } },
            { kind: "exists-shared-edge-pair", k: 3 },
            { kind: "region-empty-of", expr: half, owner: "breaker" },
            { kind: "config-class", cls: "convex" },
            {
              kind: "custom",
              checkerId: "test:never",
              args: { a: { kind: "last-n", n: 1 } },
              describe: "d",
            },
          ],
          show: [
            { kind: "region", expr: half, style: "neutral", label: "h" },
            { kind: "strip", strip: { stripId: "s1" } },
            { kind: "poly-line", of: [c0, c1], style: "reference" },
            { kind: "highlight-hole", pattern: "intended" },
            { kind: "case-map" },
          ],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
        M: {
          id: "M",
          role: "maker-move",
          next: "end",
          move: { kind: "fixed", at: [c0] },
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
        end: {
          id: "end",
          role: "terminal",
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
      },
    };
    const json = JSON.stringify(serializeStrategyDef(def));
    for (const marker of [
      '"mid"',
      '"reflect"',
      '"offset"',
      '"halfplane"',
      '"holes"',
      '"region-empty-of"',
      '"config-class"',
      '"custom"',
      '"strip"',
      '"poly-line"',
      '"case-map"',
    ]) {
      expect(json).toContain(marker);
    }
    const back = hydrateStrategyDef(JSON.parse(json) as never);
    expect(JSON.stringify(serializeStrategyDef(back))).toBe(json);
  });
});

describe("G-rejection battery, second round (Phase 18)", () => {
  function reg(id: string, def: StrategyDef): void {
    registerStrategy({ ...def, id }, "fixture");
  }

  it("G2: maker-move without move; classify-breaker without routes", () => {
    const noMove = tinyDef({ id: "td-g2a" });
    delete (noMove.nodes["entry"] as { move?: unknown }).move;
    expect(() => registerStrategy(noMove, "fixture")).toThrowError(/G2/);
    const noRoutes = tinyDef({
      id: "td-g2b",
      entry: "C",
      nodes: {
        C: {
          id: "C",
          role: "classify-breaker",
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        } as never,
      },
    });
    expect(() => registerStrategy(noRoutes, "fixture")).toThrowError(/G2/);
  });

  it("G1: unknown entry; G3: route target into a terminal", () => {
    expect(() => reg("td-g1", tinyDef({ entry: "nope" }))).toThrowError(/G1/);
    const routed = tinyDef({
      id: "td-g3r",
      entry: "C",
      nodes: {
        C: {
          id: "C",
          role: "classify-breaker",
          routes: [{ case: "t", when: { kind: "all" }, target: "end" }],
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
        end: {
          id: "end",
          role: "terminal",
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
      },
    });
    expect(() => registerStrategy(routed, "fixture")).toThrowError(/G3/);
  });

  it("G8: unknown classifier; G9: undeclared tag", () => {
    const routeTo = (target: string) => ({
      C: {
        id: "C",
        role: "classify-breaker",
        routes: [
          {
            case: "t",
            when: { kind: "classifier", classifierId: "CLF", on: { tag: "TAG" } },
            target,
          },
          { case: "t2", when: { kind: "all" }, target },
        ],
        show: [],
        why: { headline: "t", claims: [], sourceRef: "t" },
        sourceRef: "t",
      },
      M: {
        id: "M",
        role: "maker-move",
        next: "end",
        move: { kind: "fixed", at: [{ kind: "const", x: Rat.make(0n), y: Rat.make(0n) }] },
        show: [],
        why: { headline: "t", claims: [], sourceRef: "t" },
        sourceRef: "t",
      },
      end: {
        id: "end",
        role: "terminal",
        show: [],
        why: { headline: "t", claims: [], sourceRef: "t" },
        sourceRef: "t",
      },
    });
    const badClf = tinyDef({ id: "td-g8", entry: "C", nodes: routeTo("M") as unknown as StrategyDef["nodes"] });
    // Patch the placeholder classifier id.
    const clfRoute = (badClf.nodes["C"] as unknown as { routes: Array<{ when: { classifierId: string } }> }).routes[0];
    if (clfRoute === undefined) {
      throw new Error("test bug");
    }
    clfRoute.when.classifierId = "test:nope";
    expect(() => registerStrategy(badClf, "fixture")).toThrowError(/G8/);
    const badTag = tinyDef({ id: "td-g9", entry: "C", nodes: routeTo("M") as unknown as StrategyDef["nodes"] });
    const tagRoute = (badTag.nodes["C"] as unknown as { routes: Array<{ when: { classifierId: string; on: { tag: string } } }> }).routes[0];
    if (tagRoute === undefined) {
      throw new Error("test bug");
    }
    tagRoute.when.classifierId = "classifyFour";
    tagRoute.when.on.tag = "bad";
    expect(() => registerStrategy(badTag, "fixture")).toThrowError(/G9/);
  });

  it("G5: unreachable node; G10: move reads an unbound var", () => {
    const stray = tinyDef({ id: "td-g5" });
    (stray.nodes as Record<string, unknown>)["side"] = {
      ...(stray.nodes["end"] as object),
      id: "side",
    };
    expect(() => registerStrategy(stray, "fixture")).toThrowError(/G5/);
    const unbound = tinyDef({ id: "td-g10" });
    const entry = unbound.nodes["entry"];
    if (entry?.role !== "maker-move" || entry.move?.kind !== "fixed") {
      throw new Error("test bug");
    }
    entry.move.at = [{ kind: "anchor", v: "NOPE" }];
    expect(() => registerStrategy(unbound, "fixture")).toThrowError(/G10/);
  });

  it("dup + strip + classifier guards + recordValidationCheck", () => {    const first = tinyDef({ id: "td-dup" });
    registerStrategy(first, "fixture");
    expect(() => registerStrategy(tinyDef({ id: "td-dup" }), "fixture")).toThrowError(/dup/);
    const stripped = tinyDef({ id: "td-strip" });
    const entry = stripped.nodes["entry"];
    if (entry === undefined) {
      throw new Error("test bug");
    }
    (entry as unknown as { show: unknown[] }).show = [
      { kind: "strip", strip: { stripId: "missing" } },
    ];
    expect(() => registerStrategy(stripped, "fixture")).toThrowError(/G8/);
    expect(() =>
      recordValidationCheck("test:nope-strategy", { id: "x", scope: "s", result: "PASS" }),
    ).toThrowError(/unknown strategy/);
    recordValidationCheck("td-dup", { id: "c1", scope: "s", result: "PASS" });
    recordValidationCheck("td-dup", { id: "c1", scope: "s2", result: "PASS" });
    const checks = strategies().get("td-dup")?.validation.checks ?? [];
    expect(checks.filter((c) => c.id === "c1").length).toBe(1);
    expect(checks.find((c) => c.id === "c1")?.scope).toBe("s2");
  });

  it("registerClassifier guards ids, tags, and duplicates", () => {
    expect(() =>
      registerClassifier({ ...classifyFour, id: "" }),
    ).toThrowError(/classifier-id/);
    expect(() =>
      registerClassifier({ ...classifyFour, id: "test:empty-tags", resultTags: [] }),
    ).toThrowError(/classifier-tags/);
    expect(() => registerClassifier(classifyFour)).toThrowError(/classifier-dup/);
  });
});

describe("classifyFour (§23.2)", () => {
  it("convex class on four convex points", () => {
    const state = {
      seq: 0,
      k: 3 as const,
      mode: "break" as const,
      points: [P(0, 0), P(4, 0), P(4, 4), P(0, 4)].map((p, i) => ({
        id: `p${i + 1}`,
        owner: "maker" as const,
        pt: p,
        move: i + 1,
      })),
      turn: "breaker" as const,
      terminal: null,
      strategy: null,
    };
    const r = classifyFour.classify(
      state,
      { pts: ["p1", "p2", "p3", "p4"] },
      testConfig(100),
    );
    expect(r).toEqual({ kind: "classified", result: { tag: "convex" } });
  });

  it("one-interior class with outer/interior bindings", () => {
    const pts = [P(0, 0), P(4, 0), P(4, 4), P(1, 1)];
    const state = {
      seq: 0,
      k: 3 as const,
      mode: "break" as const,
      points: pts.map((p, i) => ({
        id: `p${i + 1}`,
        owner: "maker" as const,
        pt: p,
        move: i + 1,
      })),
      turn: "breaker" as const,
      terminal: null,
      strategy: null,
    };
    const cfg = testConfig(100);
    const r = classifyFour.classify(state, { pts: ["p1", "p2", "p3", "p4"] }, cfg);
    expect(r.kind).toBe("classified");
    if (r.kind === "classified") {
      expect(r.result.tag).toBe("one-interior");
      expect([...(r.result.bindings?.["outer"] as string[])].sort()).toEqual(
        ["p1", "p2", "p3"],
      );
      expect(r.result.bindings?.["interior"]).toBe("p4");
    }
    const b = classifyFour.boundaries(state, { pts: ["p1", "p2", "p3", "p4"] }, cfg);
    expect(b.kind).toBe("ok");
    if (b.kind === "ok") {
      expect(b.lines.length).toBe(6);
    }
  });

  it("|pts| ≠ 4 is an integrity failure", () => {
    const state = {
      seq: 0,
      k: 3 as const,
      mode: "break" as const,
      points: [],
      turn: "maker" as const,
      terminal: null,
      strategy: null,
    };
    const r = classifyFour.classify(state, { pts: ["p1", "p2"] }, testConfig(100));
    expect(r.kind).toBe("integrity");
  });
});

describe("effectiveStatus (Gate E precursor)", () => {
  it("core def without exact checks is validated-randomized", () => {
    const def = tinyDef({ id: "td-core5", k: 5 });
    const rs = registerStrategy(def, "core");
    expect(effectiveStatus(rs)).toBe("validated-randomized");
  });

  it("experimental tier maps directly", () => {
    const def = tinyDef({ id: "td-exp6", k: 6 });
    const rs = registerStrategy(def, "experimental-extension");
    expect(effectiveStatus(rs)).toBe("experimental-extension");
  });
});
