// viz/palette.ts — semantic color tokens (§17.1). Colors are fixed meanings,
// not decoration: green is exclusively "verified"; shapes double-encode
// ownership (Maker disc / Breaker diamond) for color-blind users.
export const PALETTE = {
  paper: "#FAFAF8",
  maker: "#C05621",
  breaker: "#2B5F8A",
  verify: "#2E7D4F",
  illegal: "#B3261E",
  structure: "#546E7A",
  protected: "#7A5195",
} as const;

export type RegionToken =
  | "neutral"
  | "candidate"
  | "forced"
  | "protected"
  | "verify"
  | "structure"
  | "illegal";

export const REGION_STYLE: Record<
  RegionToken,
  { fill: string; stroke: string; dash: string }
> = {
  neutral: { fill: "none", stroke: PALETTE.structure, dash: "" },
  candidate: { fill: PALETTE.maker, stroke: PALETTE.maker, dash: "6 3" },
  forced: { fill: PALETTE.breaker, stroke: PALETTE.breaker, dash: "" },
  protected: { fill: PALETTE.protected, stroke: PALETTE.protected, dash: "" },
  verify: { fill: "none", stroke: PALETTE.verify, dash: "" },
  structure: { fill: "none", stroke: PALETTE.structure, dash: "" },
  illegal: { fill: "none", stroke: PALETTE.illegal, dash: "2 2" },
};
