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
}
export interface GroupContext {
  group: string | null;
  status: 'confirmed-inputs' | 'unknown';
  warnings: string[];
}
export interface AiSuggestion {
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
