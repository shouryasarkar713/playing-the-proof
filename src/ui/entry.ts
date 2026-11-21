// ui/entry.ts — entry screen (§11.2): title, mode cards, strategy picker
// (badges derived via engine listStrategies — Gate E), resume + load
// replay (Phase 15). Help arrives in Phase 19.
import { k6PresetSupplied, listStrategies } from "../engine/describe.ts";
import type { Shell } from "./app.ts";
import {
  listAutosaves,
  pickReplayFile,
  readAutosave,
  resumeSession,
} from "./replay-io.ts";
import { mountAbout } from "./about.ts";
import { mountHelp } from "./help.ts";

// k=6 sessions start from a StrategyStart record (§24.0b): the entry
// chooser supplies the shipped pentagon preset (richer starts — promotion
// from a won k=5 session — arrive via the win card's Grow-to-6 button).
export function startStrategy(
  shell: Shell,
  strategyId: string,
  mode: "proof" | "break",
): void {
  document.getElementById("entry")?.remove();
  if (strategyId === "esmb-k6" || strategyId === "esmb-k6-wide") {
    if (mode === "proof") {
      shell.startProof(strategyId, k6PresetSupplied());
    } else {
      shell.startBreak(strategyId, k6PresetSupplied());
    }
    return;
  }
  if (mode === "proof") {
    shell.startProof(strategyId);
  } else {
    shell.startBreak(strategyId);
  }
}

function startFor(
  shell: Shell,
  host: HTMLElement,
  strategyId: string,
  mode: "proof" | "break",
): void {
  host.remove();
  startStrategy(shell, strategyId, mode);
}

