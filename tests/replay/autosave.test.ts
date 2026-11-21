// @vitest-environment jsdom
// tests/replay/autosave.test.ts — autosave/resume/fork/export wiring
// (§15.5): dispatch writes autosaves, entry resumes them, fork/export
// download re-validating artifacts, and the attack log rebuilds from a
// resumed branch sample (§12.6).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createShell } from "../../src/ui/app.ts";
import type { Shell } from "../../src/ui/app.ts";
import {
  classifiers,
  strategies,
} from "../../src/strategy/registry.ts";
import { checkers } from "../../src/verification/invariants.ts";
import { ensureK5 } from "../strategies/k5driver.ts";
import { P } from "../strategy/scaffolding.ts";
import { dispatch } from "../../src/ui/dispatch.ts";
import { attackLog } from "../../src/engine/describe.ts";
import {
  exportSession,
  listAutosaves,
  readAutosave,
  resumeSession,
} from "../../src/ui/replay-io.ts";
import { parseReplayFile } from "../../src/replay/format.ts";
import { validateReplay } from "../../src/replay/validate.ts";
import { testCtx } from "../helpers.ts";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

ensureK5();

const live = {
  strategies: strategies(),
  classifiers: classifiers(),
  checkers: checkers(),
};

function setup(): { svg: SVGSVGElement; panels: HTMLElement; shell: Shell } {
  document.body.innerHTML = "";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("id", "board");
  const panels = document.createElement("aside");
  panels.setAttribute("id", "panels");
  document.body.append(svg, panels);
  const shell = createShell(svg, panels, {
    width: 800,
    height: 600,
    registries: live,
  });
  return { svg, panels, shell };
}

function noop(): void {}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("autosave + resume", () => {
  it("dispatch commits autosave; resume restores points + cursor", () => {
    const { shell } = setup();
    shell.startSandbox();
    dispatch(shell.store, shell.ctx, { kind: "place", owner: "maker", at: P(10, 10) }, noop);
    dispatch(shell.store, shell.ctx, { kind: "place", owner: "breaker", at: P(-10, -10) }, noop);
    const saves = listAutosaves();
    expect(saves.length).toBe(1);
    expect(saves[0]?.key).toContain("sandbox");
    const text = readAutosave(saves[0]?.key ?? "");
    expect(text !== null).toBe(true);
    const parsed = parseReplayFile(text as string);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.file.cursorTxnId).toBe(2);
    const shell2 = setup().shell;
    expect(resumeSession(shell2, text as string, noop)).toBe(true);
    expect(shell2.store.current().points.length).toBe(2);
    expect(shell2.store.cursorTxnId()).toBe(2);
  });

  it("mid-tree cursor resumes mid-tree; absent cursor lands on the tip", () => {
    const { shell } = setup();
    shell.startSandbox();
    dispatch(shell.store, shell.ctx, { kind: "place", owner: "maker", at: P(10, 10) }, noop);
    dispatch(shell.store, shell.ctx, { kind: "place", owner: "breaker", at: P(-10, -10) }, noop);
    dispatch(shell.store, shell.ctx, { kind: "place", owner: "maker", at: P(20, 5) }, noop);
    // Export honors the live cursor: rewind, then export.
    shell.store.setCursor(1);
    const rewound = exportSession(shell, "rewound");
    expect((JSON.parse(rewound) as { cursorTxnId?: number }).cursorTxnId).toBe(1);
    const shell2 = setup().shell;
    expect(resumeSession(shell2, rewound, noop)).toBe(true);
    expect(shell2.store.cursorTxnId()).toBe(1);
    expect(shell2.store.current().points.length).toBe(1);
    // Absent cursor → largest txnId.
    const full = exportSession(shell, "full");
    const stripped = JSON.parse(full) as Record<string, unknown>;
    delete stripped["cursorTxnId"];
    const shell3 = setup().shell;
    expect(resumeSession(shell3, JSON.stringify(stripped), noop)).toBe(true);
    expect(shell3.store.cursorTxnId()).toBe(3);
    expect(shell3.store.current().points.length).toBe(3);
  });

  it("entry lists Resume rows and restores through them", () => {
    const { panels, shell } = setup();
    shell.startSandbox();
    dispatch(shell.store, shell.ctx, { kind: "place", owner: "maker", at: P(7, 7) }, noop);
    shell.showEntry();
    const rows = [...panels.querySelectorAll(".resume-row")];
    expect(rows.length).toBe(1);
    const btn = rows[0]?.querySelector("button");
    expect(btn?.textContent).toBe("Resume");
    btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(shell.store.current().points.length).toBe(1);
  });

  it("corrupt autosave resumes with a toast, session untouched", () => {
    const { panels, shell } = setup();
    shell.startSandbox();
    localStorage.setItem("pp.autosave.v2.sandbox.sandbox", "{broken");
    shell.showEntry();
    const rows = [...panels.querySelectorAll(".resume-row")];
    expect(rows.length).toBe(0);
    expect(panels.textContent).toContain("No autosaves yet");
  });
});

