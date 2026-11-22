// kstrip/spec/expr.ts — the tiny exact formula language of KStripSpec.
//
// Round / unit / budget formulas are DATA (a closed expression tree over exact
// rationals), not code: they can be printed, validated against the paper's
// recurrences and evaluated without touching any geometry.
import { Rat } from "../../geometry/rat.ts";
import { ceilRat, floorRat } from "../recursion.ts";

export type ExprVar = "k" | "level" | "need" | "s" | "m" | "units";

export type Expr =
  | { readonly op: "const"; readonly v: string } // Rat wire string "n" or "n/d"
  | { readonly op: "var"; readonly name: ExprVar }
  | { readonly op: "add" | "sub" | "mul" | "div"; readonly a: Expr; readonly b: Expr }
  | { readonly op: "ceil" | "floor"; readonly a: Expr };

export type ExprEnv = Partial<Record<ExprVar, Rat>>;

export class ExprError extends Error {}

// builders (keep spec tables readable)
export const num = (n: number | bigint): Expr => ({ op: "const", v: String(n) });
export const vr = (name: ExprVar): Expr => ({ op: "var", name });
export const add = (a: Expr, b: Expr): Expr => ({ op: "add", a, b });
export const sub = (a: Expr, b: Expr): Expr => ({ op: "sub", a, b });
export const mul = (a: Expr, b: Expr): Expr => ({ op: "mul", a, b });
export const div = (a: Expr, b: Expr): Expr => ({ op: "div", a, b });
export const ceil = (a: Expr): Expr => ({ op: "ceil", a });
export const floor = (a: Expr): Expr => ({ op: "floor", a });

export function evalExpr(e: Expr, env: ExprEnv): Rat {
  switch (e.op) {
    case "const":
      return Rat.fromString(e.v);
    case "var": {
      const v = env[e.name];
      if (v === undefined) {
        throw new ExprError(`unbound variable '${e.name}'`);
      }
      return v;
    }
    case "add":
      return evalExpr(e.a, env).add(evalExpr(e.b, env));
    case "sub":
      return evalExpr(e.a, env).sub(evalExpr(e.b, env));
    case "mul":
      return evalExpr(e.a, env).mul(evalExpr(e.b, env));
    case "div": {
      const d = evalExpr(e.b, env);
      if (d.isZero()) {
        throw new ExprError("division by zero");
      }
      return evalExpr(e.a, env).div(d);
    }
    case "ceil":
      return Rat.make(ceilRat(evalExpr(e.a, env)));
    case "floor":
      return Rat.make(floorRat(evalExpr(e.a, env)));
  }
}

// Non-negative integer value (counts); throws ExprError otherwise.
export function evalCount(e: Expr, env: ExprEnv): bigint {
  const r = evalExpr(e, env);
  if (r.d !== 1n || r.n < 0n) {
    throw new ExprError(`${showExpr(e)} = ${r.toString()} is not a non-negative integer`);
  }
  return r.n;
}

export function showExpr(e: Expr): string {
  switch (e.op) {
    case "const":
      return e.v;
    case "var":
      return e.name;
    case "add":
      return `(${showExpr(e.a)} + ${showExpr(e.b)})`;
    case "sub":
      return `(${showExpr(e.a)} - ${showExpr(e.b)})`;
    case "mul":
      return `${showExpr(e.a)}*${showExpr(e.b)}`;
    case "div":
      return `${showExpr(e.a)}/${showExpr(e.b)}`;
    case "ceil":
      return `ceil(${showExpr(e.a)})`;
    case "floor":
      return `floor(${showExpr(e.a)})`;
  }
}

export function exprVars(e: Expr): Set<ExprVar> {
  switch (e.op) {
    case "const":
      return new Set();
    case "var":
      return new Set([e.name]);
    case "ceil":
    case "floor":
      return exprVars(e.a);
    default:
      return new Set([...exprVars(e.a), ...exprVars(e.b)]);
  }
}
