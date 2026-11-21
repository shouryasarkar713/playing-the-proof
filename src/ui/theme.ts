// ui/theme.ts — presentation-only dual theme (paper/light + lab/dark).
// Owns the #theme-toggle button: applies data-theme + color-scheme to the
// document element, persists the choice, and defers to the system
// preference when nothing is stored. Never touches session/engine state;
// the §17.1 semantic meanings are identical in both themes.
const KEY = "ptp-theme";

export type ThemeName = "light" | "dark";

function isThemeName(v: string | null | undefined): v is ThemeName {
  return v === "light" || v === "dark";
}

function systemTheme(): ThemeName {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function currentTheme(): ThemeName {
  return isThemeName(document.documentElement.dataset.theme)
    ? document.documentElement.dataset.theme
    : "light";
}

function persist(theme: ThemeName): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Storage unavailable (private mode etc.) — the toggle still works
    // for this session; persistence is a convenience, not a requirement.
  }
}

function syncButton(btn: HTMLElement, theme: ThemeName): void {
  btn.setAttribute("aria-pressed", String(theme === "dark"));
  btn.title = theme === "dark" ? "Switch to light theme" : "Toggle dark theme";
}

// initTheme: wire the toggle (no-op when the button is absent, e.g. in
// tests that mount the shell into a bare document).
export function initTheme(): void {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(KEY);
  } catch {
    stored = null;
  }
  // The inline pre-paint script in index.html already resolved the theme;
  // re-assert from the stored value only when the DOM disagrees (direct
  // navigation into a jsdom-less harness keeps the light default).
  if (isThemeName(stored) && currentTheme() !== stored) {
    applyTheme(stored);
  } else if (!isThemeName(stored) && currentTheme() !== systemTheme()) {
    applyTheme(systemTheme());
  }
  const btn = document.querySelector<HTMLElement>("#theme-toggle");
  if (btn === null) {
    return;
  }
  syncButton(btn, currentTheme());
  btn.addEventListener("click", () => {
    const next: ThemeName = currentTheme() === "dark" ? "light" : "dark";
    applyTheme(next);
    persist(next);
    syncButton(btn, next);
  });
}