export function mountEntry(
  shell: Shell,
  panels: HTMLElement,
  toast: (message: string) => void,
): void {
  const host = document.createElement("div");
  host.id = "entry";
  // v2 restyle: hero card over the board (presentation-only wrapper;
  // every inner class/id the tests select is unchanged).
  const card = document.createElement("div");
  card.className = "start-card";
  const eyebrow = document.createElement("p");
  eyebrow.className = "start-eyebrow";
  eyebrow.textContent = "Erdős–Szekeres · Maker–Breaker";
  card.appendChild(eyebrow);
  const title = document.createElement("h1");
  title.textContent = "Playing the Proof";
  card.appendChild(title);
  const sub = document.createElement("p");
  sub.textContent =
    "An interactive laboratory for Erdős–Szekeres Maker–Breaker strategies.";
  card.appendChild(sub);

  const cards = document.createElement("div");
  cards.className = "mode-cards";

  const proofCard = document.createElement("div");
  proofCard.className = "mode-card";
  const proofHead = document.createElement("h2");
  proofHead.textContent = "Proof mode";
  proofCard.appendChild(proofHead);

  const showExperimental = document.createElement("label");
  const expToggle = document.createElement("input");
  expToggle.type = "checkbox";
  showExperimental.append(
    expToggle,
    document.createTextNode(" show experimental"),
  );
  proofCard.appendChild(showExperimental);

  const picker = document.createElement("div");
  picker.className = "strategy-picker";
  const paintPicker = (): void => {
    picker.replaceChildren();
    const items = listStrategies(shell.ctx).filter(
      (s) => s.tier !== "experimental-extension" || expToggle.checked,
    );
    if (items.length === 0) {
      const p = document.createElement("p");
      p.textContent = "No strategies registered.";
      picker.appendChild(p);
      return;
    }
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "strategy-row";
      const name = document.createElement("span");
      name.textContent = `${item.id} (k=${item.k})`;
      const badge = document.createElement("span");
      badge.className = "status-badge";
      badge.textContent = item.status;
      badge.title = `${item.paper} · v${item.version}`;
      const start = document.createElement("button");
      start.textContent = "Start";
      start.addEventListener("click", () => {
        startFor(shell, host, item.id, "proof");
      });
      row.append(name, badge, start);
      picker.appendChild(row);
    }
  };
  expToggle.addEventListener("change", paintPicker);
  paintPicker();
  proofCard.appendChild(picker);
  cards.appendChild(proofCard);

  const breakCard = document.createElement("div");
  breakCard.className = "mode-card";
  const breakHead = document.createElement("h2");
  breakHead.textContent = "Break the Proof";
  breakCard.appendChild(breakHead);
  const breakSub = document.createElement("p");
  breakSub.textContent =
    "Play Breaker against the encoded Maker strategy; every attack is classified and absorbed on record.";
  breakCard.appendChild(breakSub);

  const breakExperimental = document.createElement("label");
  const breakExpToggle = document.createElement("input");
  breakExpToggle.type = "checkbox";
  breakExperimental.append(
    breakExpToggle,
    document.createTextNode(" show experimental"),
  );
  breakCard.appendChild(breakExperimental);

  const breakPicker = document.createElement("div");
  breakPicker.className = "strategy-picker";
  const paintBreakPicker = (): void => {
    breakPicker.replaceChildren();
    const items = listStrategies(shell.ctx).filter(
      (s) => s.tier !== "experimental-extension" || breakExpToggle.checked,
    );
    if (items.length === 0) {
      const p = document.createElement("p");
      p.textContent = "No strategies registered.";
      breakPicker.appendChild(p);
      return;
    }
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "strategy-row";
      const name = document.createElement("span");
      name.textContent = `${item.id} (k=${item.k})`;
      const badge = document.createElement("span");
      badge.className = "status-badge";
      badge.textContent = item.status;
      badge.title = `${item.paper} · v${item.version}`;
      const start = document.createElement("button");
      start.textContent = "Start";
      start.addEventListener("click", () => {
        startFor(shell, host, item.id, "break");
      });
      row.append(name, badge, start);
      breakPicker.appendChild(row);
    }
  };
  breakExpToggle.addEventListener("change", paintBreakPicker);
  paintBreakPicker();
  breakCard.appendChild(breakPicker);
  cards.appendChild(breakCard);

  const sandboxCard = document.createElement("div");
  sandboxCard.className = "mode-card";
  const sandboxHead = document.createElement("h2");
  sandboxHead.textContent = "Sandbox (k=5)";
  sandboxCard.appendChild(sandboxHead);
  const sandboxBtn = document.createElement("button");
  sandboxBtn.textContent = "Start";
  sandboxBtn.addEventListener("click", () => {
    host.remove();
    shell.startSandbox();
  });
  sandboxCard.appendChild(sandboxBtn);
  cards.appendChild(sandboxCard);

  const labCard = document.createElement("div");
  labCard.className = "mode-card";
  const labHead = document.createElement("h2");
  labHead.textContent = "Parameter Lab";
  labCard.appendChild(labHead);
  const labSub = document.createElement("p");
  labSub.textContent =
    "Pick a game model, k, bias and rule: see whether a cited theorem covers it, run a bounded simulation where none does, and read the discrepancy register.";
  labCard.appendChild(labSub);
  const labBtn = document.createElement("button");
  labBtn.textContent = "Open";
  labBtn.setAttribute("aria-label", "Open the Parameter Lab");
  labBtn.addEventListener("click", () => {
    host.remove();
    shell.startLab();
  });
  labCard.appendChild(labBtn);
  cards.appendChild(labCard);

  const kstripCard = document.createElement("div");
  kstripCard.className = "mode-card";
  const kstripHead = document.createElement("h2");
  kstripHead.textContent = "k-strip explorer";
  kstripCard.appendChild(kstripHead);
  const kstripSub = document.createElement("p");
  kstripSub.textContent =
    "Run the recursive k-strip construction with exact geometry, step through pairing, Breaker budget and harvest, or play Breaker against it.";
  kstripCard.appendChild(kstripSub);
  const kstripBtn = document.createElement("button");
  kstripBtn.textContent = "Open";
  kstripBtn.setAttribute("aria-label", "Open the k-strip explorer");
  kstripBtn.addEventListener("click", () => {
    host.remove();
    shell.startKStrip();
  });
  kstripCard.appendChild(kstripBtn);
  cards.appendChild(kstripCard);

  card.appendChild(cards);
  host.appendChild(card);

  // Resume + load replay (Phase 15).
  const replayBox = document.createElement("div");
  replayBox.id = "entry-replay";
  const replayHead = document.createElement("h2");
  replayHead.textContent = "Replays";
  replayBox.appendChild(replayHead);
  const saves = listAutosaves();
  if (saves.length > 0) {
    for (const entry of saves) {
      const row = document.createElement("div");
      row.className = "resume-row";
      const name = document.createElement("span");
      name.textContent = `Resume: ${entry.label}`;
      const resume = document.createElement("button");
      resume.textContent = "Resume";
      resume.addEventListener("click", () => {
        const text = readAutosave(entry.key);
        if (text === null) {
          toast("Autosave unreadable.");
          return;
        }
        // (QA D1): a rejected replay must leave the entry screen up.
        if (resumeSession(shell, text, toast)) {
          host.remove();
        }
      });
      row.append(name, resume);
      replayBox.appendChild(row);
    }
  } else {
    const none = document.createElement("p");
    none.textContent =
      "No autosaves yet — they appear after your first placement.";
    replayBox.appendChild(none);
  }
  const loadBtn = document.createElement("button");
  loadBtn.textContent = "Load Replay";
  loadBtn.addEventListener("click", () => {
    pickReplayFile(toast).then(
      (text) => {
        if (text === null) {
          return;
        }
        if (resumeSession(shell, text, toast)) {
          host.remove();
        }
      },
      () => {
        toast("Replay unreadable.");
      },
    );
  });
  replayBox.appendChild(loadBtn);
  card.appendChild(replayBox);

  const actions = document.createElement("div");
  actions.className = "entry-actions";
  const aboutBtn = document.createElement("button");
  aboutBtn.textContent = "About";
  aboutBtn.addEventListener("click", () => {
    host.remove();
    mountAbout(shell, panels);
  });
  const helpBtn = document.createElement("button");
  helpBtn.textContent = "Help";
  helpBtn.addEventListener("click", () => {
    host.remove();
    mountHelp(shell, panels);
  });
  actions.append(aboutBtn, helpBtn);
  card.appendChild(actions);
  panels.appendChild(host);
}
