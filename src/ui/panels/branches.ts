// ui/panels/branches.ts — the response-class panel: BEFORE a branch is entered,
// each Breaker reply class of the parked node is shown with its verification
// class as text (not colour alone) plus a short legend.
import type { BranchInfo, BranchInteraction } from "../../engine/describe.ts";

export const BRANCH_LABEL: Record<BranchInteraction, string> = {
  interactive: "Interactive",
  guided: "Guided",
  unverified: "Not encoded",
};

export const BRANCH_MEANING: Record<BranchInteraction, string> = {
  interactive: "this reply class is verified exactly; play it freely",
  guided: "the walkthrough continues along the verified path and every move is re-checked exactly",
  unverified: "this reply class is not encoded: the session ends as uncovered",
};

export function branchLabel(
  interaction: BranchInteraction | null,
): string | null {
  return interaction === null ? null : BRANCH_LABEL[interaction];
}

export function renderBranches(
  el: HTMLElement,
  info: readonly BranchInfo[] | null,
): void {
  el.replaceChildren();
  if (info === null) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const title = document.createElement("h3");
  title.textContent = "Reply classes";
  el.appendChild(title);
  const list = document.createElement("ul");
  for (const b of info) {
    const li = document.createElement("li");
    const tag = document.createElement("span");
    const kind = b.interaction ?? "interactive";
    tag.className = `status-badge branch-tag branch-${kind}`;
    tag.textContent = branchLabel(b.interaction) ?? "";
    tag.title = BRANCH_MEANING[kind];
    li.append(tag, document.createTextNode(` ${b.caseId}`));
    li.setAttribute(
      "aria-label",
      `${b.caseId}: ${branchLabel(b.interaction) ?? ""} — ${BRANCH_MEANING[kind]}`,
    );
    list.appendChild(li);
  }
  el.appendChild(list);
  const legend = document.createElement("p");
  legend.className = "honesty branch-legend";
  legend.textContent =
    "Interactive: verified exactly, play freely. Guided: follows the verified path, each move re-checked. Not encoded: ends as uncovered.";
  el.appendChild(legend);
}