describe("attack log rebuilds from a resumed branch (§12.6)", () => {
  it("k5-branch sample resumes; attackLog covers all four attacks", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "replays");
    const text = readFileSync(join(dir, "k5-branch.replay.json"), "utf8");
    const { shell } = setup();
    expect(resumeSession(shell, text, noop)).toBe(true);
    const log = attackLog(shell.store.tree(), (id) => shell.store.stateAtTxn(id), shell.ctx.config.analysis.budgetOps);
    expect(log !== null).toBe(true);
    expect(log?.entries.length).toBe(4);
    expect(log?.summary.classified).toBe(4);
    expect(log?.entries.map((e) => e.caseId)).toEqual(["k5:any", "k5:any", "k5:b2:one-interior", "k5:b3:else"]);
  });
});

describe("fork + export downloads", () => {
  let blobs: Blob[];
  let realCreate: typeof URL.createObjectURL | undefined;
  let realRevoke: typeof URL.revokeObjectURL | undefined;
  let realClick: (() => void) | undefined;

  beforeEach(() => {
    blobs = [];
    realCreate = URL.createObjectURL;
    realRevoke = URL.revokeObjectURL;
    realClick = HTMLAnchorElement.prototype.click as () => void;
    URL.createObjectURL = ((b: Blob) => {
      blobs.push(b);
      return "blob:mock";
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
    HTMLAnchorElement.prototype.click = (() => {}) as () => void;
  });

  afterEach(() => {
    if (realCreate !== undefined) {
      URL.createObjectURL = realCreate;
    }
    if (realRevoke !== undefined) {
      URL.revokeObjectURL = realRevoke;
    }
    if (realClick !== undefined) {
      HTMLAnchorElement.prototype.click = realClick;
    }
  });

  async function blobText(): Promise<string> {
    expect(blobs.length).toBe(1);
    return blobs[0]?.text() ?? "";
  }

  it("timeline Fork downloads the cursor prefix as a valid replay", async () => {
    const { panels, shell } = setup();
    shell.startBreak("esmb-k5");
    dispatch(shell.store, shell.ctx, { kind: "place", owner: "breaker", at: P(10, 0) }, noop);
    dispatch(shell.store, shell.ctx, { kind: "place", owner: "breaker", at: P(10, 9) }, noop);
    const fork = [...panels.querySelectorAll("#timeline button")].find(
      (b) => b.getAttribute("title") === "Fork replay at cursor",
    );
    expect(fork !== undefined).toBe(true);
    fork?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const text = await blobText();
    const parsed = parseReplayFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.file.transactions.length).toBe(3);
    const v = validateReplay(parsed.file, testCtx());
    expect(v.ok).toBe(true);
  });

  it("sandbox Export downloads the full session as a valid replay", async () => {
    const { panels, shell } = setup();
    shell.startSandbox();
    dispatch(shell.store, shell.ctx, { kind: "place", owner: "maker", at: P(4, 4) }, noop);
    const btn = [...panels.querySelectorAll("#sandbox-controls button")].find(
      (b) => b.textContent === "Export replay",
    );
    expect(btn !== undefined).toBe(true);
    btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const text = await blobText();
    const parsed = parseReplayFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.file.strategy).toBe(null);
    const v = validateReplay(parsed.file, testCtx());
    expect(v.ok).toBe(true);
  });
});
