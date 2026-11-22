import "./style.css";
import { createShell } from "./ui/app.ts";
import { initTheme } from "./ui/theme.ts";
import {
  classifiers,
  classifyFour,
  getClassifier,
  registerClassifier,
  registerStrategy,
  strategies,
} from "./strategy/registry.ts";
import {
  checkers,
  getChecker,
  registerChecker,
} from "./verification/invariants.ts";
import { fixtureTriangle } from "./strategy/strategies/fixtureTriangle.ts";
import { esmbK5 } from "./strategy/strategies/k5/def.ts";
import { classifyB3 } from "./strategy/strategies/k5/classifyB3.ts";
import { trapezoidChecker } from "./verification/trapezoid.ts";
import { esmbK6 } from "./strategy/strategies/k6/def.ts";
import { esmbK6Wide } from "./strategy/strategies/k6/wide.ts";
import { classifyB1 } from "./strategy/strategies/k6/classifyB1.ts";
import { twinPairChecker, twinsChecker } from "./verification/k6twins.ts";
import { esmbK7 } from "./strategy/strategies/k7/def.ts";
import { classifyB1Hex } from "./strategy/strategies/k7/classifyB1.ts";
import {
  pair5Checker,
  twinPair6Checker,
  twins6Checker,
} from "./verification/k7twins.ts";
import { esmbK8 } from "./strategy/strategies/k8/def.ts";
import {
  classifyB0Hept,
  classifyB3Obs2,
  classifyB4Sevens,
} from "./strategy/strategies/k8/classify.ts";
import { K8_CHECKERS } from "./verification/k8checks.ts";

const board = document.querySelector<SVGSVGElement>("#board");
const panels = document.querySelector<HTMLElement>("#panels");
if (board === null || panels === null) {
  throw new Error("Playing the Proof: required shell elements are missing.");
}

initTheme();

registerStrategy(fixtureTriangle, "fixture");

// Shipped core strategy + its classifiers/checker (§23). Idempotent guards
// keep dev re-runs safe; tests use the same guard pattern.
if (getClassifier(classifyFour.id) === undefined) {
  registerClassifier(classifyFour);
}
if (getClassifier(classifyB3.id) === undefined) {
  registerClassifier(classifyB3);
}
if (getClassifier(classifyB1.id) === undefined) {
  registerClassifier(classifyB1);
}
if (getChecker(trapezoidChecker.id) === undefined) {
  registerChecker(trapezoidChecker);
}
if (getChecker(twinsChecker.id) === undefined) {
  registerChecker(twinsChecker);
}
if (getChecker(twinPairChecker.id) === undefined) {
  registerChecker(twinPairChecker);
}
if (getClassifier(classifyB1Hex.id) === undefined) {
  registerClassifier(classifyB1Hex);
}
for (const checker of [pair5Checker, twins6Checker, twinPair6Checker]) {
  if (getChecker(checker.id) === undefined) {
    registerChecker(checker);
  }
}
for (const c of [classifyB0Hept, classifyB3Obs2, classifyB4Sevens]) {
  if (getClassifier(c.id) === undefined) {
    registerClassifier(c);
  }
}
for (const checker of K8_CHECKERS) {
  if (getChecker(checker.id) === undefined) {
    registerChecker(checker);
  }
}
if (!strategies().has(esmbK5.id)) {
  registerStrategy(esmbK5, "core");
}
if (!strategies().has(esmbK6.id)) {
  registerStrategy(esmbK6, "core");
}
if (!strategies().has(esmbK6Wide.id)) {
  registerStrategy(esmbK6Wide, "experimental-extension");
}
if (!strategies().has(esmbK7.id)) {
  registerStrategy(esmbK7, "core");
}
if (!strategies().has(esmbK8.id)) {
  registerStrategy(esmbK8, "core");
}

const shell = createShell(board, panels, {
  registries: {
    strategies: strategies(),
    classifiers: classifiers(),
    checkers: checkers(),
  },
});
shell.showEntry();
