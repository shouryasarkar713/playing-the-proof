// capture-figures.mjs - drives the production build of Playing the Proof with
// system Chrome (puppeteer-core) and writes the report figures. Every PNG is a
// plain screenshot (full viewport or a rectangular clip of it); nothing is edited.
// Usage: node capture-figures.mjs [fig01 fig02 ...]   (env: PTP_URL, PTP_OUT, CHROME)
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const URL_ = process.env.PTP_URL ?? "http://localhost:4791/";
const OUT = process.env.PTP_OUT ?? path.resolve("figures");
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const consoleLog = [];

async function open({ w = 1280, h = 800, dsf = 2, mobile = false, theme = "light" } = {}) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  page.on("console", (m) => consoleLog.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => consoleLog.push(`[pageerror] ${e.message}`));
  page.on("requestfailed", (r) => consoleLog.push(`[requestfailed] ${r.url()}`));
  await page.setViewport({ width: w, height: h, deviceScaleFactor: dsf, isMobile: mobile, hasTouch: mobile });
  await page.evaluateOnNewDocument((t) => { try { localStorage.setItem("ptp-theme", t); } catch {} }, theme);
  await page.goto(URL_, { waitUntil: "networkidle0" });
  return { browser, page };
}
async function clickText(page, text, { sel = "button", nth = 0, within = null } = {}) {
  const ok = await page.evaluate((text, sel, nth, within) => {
    const root = within ? document.querySelector(within) : document;
    const els = [...root.querySelectorAll(sel)].filter((e) => (e.textContent || "").trim().includes(text) || (e.getAttribute("aria-label") || "").startsWith(text));
    const e = els[nth]; if (!e) return false; e.click(); return true;
  }, text, sel, nth, within);
  if (!ok) throw new Error("no element " + text);
  await sleep(250);
}
async function setField(page, sel, v) {
  await page.evaluate((sel, v) => {
    const e = document.querySelector(sel); e.focus(); e.value = String(v);
    e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true }));
  }, sel, v);
  await sleep(300);
}
async function scrollTo(page, id) {
  await page.evaluate((id) => {
    const a = document.querySelector("#panels"); const e = document.getElementById(id);
    a.scrollTop = e.offsetTop - a.offsetTop - 8;
  }, id);
  await sleep(250);
}
async function clickBoard(page, cssX, cssY) {
  await page.mouse.move(cssX, cssY); await sleep(200); await page.mouse.click(cssX, cssY); await sleep(700);
}
const card = (n) => `.mode-card:nth-child(${n})`; // 1 proof, 2 break, 3 sandbox, 4 lab, 5 kstrip
async function startProof(page, row) { await clickText(page, "Start", { within: `${card(1)} .strategy-row:nth-child(${row})` }); await sleep(600); }
async function openKX(page, k, t) {
  await clickText(page, "Open", { within: card(5) }); await sleep(300);
  await setField(page, "#kx-k", k); await setField(page, "#kx-t", t);
  await clickText(page, "Run"); await sleep(2800);
}
async function nextN(page, n) { for (let i = 0; i < n; i++) { await clickText(page, "Next"); await sleep(40); } await sleep(400); }
// clip = {x, y, width, height} in CSS px of the viewport
async function shot(page, name, clip) {
  await sleep(300); await page.screenshot({ path: path.join(OUT, name), ...(clip ? { clip } : {}) }); console.log("wrote", name);
}
const PANEL_CLIP = { x: 860, y: 66, width: 412, height: 730 }; // right-hand panel column at 1280x800
const BOARD_CLIP = { x: 12, y: 66, width: 844, height: 726 };  // the board at 1280x800

