// geometry/rat.ts — exact rational arithmetic over bigint (§7.2).
//
// [DES] Custom Rat is the ONLY numeric type on correctness paths (§7.1).
// This file contains zero `number` arithmetic: every computation is on
// bigint. (Review grep: `number` must not appear here outside comments.)

const DEV: boolean =
  (import.meta as unknown as { env?: { DEV?: unknown } }).env?.DEV !==
  false;

function absBig(n: bigint): bigint {
  return n < 0n ? -n : n;
}

// Iterative Euclid on absolute values (§22.1a). Always returns >= 0.
function gcd(a: bigint, b: bigint): bigint {
  let x = absBig(a);
  let y = absBig(b);
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

// Normalization invariant (§7.2): d > 0, gcd(|n|, d) = 1, 0 ↦ 0/1.
// Cheap part (d > 0) is always asserted; the gcd part runs in dev only.
function assertNormalized(n: bigint, d: bigint): void {
  if (d <= 0n) {
    throw new Error(`Rat invariant violated: denominator ${d} is not > 0`);
  }
  if (DEV) {
    if (n === 0n) {
      if (d !== 1n) {
        throw new Error(`Rat invariant violated: zero is not 0/1 (got 0/${d})`);
      }
    } else if (gcd(n, d) !== 1n) {
      throw new Error(`Rat invariant violated: ${n}/${d} is not reduced`);
    }
  }
}

export class Rat {
  readonly n: bigint;
  readonly d: bigint;

  private constructor(n: bigint, d: bigint) {
    this.n = n;
    this.d = d;
    assertNormalized(n, d);
  }

  static readonly ZERO: Rat = new Rat(0n, 1n);
  static readonly ONE: Rat = new Rat(1n, 1n);

  // Normalizes sign + gcd; zero canonicalizes to 0/1; throws on d = 0 (§22.1b).
  static make(n: bigint, d: bigint = 1n): Rat {
    if (d === 0n) {
      throw new Error("Rat.make: denominator is zero");
    }
    if (n === 0n) {
      return new Rat(0n, 1n);
    }
    const g = gcd(n, d);
    let nn = n / g;
    let dd = d / g;
    if (dd < 0n) {
      nn = -nn;
      dd = -dd;
    }
    return new Rat(nn, dd);
  }

  // add/sub via (n1·d2 ± n2·d1, d1·d2), then normalize (§22.1c).
  add(b: Rat): Rat {
    return Rat.make(this.n * b.d + b.n * this.d, this.d * b.d);
  }

  sub(b: Rat): Rat {
    return Rat.make(this.n * b.d - b.n * this.d, this.d * b.d);
  }

  mul(b: Rat): Rat {
    return Rat.make(this.n * b.n, this.d * b.d);
  }

  div(b: Rat): Rat {
    // b = 0 ⇒ denominator d1·0 = 0 ⇒ make throws (§22.1d, §3.1 edge case).
    return Rat.make(this.n * b.d, this.d * b.n);
  }

  neg(): Rat {
    return new Rat(-this.n, this.d);
  }

  abs(): Rat {
    return this.n < 0n ? new Rat(-this.n, this.d) : this;
  }

  // Cross-multiplication sign — never floats (§22.1e).
  cmp(b: Rat): -1 | 0 | 1 {
    const v = this.n * b.d - b.n * this.d;
    if (v < 0n) {
      return -1;
    }
    if (v > 0n) {
      return 1;
    }
    return 0;
  }

  equals(b: Rat): boolean {
    return this.cmp(b) === 0;
  }

  isZero(): boolean {
    return this.n === 0n;
  }

  isNeg(): boolean {
    return this.n < 0n;
  }

  sign(): -1 | 0 | 1 {
    if (this.n < 0n) {
      return -1;
    }
    if (this.n > 0n) {
      return 1;
    }
    return 0;
  }

  // Accepts ASCII "-" and U+2212 "−"; forms "n" and "n/d" (§22.1f, §3.1).
  static fromString(s: string): Rat {
    const t = s.trim().replaceAll("−", "-");
    const m = /^(-?\d+)(?:\/(-?\d+))?$/.exec(t);
    if (m === null || m[1] === undefined) {
      throw new Error(`Rat.fromString: cannot parse ${JSON.stringify(s)}`);
    }
    const n = BigInt(m[1]);
    const d = m[2] === undefined ? 1n : BigInt(m[2]);
    return Rat.make(n, d);
  }

  // Canonical "n/d" — always with denominator, e.g. "5/1" (§7.2).
  toString(): string {
    return `${String(this.n)}/${String(this.d)}`;
  }

  // The ONE wire form (§3.1, §7.2): BigInt is never handed to JSON.stringify.
  toJSON(): string {
    return this.toString();
  }

  static fromJSON(s: string): Rat {
    if (typeof s !== "string") {
      throw new Error("Rat.fromJSON: wire value is not a string");
    }
    return Rat.fromString(s);
  }
}
