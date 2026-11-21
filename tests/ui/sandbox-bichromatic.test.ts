// @vitest-environment jsdom
// tests/ui/sandbox-bichromatic.test.ts — the sandbox's mono/bichromatic toggle:
// GameState.gameMode, ownership-aware hole analysis (analyzeWinHoles), the
// rule caption, replay format v3 export/import, and v2 for monochromatic.
import { afterEach, describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import { analyzeWinHoles } from "../../src/game/gamemode.ts";
import { analyzeHoles } from "../../src/geometry/holes.ts";
import { ruleCaption } from "../../src/explain/gamemode.ts";
import { dispatch } from "../../src/ui/dispatch.ts";
import { resumeSession } from "../../src/ui/replay-io.ts";
import { parseReplayFile } from "../../src/replay/format.ts";
import { validateReplay } from "../../src/replay/validate.ts";
import { captureDownloads, click, setupShell } from "./modes-helpers.ts";

type Setup = ReturnType<typeof setupShell>;

function place(s: Setup, owner: "maker" | "breaker", x: number, y: number): void {
  dispatch(s.shell.store, s.shell.ctx, { kind: "place", owner, at: pt(Rat.make(BigInt(x)), Rat.make(BigInt(y))) }, () => undefined);
}

function btn(panels: HTMLElement, text: string): HTMLButtonElement | null {
  return ([...panels.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement | undefined) ?? null;
}

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("sandbox rule toggle", () => {
  it("defaults to monochromatic; the toggle starts a bichromatic session and shows ruleCaption", () => {
    const s = setupShell();
    s.shell.startSandbox(3);
    expect(s.shell.store.current().gameMode).toBeUndefined(); // absent means monochromatic
    expect(s.panels.querySelector("#sandbox-rule-caption")?.textContent).toBe(ruleCaption("monochromatic"));
    const mono = btn(s.panels, "Monochromatic");
    const bi = btn(s.panels, "Bichromatic");
    expect(mono?.getAttribute("aria-pressed")).toBe("true");
    expect(bi?.getAttribute("aria-pressed")).toBe("false");
    click(bi);
    expect(s.shell.store.current().gameMode).toBe("bichromatic");
    expect(s.panels.querySelector("#sandbox-rule-caption")?.textContent).toBe(ruleCaption("bichromatic"));
    expect(btn(s.panels, "Bichromatic")?.getAttribute("aria-pressed")).toBe("true");
    expect(s.panels.querySelector("#sandbox-diagnostics")?.textContent).toContain("bichromatic rule");
    // k is kept, and Reset keeps the rule
    expect(s.shell.store.current().k).toBe(3);
    click(btn(s.panels, "Reset"));
    expect(s.shell.store.current().gameMode).toBe("bichromatic");
    // and back
    click(btn(s.panels, "Monochromatic"));
    expect(s.shell.store.current().gameMode).toBeUndefined();
  });

  it("the hole analysis is ownership-aware: a Breaker vertex does not make a bichromatic hole", () => {
    const s = setupShell();
    s.shell.startSandbox(3, "bichromatic");
    place(s, "maker", 0, 0);
    place(s, "maker", 10, 1);
    place(s, "breaker", 5, 9);
    const st = s.shell.store.current();
    const budget = { budget: 1_000_000 };
    const win = analyzeWinHoles(st, 3, budget);
    const allPoints = analyzeHoles(st.points.map((p) => ({ id: p.id, pt: p.pt })), 3, budget);
    expect(allPoints.kind === "exhaustive" ? allPoints.holes.length : -1).toBe(1);
    expect(win.kind === "exhaustive" ? win.holes.length : -1).toBe(0);
    // what the UI shows is the ownership-aware one
    const shown = s.shell.holes();
    expect(shown.kind === "exhaustive" ? shown.holes.length : -1).toBe(0);
    expect(s.panels.querySelector("#sandbox-diagnostics")?.textContent).toContain("0 3-hole(s)");
    expect(s.svg.querySelectorAll("polygon.viz-hole").length).toBe(0);
    // a third Maker point far away creates Maker-only holes only where no Breaker point blocks
    place(s, "maker", 4, -30);
    const after = s.shell.holes();
    expect(after.kind).toBe("exhaustive");
    const stNow = s.shell.store.current();
    const want = analyzeWinHoles(stNow, 3, budget);
    expect(after.kind === "exhaustive" && want.kind === "exhaustive" ? after.holes.length : -1).toBe(
      want.kind === "exhaustive" ? want.holes.length : -2,
    );
    expect(after.kind === "exhaustive" ? after.holes.length : 0).toBeGreaterThan(0);
    // the same board in the monochromatic session has strictly more 3-holes
    const mono = setupShell();
    mono.shell.startSandbox(3);
    place(mono, "maker", 0, 0);
    place(mono, "maker", 10, 1);
    place(mono, "breaker", 5, 9);
    place(mono, "maker", 4, -30);
    const m = mono.shell.holes();
    expect(m.kind === "exhaustive" && after.kind === "exhaustive" ? m.holes.length > after.holes.length : false).toBe(true);
  });

  it("count-all-k uses the rule in force", () => {
    const s = setupShell();
    s.shell.startSandbox(3, "bichromatic");
    place(s, "maker", 0, 0);
    place(s, "maker", 10, 1);
    place(s, "breaker", 5, 9);
    click(btn(s.panels, "Count all k"));
    expect(s.panels.querySelector("#allk-counts")?.textContent).toContain("k=3: 0 hole(s), exhaustive over 3 points");
    const m = setupShell();
    m.shell.startSandbox(3);
    place(m, "maker", 0, 0);
    place(m, "maker", 10, 1);
    place(m, "breaker", 5, 9);
    click(btn(m.panels, "Count all k"));
    expect(m.panels.querySelector("#allk-counts")?.textContent).toContain("k=3: 1 hole(s), exhaustive over 3 points");
  });

  it("the Overmars preset is unavailable under the bichromatic rule, with the reason visible", () => {
    const s = setupShell();
    s.shell.startSandbox(6, "bichromatic");
    const load = btn(s.panels, "Load Overmars-29");
    expect(load?.disabled).toBe(true);
    expect(load?.getAttribute("aria-describedby")).toBe("preset-why");
    expect(s.panels.querySelector("#preset-why")?.textContent).toContain("monochromatic game");
    const mono = setupShell();
    mono.shell.startSandbox(6);
    expect(btn(mono.panels, "Load Overmars-29")?.disabled).toBe(false);
  });

  it("the seeded generator keeps the session's rule", () => {
    const s = setupShell();
    s.shell.startSandbox(4, "bichromatic");
    click(btn(s.panels, "Generate"));
    expect(s.shell.store.current().points.length).toBe(12);
    expect(s.shell.store.current().gameMode).toBe("bichromatic");
  });
});

describe("replay of bichromatic sandbox sessions (format v3)", () => {
  it("exports v3 with config.gameMode, validates, and imports back into a bichromatic sandbox", async () => {
    const s = setupShell();
    const dl = captureDownloads();
    try {
      s.shell.startSandbox(3, "bichromatic");
      place(s, "maker", 0, 0);
      place(s, "breaker", 5, 9);
      place(s, "maker", 10, 1);
      click(btn(s.panels, "Export replay"));
      const text = (await dl.texts[0]) as string;
      const doc = JSON.parse(text) as { version: number; config: { gameMode?: string; mode: string } };
      expect(doc.version).toBe(3);
      expect(doc.config.gameMode).toBe("bichromatic");
      expect(dl.names[0]).toContain("sandbox");
      const parsed = parseReplayFile(text);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) {
        return;
      }
      expect(validateReplay(parsed.file, s.shell.ctx).ok).toBe(true);
      // import into a fresh shell
      const t = setupShell();
      t.shell.showEntry();
      expect(resumeSession(t.shell, text, () => undefined)).toBe(true);
      const st = t.shell.store.current();
      expect(st.gameMode).toBe("bichromatic");
      expect(st.points.length).toBe(3);
      expect(st.points.map((p) => p.owner)).toEqual(["maker", "breaker", "maker"]);
      expect(t.panels.querySelector("#sandbox-rule-caption")?.textContent).toBe(ruleCaption("bichromatic"));
    } finally {
      dl.restore();
    }
  });

  it("a monochromatic export stays format v2 with no gameMode field (Core replays are unchanged)", async () => {
    const s = setupShell();
    const dl = captureDownloads();
    try {
      s.shell.startSandbox(3);
      place(s, "maker", 0, 0);
      place(s, "breaker", 5, 9);
      click(btn(s.panels, "Export replay"));
      const doc = JSON.parse((await dl.texts[0]) as string) as { version: number; config: Record<string, unknown> };
      expect(doc.version).toBe(2);
      expect("gameMode" in doc.config).toBe(false);
    } finally {
      dl.restore();
    }
  });

  it("tampering with the recorded rule is rejected (the hash chain covers it)", async () => {
    const s = setupShell();
    const dl = captureDownloads();
    try {
      s.shell.startSandbox(3, "bichromatic");
      place(s, "maker", 0, 0);
      place(s, "maker", 10, 1);
      place(s, "breaker", 5, 9);
      click(btn(s.panels, "Export replay"));
      const doc = JSON.parse((await dl.texts[0]) as string) as { config: { gameMode: string } };
      doc.config.gameMode = "monochromatic";
      const toasts: string[] = [];
      const t = setupShell();
      t.shell.showEntry();
      expect(resumeSession(t.shell, JSON.stringify(doc), (m) => toasts.push(m))).toBe(false);
      expect(toasts.join(" ")).toContain("Replay rejected");
      expect(t.panels.querySelector("#entry")).not.toBeNull();
    } finally {
      dl.restore();
    }
  });

  it("autosave of a bichromatic sandbox resumes bichromatic", () => {
    const s = setupShell();
    s.shell.startSandbox(3, "bichromatic");
    place(s, "maker", 1, 1);
    place(s, "breaker", 4, 2);
    const key = [...Array(localStorage.length).keys()].map((i) => localStorage.key(i) as string).find((k) => k.includes("sandbox"));
    expect(key).toBeDefined();
    const text = localStorage.getItem(key as string) as string;
    expect(JSON.parse(text).version).toBe(3);
    const t = setupShell();
    t.shell.showEntry();
    expect(resumeSession(t.shell, text, () => undefined)).toBe(true);
    expect(t.shell.store.current().gameMode).toBe("bichromatic");
  });
});