const figs = {
  async fig01() {
    for (const dark of [false, true]) {
      const { browser, page } = await open();
      await startProof(page, 1);
      await clickText(page, "Next"); await sleep(500);
      await clickText(page, "Play k5:b2:one-interior"); await sleep(700); // k5:r3:classify, invariant populated
      await page.mouse.move(1100, 760);
      if (dark) { await page.click("#theme-toggle"); await sleep(400); }
      await shot(page, dark ? "fig01-proof-k5-dark.png" : "fig01-proof-k5.png");
      await browser.close();
    }
  },
  async fig02() {
    const { browser, page } = await open(); await startProof(page, 2);
    await clickText(page, "Next"); await sleep(600); await shot(page, "fig02-proof-k6-twins.png", BOARD_CLIP); await browser.close();
  },
  async fig03() {
    const { browser, page } = await open(); await startProof(page, 3);
    await sleep(500); await shot(page, "fig03-k7.png"); await browser.close();
  },
  async fig04() { // k=8 guided walkthrough: B0 and B1 are placed by clicking the board
    const { browser, page } = await open();
    const rows = await page.evaluate(() => [...document.querySelectorAll(`.mode-card:nth-child(1) .strategy-row`)].map((r) => r.innerText));
    const row = rows.findIndex((t) => t.includes("esmb-k8")) + 1;
    if (row === 0) throw new Error("esmb-k8 not offered");
    await startProof(page, row);
    const pts = () => page.evaluate(() => {
      const els = [...document.querySelectorAll("#board .pt")].map((e) => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
      const out = {};
      for (const t of document.querySelectorAll("#board text")) {
        const m = /^p([0-9]+)$/.exec(t.textContent); if (!m) continue;
        const tb = t.getBoundingClientRect(); let best = null, bd = 1e9;
        for (const p of els) { const d = Math.hypot(p[0] - tb.left, p[1] - tb.bottom); if (d < bd) { bd = d; best = p; } }
        out[+m[1]] = best;
      }
      return Object.keys(out).sort((a, b) => a - b).map((k) => out[k]);
    });
    const cen = (a) => [a.reduce((s, p) => s + p[0], 0) / a.length, a.reduce((s, p) => s + p[1], 0) / a.length];
    const P = await pts();
    const [bx, by] = cen([P[0], P[2], P[4], P[5]]); // B0 = centroid of p1, p3, p5, p6
    await clickBoard(page, bx, by); await sleep(500);
    await page.mouse.move(1100, 700);
    await shot(page, "fig04-k8.png");
    const P2 = await pts();
    const [cx, cy] = cen([P2[7], P2[8], P2[5]]); // B1 = centroid of the shared triangle (p8, p9, p6)
    await clickBoard(page, cx, cy); await page.mouse.move(1100, 700); await sleep(500);
    await shot(page, "fig04c-k8-7hole.png");
    await clickText(page, "Play k8:b2:inside-seven"); await sleep(900);
    await shot(page, "fig04b-k8-final.png");
    await browser.close();
  },
  async fig05() {
    const { browser, page } = await open(); await openKX(page, 3, 2);
    await nextN(page, 17); await scrollTo(page, "kx-recursion"); await shot(page, "fig05-kstrip-explorer.png"); await browser.close();
  },
  async fig06() {
    const { browser, page } = await open(); await openKX(page, 3, 1);
    await nextN(page, 13); // step 14: Maker places the extension point p_2; candidates R3, R4 of unit 2 exist
    await page.select("#kx-unit-sel", "2"); await sleep(300);
    await page.evaluate(() => { for (const id of ["kx-cone-plus", "kx-cone-minus"]) { const c = document.getElementById(id); if (!c.checked) c.click(); } }); await sleep(500);
    await scrollTo(page, "kx-inspect"); await shot(page, "fig06-kstrip-pairing.png"); await browser.close();
  },
  async fig07() {
    const { browser, page } = await open(); await openKX(page, 3, 2);
    await page.evaluate(() => document.getElementById("kx-break-start").click()); await sleep(800);
    for (const [x, y] of [["6", "-5"], ["10", "-5"], ["16", "3"], ["14", "-9"]]) {
      await page.evaluate(() => { for (const id of ["kx-break-x", "kx-break-y"]) document.getElementById(id).value = ""; });
      await page.type("#kx-break-x", x); await page.type("#kx-break-y", y); await sleep(300);
      await page.click("#kx-break-place"); await sleep(600);
    }
    await sleep(6000); // let the toasts expire
    await scrollTo(page, "kx-break"); await shot(page, "fig07-break-ledger.png", PANEL_CLIP); await browser.close();
  },
  async fig08() {
    const cfgs = [
      ["fig08-lab.png", "online", "monochromatic", 5, "1"],
      ["fig08b-lab-experimental.png", "online", "bichromatic", 7, "2"],
      ["fig08c-lab-notcovered.png", "one-round", "monochromatic", 10, "1"],
    ];
    for (const [file, m, r, k, b] of cfgs) {
      const { browser, page } = await open();
      await clickText(page, "Open", { within: card(4) }); await sleep(600);
      await setField(page, "#lab-model", m); await setField(page, "#lab-rule", r);
      await setField(page, "#lab-k", k); await setField(page, "#lab-bias", b); await sleep(600);
      await scrollTo(page, "lab-result"); await shot(page, file, PANEL_CLIP); await browser.close();
    }
  },
  async fig09() {
    const { browser, page } = await open();
    await clickText(page, "Start", { within: card(3) }); await sleep(600);
    await clickText(page, "Bichromatic", { within: "#sandbox-rule" }); await sleep(600);
    await setField(page, "#gen-seed", "7"); await setField(page, "#gen-size", "10");
    await clickText(page, "Generate"); await sleep(2000);
    await clickText(page, "Breaker", { within: "#sandbox-controls" }); await sleep(300);
    for (const [x, y] of [[600, 600], [820, 590], [640, 780], [820, 760]]) await clickBoard(page, x * 0.64, y * 0.64);
    await page.mouse.move(1000, 700); await clickText(page, "hole ▶"); await sleep(800);
    await shot(page, "fig09-bichromatic.png", BOARD_CLIP); await browser.close();
  },
  async fig10() {
    const { browser, page } = await open();
    await clickText(page, "Start", { within: card(3) }); await sleep(600);
    await setField(page, "#gen-seed", "7"); await setField(page, "#gen-size", "10");
    await clickText(page, "Generate"); await sleep(2000);
    await clickText(page, "hole ▶"); await sleep(800);
    await shot(page, "fig10-sandbox.png"); await browser.close();
  },
  async fig11() {
    const { browser, page } = await open();
    await clickText(page, "Start", { within: `${card(2)} .strategy-row:nth-child(1)` }); await sleep(800);
    await clickBoard(page, 500 * 0.64, 600 * 0.64); await page.mouse.move(1100, 700);
    await sleep(5000); await scrollTo(page, "break-place"); await shot(page, "fig11-break-k5.png"); await browser.close();
  },
  async fig12() {
    const { browser, page } = await open({ w: 375, h: 812, mobile: true });
    await shot(page, "fig12-mobile-375-entry.png");
    await clickText(page, "Open", { within: card(5) }); await sleep(400);
    await setField(page, "#kx-k", 3); await setField(page, "#kx-t", 1);
    await clickText(page, "Run"); await sleep(2800); await nextN(page, 13);
    await page.select("#kx-unit-sel", "2"); await sleep(400);
    await shot(page, "fig12-mobile-375.png"); await browser.close();
  },
  async fig13() { // k=8 Proof mode: the "Reply classes" panel with Interactive / Guided / Not encoded labels
    const { browser, page } = await open();
    const rows = await page.evaluate(() => [...document.querySelectorAll(`.mode-card:nth-child(1) .strategy-row`)].map((r) => r.innerText));
    await startProof(page, rows.findIndex((t) => t.includes("esmb-k8")) + 1);
    await scrollTo(page, "panel-branches"); await shot(page, "fig13-branch-labels.png"); await browser.close();
  },
  async fig14() { // Sandbox with bias 1:2 applied, one Maker point placed by clicking the board
    const { browser, page } = await open();
    await clickText(page, "Start", { within: card(3) }); await sleep(600);
    await setField(page, "#sandbox-bias-input", "2"); await clickText(page, "Set bias"); await sleep(800);
    await clickBoard(page, 400, 400);
    await clickBoard(page, 520, 300);
    await page.mouse.move(1100, 760);
    await scrollTo(page, "sandbox-bias");
    await shot(page, "fig14-sandbox-bias.png"); await browser.close();
  },
};

const want = process.argv.slice(2);
for (const [id, fn] of Object.entries(figs)) {
  if (want.length && !want.includes(id)) continue;
  try { await fn(); } catch (e) { console.log("FAILED", id, e.message); }
}
fs.writeFileSync(path.join(OUT, "console-log.txt"), consoleLog.length ? consoleLog.join("\n") + "\n" : "(no console messages, page errors or failed requests recorded)\n");
console.log("console messages:", consoleLog.length);
