import type { Box, LogoResult, TextBlock } from "./vision";
export type Severity = "high" | "medium" | "low";
export type Category =
  | "tone"
  | "terminology"
  | "claims"
  | "facts"
  | "messaging"
  | "visual"
  | "accessibility";

export type RoleKey = "creator" | "brand" | "legal" | "admin";

export interface Rule {
  id: string;
  category: Category;
  title: string;
  description: string;
  severity: Severity;
  /** Optional regex patterns (case-insensitive) checked deterministically. */
  patterns?: string[];
  /** Optional deterministic replacement hint used when a pattern matches. */
  fix?: string;
  doExample?: string;
  dontExample?: string;
  /** Rules created by AI extraction stay "draft" until an admin approves them. */
  status?: "approved" | "draft";
  /**
   * Approved exceptions (Round 3, self-improving Brand Kit): when any pattern matches the sentence
   * that contains a finding, the finding is not raised. Written by an admin, optionally drafted by AI
   * from reviewers' override reasons and checked with an impact preview before approval.
   */
  exceptions?: { note: string; patterns: string[]; scope?: "sentence" | "content"; addedInVersion?: number }[];
}

/** A rule change made through the Guideline Gap Detector, kept for before/after tracking. */
export interface RuleChange {
  ruleId: string;
  version: number;
  at: string;
  by: string;
  summary: string;
  before: { description: string; overrideRate: number; decisions: number };
  projected: { overrideRate: number; removedOverrides: number; missedAccepted: number };
}

export interface GlossaryTerm {
  id: string;
  preferred: string;
  /** Wrong spellings / forbidden variants that should become `preferred`. */
  variants: string[];
  note?: string;
}

export interface Fact {
  id: string;
  label: string;
  statement: string;
  /** Canonical value, e.g. "2.4 million" */
  value: string;
  /** Words that indicate the fact is being referred to, e.g. ["users","customers"] */
  keywords: string[];
  /** Old values that are now outdated. */
  previousValues?: string[];
  source: string;
  owner: string;
  verifiedOn: string; // ISO date
  expiresOn: string; // ISO date
}

export interface PaletteColor {
  name: string;
  hex: string;
}

export interface BrandKit {
  version: number;
  brandName: string;
  voice: string;
  rules: Rule[];
  glossary: GlossaryTerm[];
  facts: Fact[];
  palette: PaletteColor[];
  confidentialTerms: string[];
  competitorNames: string[];
  logos?: BrandLogo[];
  ruleChanges?: RuleChange[];
  updatedAt: string;
}

export type FindingStatus = "open" | "accepted" | "edited" | "rejected";
export type ClaimStatus = "supported" | "contradicted" | "outdated" | "unsupported";

export interface Finding {
  id: string;
  ruleId?: string;
  factId?: string;
  category: Category;
  severity: Severity;
  origin: "rule" | "ai";
  /** Verbatim text from the content. Empty for whole-creative findings. */
  quote: string;
  message: string;
  explanation: string;
  suggestion?: string;
  suggestionBy?: "rule" | "ai";
  confidence: number;
  routeTo: "brand" | "legal";
  claimStatus?: ClaimStatus;
  status: FindingStatus;
  reason?: string;
  decidedBy?: string;
  /** The exact text inserted when the fix was applied (used for undo). */
  applied?: string;
  /** Colour info for visual findings */
  swatches?: string[];
  /** Where the issue is on the creative (normalised 0..1, page for PDFs). */
  box?: Box;
}

export interface ImageAnalysis {
  dominant: { hex: string; share: number; nearest: string; deltaE: number }[];
  contrastEstimate: number;
  width: number;
  height: number;
  /** Visual Compliance Engine results (Round 3). */
  logo?: LogoResult;
  blocks?: TextBlock[];
  ocrText?: string;
  ocrMs?: number;
  logoMs?: number;
}

/** One rendered page of a multi-page PDF creative. */
export interface CreativePage {
  page: number;
  dataUrl: string;
  analysis: ImageAnalysis;
}

export interface BrandLogo {
  id: string;
  name: string;
  kind: "approved" | "outdated";
  /** URL or data URL of a PNG/JPG (transparent background recommended). */
  src: string;
}

export interface ReviewMeta {
  mode: "hybrid" | "rules-only";
  model?: string;
  aiProposed: number;
  aiKept: number;
  aiDropped: { reason: string; quote: string }[];
  redactions: number;
  ms: number;
  note?: string;
  extractedText?: string;
  altTextSuggestion?: string;
  /** True while the AI layer is still running in the background for this version. */
  aiPending?: boolean;
  startedAt?: string;
}

export interface Version {
  n: number;
  text: string;
  createdAt: string;
  by: string;
  note: string;
  findings: Finding[];
  score: ScoreBreakdown;
  meta?: ReviewMeta;
}

export interface ScoreBreakdown {
  total: number;
  byCategory: Record<string, number>;
}

export type ItemStatus =
  | "draft"
  | "checked"
  | "in_review"
  | "changes_requested"
  | "approved";

export interface Comment {
  id: string;
  by: string;
  role: RoleKey;
  at: string;
  text: string;
}

export interface AuditEntry {
  at: string;
  by: string;
  action: string;
}

export interface Decision {
  ruleId?: string;
  /** Brand Kit version the finding was produced under (for before/after tracking). */
  kitVersion?: number;
  category: Category;
  action: FindingStatus;
  reason?: string;
  by: string;
  at: string;
  origin: "rule" | "ai";
}

export interface Approval {
  by: string;
  at: string;
  note?: string;
}

export interface ContentItem {
  id: string;
  title: string;
  channel: string;
  audience: string;
  goal: string;
  format: "text" | "docx" | "pdf" | "image";
  fileName?: string;
  imageDataUrl?: string;
  imageAnalysis?: ImageAnalysis;
  pages?: CreativePage[];
  altText?: string;
  draftText: string;
  versions: Version[];
  status: ItemStatus;
  needsLegal: boolean;
  approvals: { brand?: Approval; legal?: Approval };
  comments: Comment[];
  audit: AuditEntry[];
  decisions: Decision[];
  createdBy: string;
  /** Supabase user id of the creator (team workspaces). */
  createdById?: string;
  createdAt: string;
  updatedAt: string;
  kitVersion: number;
  sample?: boolean;
}

export interface Person {
  key: RoleKey;
  name: string;
  title: string;
}
