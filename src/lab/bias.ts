// lab/bias.ts — exact parsing/formatting of the bias s of "1:s". Never floats.
import { Rat } from "../geometry/rat.ts";

// parseBias: integer ("12"), rational ("5/2"), or decimal ("2.5", "1.999")
// strings, or a finite JS number (read through its shortest decimal string).
// Returns null for anything invalid or negative. Pure.
export function parseBias(input: string | number | bigint): Rat | null {
  if (typeof input === "bigint") {
    return input < 0n ? null : Rat.make(input);
  }
  let text: string;
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) {
      return null;
    }
    text = String(input);
    if (/e/i.test(text)) {
      return null;
    }
  } else {
    text = input.trim();
  }
  const frac = /^(\d+)\/(\d+)$/.exec(text);
  if (frac !== null) {
    const d = BigInt(frac[2] as string);
    return d === 0n ? null : Rat.make(BigInt(frac[1] as string), d);
  }
  const dec = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (dec !== null) {
    const frac2 = dec[2] ?? "";
    return Rat.make(BigInt((dec[1] as string) + frac2), 10n ** BigInt(frac2.length));
  }
  return null;
}

// floor(s) as bigint (s >= 0).
export function floorRat(s: Rat): bigint {
  return s.n / s.d;
}

export function isIntegerRat(s: Rat): boolean {
  return s.d === 1n;
}

export function formatBias(s: Rat): string {
  return s.d === 1n ? `1:${String(s.n)}` : `1:${String(s.n)}/${String(s.d)}`;
}
