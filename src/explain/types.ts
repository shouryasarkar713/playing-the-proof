// explain/types.ts — explanation value types (§13.2). Renderers consume
// verified results; the tiers are the anti-overclaiming mechanism (§13.1).
import type {
  Claim,
  ClaimTier,
  EvidenceItem,
  ExplanationSpec,
} from "../strategy/types.ts";

export type { Claim, ClaimTier, EvidenceItem, ExplanationSpec };

export interface Explanation {
  headline: string;
  claims: readonly Claim[];
  evidence: readonly EvidenceItem[];
  threats: readonly Claim[];
  invariantNotes: readonly Claim[];
  sourceRef: string;
}
