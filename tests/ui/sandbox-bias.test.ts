// @vitest-environment jsdom
// tests/ui/sandbox-bias.test.ts — the sandbox bias control: GameState.bias,
// engine-enforced turn order, caption, input validation, rule/k/reset/generator
// keeping the bias, replay format v4 export/import, autosave.
import { afterEach, describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import { turnSequence } from "../../src/game/turnorder.ts";
import { biasCaption } from "../../src/explain/bias.ts";
import { dispatch } from "../../src/ui/dispatch.ts";
import { resumeSession } from "../../src/ui/replay-io.ts";
import { parseReplayFile } from "../../src/replay/format.ts";
import { validateReplay } from "../../src/replay/validate.ts";
import { captureDownloads, click, setValue, setupShell } from "./modes-helpers.ts";

type Setup = ReturnType<typeof setupShell>;

function btn(panels: HTMLElement, text: string): HTMLButtonElement | null {
  return ([...panels.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement | undefined) ?? null;
}

function setBias(s: Setup, text: string): void {
  setValue(s.panels.querySelector("#sandbox-bias-input"), text);
  click(s.panels.querySelector("#sandbox-bias-apply"));
}

function clickBoard(s: Setup, x: number, y: number): void {
  s.svg.dispatchEvent(new MouseEvent("click", { clientX: x, clientY: y, bubbles: true }));
}

function place(s: Setup, owner: "maker" | "breaker", x: number, y: number, toasts: string[] = []): void {
  dispatch(
    s.shell.store,
    s.shell.ctx,
    { kind: "place", owner, at: pt(Rat.make(BigInt(x)), Rat.make(BigInt(y))) },
    (m) => toasts.push(m),
  );
}

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("bias control", () => {
  it("default 1:1: input shows 1, caption names the alternation, owners are free", () => {
    const s = setupShell();
    s.shell.startSandbox(5);
    expect((s.panels.querySelector("#sandbox-bias-input") as HTMLInputElement).value).toBe("1");
    expect(s.panels.querySelector("#sandbox-bias-caption")?.textContent).toBe(biasCaption(undefined));
    expect(s.shell.store.current().bias).toBeUndefined();
    expect(btn(s.panels, "Maker")?.disabled).toBe(false);
    expect(btn(s.panels, "Breaker")?.disabled).toBe(false);
  });

  it("setting an integer bias starts a fresh biased sandbox; the turn order is engine-enforced", () => {
    const s = setupShell();
    s.shell.startSandbox(5);
    place(s, "maker", 1, 1);
    setBias(s, "2");
    const st = s.shell.store.current();
    expect(st.bias?.toString()).toBe("2/1");
    expect(st.points.length).toBe(0);
    expect(s.panels.querySelector("#sandbox-bias-caption")?.textContent).toBe(biasCaption(st.bias));
    expect(btn(s.panels, "Maker")?.disabled).toBe(true);
    expect(btn(s.panels, "Breaker")?.disabled).toBe(true);
    expect(btn(s.panels, "Maker")?.getAttribute("aria-pressed")).toBe("true");
    // board clicks place M, B, B (owner follows the turn)
    clickBoard(s, 400, 300);
    expect(btn(s.panels, "Breaker")?.getAttribute("aria-pressed")).toBe("true");
    clickBoard(s, 450, 350);
    clickBoard(s, 500, 320);
    clickBoard(s, 300, 420);
    expect(s.shell.store.current().points.map((p) => p.owner)).toEqual(["maker", "breaker", "breaker", "maker"]);
    expect(s.panels.querySelector("#sandbox-diagnostics")?.textContent).toContain("turn: breaker");
  });

  it("an out-of-turn placement is rejected with the out-of-turn text", () => {
    const s = setupShell();
    s.shell.startSandbox(5);
    setBias(s, "3");
    const toasts: string[] = [];
    place(s, "breaker", 2, 2, toasts);
    expect(s.shell.store.current().points.length).toBe(0);
    expect(toasts.join(" ")).toContain("Out of turn");
    place(s, "maker", 2, 2, toasts);
    expect(s.shell.store.current().points.length).toBe(1);
  });

  it("non-integer and sub-unit values are accepted: 3/2, 1/2, 0, 16, 12/12 (= 1:1)", () => {
    const s = setupShell();
    s.shell.startSandbox(4);
    for (const [txt, want] of [
      ["3/2", "3/2"],
      ["1/2", "1/2"],
      ["0", "0/1"],
      ["16", "16/1"],
      ["2.5", "5/2"],
    ] as const) {
      setBias(s, txt);
      expect(s.shell.store.current().bias?.toString(), txt).toBe(want);
    }
    setBias(s, "12/12");
    expect(s.shell.store.current().bias).toBeUndefined();
  });

  it("invalid values leave the session untouched", () => {
    const s = setupShell();
    s.shell.startSandbox(4);
    setBias(s, "3");
    place(s, "maker", 1, 1);
    for (const bad of ["abc", "-1", "17", "1/13", "3/0", "", "1e2", "16.5"]) {
      setBias(s, bad);
      expect(s.shell.store.current().bias?.toString(), bad).toBe("3/1");
      expect(s.shell.store.current().points.length, bad).toBe(1);
    }
  });

  it("re-applying the same bias does not restart; 1 returns to the unbiased game", () => {
    const s = setupShell();
    s.shell.startSandbox(4);
    setBias(s, "2");
    place(s, "maker", 1, 1);
    setBias(s, "2");
    expect(s.shell.store.current().points.length).toBe(1);
    setBias(s, "1");
    expect(s.shell.store.current().bias).toBeUndefined();
    expect(s.shell.store.current().points.length).toBe(0);
    expect(btn(s.panels, "Maker")?.disabled).toBe(false);
  });

  it("k, rule, Reset and the generator all keep the bias", () => {
    const s = setupShell();
    s.shell.startSandbox(4);
    setBias(s, "5/2");
    click(btn(s.panels, "6"));
    expect(s.shell.store.current().k).toBe(6);
    expect(s.shell.store.current().bias?.toString()).toBe("5/2");
    click(btn(s.panels, "Bichromatic"));
    expect(s.shell.store.current().gameMode).toBe("bichromatic");
    expect(s.shell.store.current().bias?.toString()).toBe("5/2");
    click(btn(s.panels, "Reset"));
    expect(s.shell.store.current().bias?.toString()).toBe("5/2");
    click(btn(s.panels, "Generate"));
    const st = s.shell.store.current();
    expect(st.points.length).toBe(12);
    expect(st.bias?.toString()).toBe("5/2");
    expect(st.points.map((p) => p.owner)).toEqual(turnSequence(st.bias, 12));
  });

  it("the Overmars preset is unavailable under a bias, with the reason shown", () => {
    const s = setupShell();
    s.shell.startSandbox(6);
    setBias(s, "2");
    const load = btn(s.panels, "Load Overmars-29");
    expect(load?.disabled).toBe(true);
    expect(s.panels.querySelector("#preset-why")?.textContent).toContain("bias other than 1:1");
  });
});

describe("replay of biased sandbox sessions (format v4)", () => {
  it("exports v4 with gameMode and bias, validates, imports back with the same bias and turn order", async () => {
    const s = setupShell();
    const dl = captureDownloads();
    try {
      s.shell.startSandbox(3);
      setBias(s, "2");
      for (const [i, o] of (["maker", "breaker", "breaker", "maker"] as const).entries()) {
        place(s, o, i * 4 + 1, i * i + 2);
      }
      click(btn(s.panels, "Export replay"));
      const text = (await dl.texts[0]) as string;
      const doc = JSON.parse(text) as { version: number; config: { bias?: string; gameMode?: string } };
      expect(doc.version).toBe(4);
      expect(doc.config.bias).toBe("2/1");
      expect(doc.config.gameMode).toBe("monochromatic");
      const parsed = parseReplayFile(text);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) {
        return;
      }
      expect(validateReplay(parsed.file, s.shell.ctx).ok).toBe(true);
      const t = setupShell();
      t.shell.showEntry();
      expect(resumeSession(t.shell, text, () => undefined)).toBe(true);
      const st = t.shell.store.current();
      expect(st.bias?.toString()).toBe("2/1");
      expect(st.points.map((p) => p.owner)).toEqual(["maker", "breaker", "breaker", "maker"]);
      expect((t.panels.querySelector("#sandbox-bias-input") as HTMLInputElement).value).toBe("2");
    } finally {
      dl.restore();
    }
  });

  it("a 1:1 export is still v2 with neither gameMode nor bias", async () => {
    const s = setupShell();
    const dl = captureDownloads();
    try {
      s.shell.startSandbox(3);
      place(s, "maker", 1, 1);
      place(s, "breaker", 5, 9);
      click(btn(s.panels, "Export replay"));
      const doc = JSON.parse((await dl.texts[0]) as string) as { version: number; config: Record<string, unknown> };
      expect(doc.version).toBe(2);
      expect("bias" in doc.config).toBe(false);
      expect("gameMode" in doc.config).toBe(false);
    } finally {
      dl.restore();
    }
  });

  it("tampering with the recorded bias is rejected", async () => {
    const s = setupShell();
    const dl = captureDownloads();
    try {
      s.shell.startSandbox(3);
      setBias(s, "2");
      place(s, "maker", 1, 1);
      place(s, "breaker", 5, 9);
      click(btn(s.panels, "Export replay"));
      const doc = JSON.parse((await dl.texts[0]) as string) as { config: { bias: string } };
      doc.config.bias = "1/1";
      const toasts: string[] = [];
      const t = setupShell();
      t.shell.showEntry();
      expect(resumeSession(t.shell, JSON.stringify(doc), (m) => toasts.push(m))).toBe(false);
      expect(toasts.join(" ")).toContain("Replay rejected");
    } finally {
      dl.restore();
    }
  });

  it("autosave of a biased sandbox resumes with its bias", () => {
    const s = setupShell();
    s.shell.startSandbox(3);
    setBias(s, "3/2");
    place(s, "maker", 1, 1);
    place(s, "breaker", 4, 2);
    const key = [...Array(localStorage.length).keys()].map((i) => localStorage.key(i) as string).find((k) => k.includes("sandbox"));
    expect(key).toBeDefined();
    const text = localStorage.getItem(key as string) as string;
    expect(JSON.parse(text).version).toBe(4);
    const t = setupShell();
    t.shell.showEntry();
    expect(resumeSession(t.shell, text, () => undefined)).toBe(true);
    expect(t.shell.store.current().bias?.toString()).toBe("3/2");
  });
});
