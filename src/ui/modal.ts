// ui/modal.ts — dialog semantics for the About/Help prose cards (QA D6,
// audit): role=dialog + aria-modal + accessible name, initial focus on
// the close button, Tab focus trap, Escape closes. Effects live in ui/ only.
// After a dialog closes the entry screen is rebuilt, so the opener node is
// gone: restore focus to the entry button with the same label (About/Help).
export function focusEntryButton(label: string): void {
  queueMicrotask(() => {
    const b = Array.from(
      document.querySelectorAll<HTMLButtonElement>("#entry .entry-actions button"),
    ).find((x) => x.textContent?.trim() === label);
    b?.focus();
  });
}

export function makeModal(
  host: HTMLElement,
  card: HTMLElement,
  title: HTMLElement,
  close: HTMLButtonElement,
  onClose: () => void,
): void {
  title.id = `${host.id}-title`;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", title.id);
  const onKey = (e: KeyboardEvent): void => {
    if (!document.contains(host)) {
      document.removeEventListener("keydown", onKey);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      document.removeEventListener("keydown", onKey);
      onClose();
      return;
    }
    if (e.key !== "Tab") {
      return;
    }
    const focusables = Array.from(
      card.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [tabindex]"),
    ).filter((el) => !el.hasAttribute("disabled") && el.tabIndex >= 0);
    if (focusables.length === 0) {
      return;
    }
    const first = focusables[0] as HTMLElement;
    const last = focusables[focusables.length - 1] as HTMLElement;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !card.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !card.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener("keydown", onKey);
  // Focus after insertion (callers append `host` right after this returns).
  queueMicrotask(() => close.focus());
}
