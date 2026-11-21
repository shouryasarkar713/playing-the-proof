// ui/wire.ts — structured-clone-safe encoding of exact values (Rat, bigint)
// for the explorer's Web Worker boundary. Plain data only: class instances
// other than Rat are not supported (the traced run results contain none).
import { Rat } from "../geometry/rat.ts";

export function encodeWire(v: unknown): unknown {
  if (v instanceof Rat) {
    return { $rat: v.toString() };
  }
  if (typeof v === "bigint") {
    return { $big: v.toString() };
  }
  if (Array.isArray(v)) {
    return v.map(encodeWire);
  }
  if (typeof v === "object" && v !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(v)) {
      out[key] = encodeWire((v as Record<string, unknown>)[key]);
    }
    return out;
  }
  return v;
}

export function decodeWire(v: unknown): unknown {
  if (Array.isArray(v)) {
    return v.map(decodeWire);
  }
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1 && keys[0] === "$rat" && typeof o["$rat"] === "string") {
      return Rat.fromString(o["$rat"]);
    }
    if (keys.length === 1 && keys[0] === "$big" && typeof o["$big"] === "string") {
      return BigInt(o["$big"]);
    }
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      out[key] = decodeWire(o[key]);
    }
    return out;
  }
  return v;
}
