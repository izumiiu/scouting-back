export const followUpScopes = [
  'TED', 'TED_IDEA', 'TED_POC', 'TED_POC_FUNDING',
  'UBI_PRE', 'UBI_STARTUP', 'TBI', 'DEVELOPMENT',
] as const;
export type FollowUpScope = (typeof followUpScopes)[number];
export interface AiFollowUp {
  scope: FollowUpScope;
  question: string;
}
