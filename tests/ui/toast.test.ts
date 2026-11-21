// @vitest-environment jsdom
// tests/ui/toast.test.ts — toast hygiene (§4.4 non-blocking notices):
// self-dismissal after the lifetime and a hard stack cap, so a long session
// can never grow #toasts unboundedly (audit-C defect fix).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeToast } from "../../src/ui/app.ts";

describe("makeToast hygiene", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders into a #toasts host with textContent only", () => {
    const toast = makeToast(document.body);
    toast("point blocked");
    const box = document.body.querySelector("#toasts");
    expect(box).not.toBeNull();
    expect(box?.children.length).toBe(1);
    expect(box?.firstElementChild?.className).toBe("toast");
    expect(box?.firstElementChild?.textContent).toBe("point blocked");
  });

  it("self-dismisses after the lifetime", () => {
    const toast = makeToast(document.body);
    toast("gone soon");
    const box = document.body.querySelector("#toasts");
    expect(box?.children.length).toBe(1);
    vi.advanceTimersByTime(6000);
    expect(box?.children.length).toBe(0);
  });

  it("caps the stack: oldest toasts are dropped beyond four", () => {
    const toast = makeToast(document.body);
    for (let i = 1; i <= 6; i += 1) {
      toast(`t${i}`);
      vi.advanceTimersByTime(100); // well under the lifetime
    }
    const box = document.body.querySelector("#toasts");
    expect(box?.children.length).toBe(4);
    const texts = [...(box?.children ?? [])].map((c) => c.textContent);
    // The six oldest (t1, t2) were dropped; the newest four remain in order.
    expect(texts).toEqual(["t3", "t4", "t5", "t6"]);
  });

  it("a capped toast's pending timer is harmless after removal", () => {
    const toast = makeToast(document.body);
    for (let i = 1; i <= 6; i += 1) {
      toast(`t${i}`);
      vi.advanceTimersByTime(100);
    }
    // All pending self-dismiss timers fire — no crash, box simply empties.
    vi.advanceTimersByTime(6000);
    const box = document.body.querySelector("#toasts");
    expect(box?.children.length).toBe(0);
  });
});
