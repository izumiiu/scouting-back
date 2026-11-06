import type { AiFollowUp } from './follow-ups.js';

export type FieldValue = string | number | boolean | string[] | null;
export type Answers = Record<string, FieldValue>;
export type Outcome = 'pass' | 'fail' | 'unknown';
export interface Condition {
  id: string;
  label: string;
  outcome: Outcome;
  evidenceRefs: string[];
  note?: string;
}
export interface Eligibility {
  program: string;
  label: string;
  outcome: Outcome;
  conditions: Condition[];
  assessmentMode?: 'qualitative';
}
export interface GroupContext {
  group: string | null;
  status: 'confirmed-inputs' | 'unknown';
  warnings: string[];
}
export type DevelopmentStageCode =
  | 'CONCEPT'
  | 'MOCKUP'
  | 'EARLY_EVIDENCE'
  | 'WORKING_PROTOTYPE'
  | 'MARKET_PRODUCT'
  | 'UNCLEAR';
export interface TedDevelopmentStage {
  stage: DevelopmentStageCode;
  reason: string;
  evidenceRefs: string[];
}
export interface TedFundingReadiness {
  status: 'NEEDS_VERIFICATION' | 'NOT_ASSESSED';
  reason: string;
  evidenceRefs: string[];
}
export interface TedAssessment {
  // Optional for historical analyses; current provider output requires developmentStage.
  developmentStage?: TedDevelopmentStage;
  // Added by the server, never accepted as an AI certification of funding.
  fundingReadiness?: TedFundingReadiness;
  classification: 'TED_IDEA' | 'TED_POC' | 'INSUFFICIENT_DATA';
  reason: string;
  alternativeReason: string;
  evidenceRefs: string[];
  uncertainties: string[];
}
export interface AiSuggestion {
  // Optional only for historical results generated before qualitative TED.
  tedAssessment?: TedAssessment;
  summary: string;
  programRecommendations: {
    program: string;
    reason: string;
    evidenceRefs: string[];
  }[];
  expertRecommendations: {
    area: string;
    need: string;
    reason: string;
    evidenceRefs: string[];
  }[];
  missingInformation: string[];
  // Optional on historical results. Never infer scopes for old untagged prose.
  followUps?: AiFollowUp[];
}
export interface CaseInput {
  title: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  sourceChannel: string;
  sourceReference: string;
  referenceDate: string;
  permissionStatus: 'unknown' | 'granted' | 'denied';
  permissionReference: string;
  allowAiProcessing: boolean;
  answers: Answers;
}
