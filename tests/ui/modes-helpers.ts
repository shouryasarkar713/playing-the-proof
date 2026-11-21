// Shared jsdom scaffolding for the lab / k-strip explorer UI tests.
import { createShell } from "../../src/ui/app.ts";
import type { Shell } from "../../src/ui/app.ts";
import { classifiers, strategies } from "../../src/strategy/registry.ts";
import { checkers } from "../../src/verification/invariants.ts";
import { ensureK5 } from "../strategies/k5driver.ts";
import { ensureK6 } from "../strategies/k6driver.ts";

ensureK5();
ensureK6();

export function setupShell(): { svg: SVGSVGElement; panels: HTMLElement; shell: Shell } {
  document.body.innerHTML = "";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("id", "board");
  const panels = document.createElement("aside");
  panels.setAttribute("id", "panels");
  document.body.append(svg, panels);
  const shell = createShell(svg, panels, {
    width: 800,
    height: 600,
    registries: { strategies: strategies(), classifiers: classifiers(), checkers: checkers() },
  });
  return { svg, panels, shell };
}

export function click(el: Element | null): void {
  if (el === null) {
    throw new Error("click: element not found");
  }
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

export function setValue(el: Element | null, value: string): void {
  if (el === null) {
    throw new Error("setValue: element not found");
  }
  (el as HTMLInputElement | HTMLSelectElement).value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export async function until(cond: () => boolean, ms = 8000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) {
      throw new Error("until: timed out");
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

// The strings a user reads, for ClaimLint: text of block-level elements.
// Verbatim theorem citations (the Lab's citation list and discrepancy list,
// and limitations that restate a cited row) are linted as theorem citations
// with their row id; see tests/ui/claim-copy.test.ts for the library-level
// check of the same text.
export function uiStrings(root: Element): { text: string; tier?: "theorem-cited"; ref?: string }[] {
  const out: { text: string; tier?: "theorem-cited"; ref?: string }[] = [];
  const sel = "p, li, dd, dt, td, th, summary, h3, h4, label, button, strong, .status-badge";
  for (const el of root.querySelectorAll(sel)) {
    if (el.closest(".lab-cites, .lab-disc-list, .source-ref, #kx-break-list") !== null) {
      continue;
    }
    if (el.querySelector("p, li, dd, td, summary") !== null) {
      continue; // a container: its children are scanned
    }
    const text = (el.textContent ?? "").trim();
    if (text === "") {
      continue;
    }
    const m = /^([A-Z]{2,3}-[A-Z0-9]+): /.exec(text);
    out.push(m === null ? { text } : { text, tier: "theorem-cited", ref: m[1] as string });
  }
  return out;
}

// Capture what the export buttons download (Blob text + filename).
export function captureDownloads(): { texts: Promise<string>[]; names: string[]; restore(): void } {
  const texts: Promise<string>[] = [];
  const names: string[] = [];
  const origCreate = (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
  const origRevoke = (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
  const origClick = HTMLAnchorElement.prototype.click;
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (b: Blob) => {
    texts.push(b.text());
    return "blob:test";
  };
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement): void {
    names.push(this.download);
  };
  return {
    texts,
    names,
    restore(): void {
      (URL as unknown as { createObjectURL: unknown }).createObjectURL = origCreate;
      (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = origRevoke;
      HTMLAnchorElement.prototype.click = origClick;
    },
  };
}
