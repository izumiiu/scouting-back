/** Compact English translation of the complete Thai reference, not a new rubric.
 * Stored inside each criteria snapshot so the exact provider reference is auditable.
 * Keep all 13 IDEA and 14 POC considerations aligned with ted-criteria.ts.
 */
export interface TedAiReference {
  sourceVersion: string;
  stageGuidance: string[];
  fundingGuidance: string;
  programs: {
    program: string;
    focus: string;
    domains: { label: string; considerations: string[] }[];
  }[];
}
export const tedAiReference: TedAiReference = {
  sourceVersion: 'ted-youth-startup-2026-11-06-qualitative-3',
  stageGuidance: [
    'Start with present evidence: CONCEPT, nonfunctional MOCKUP, research/proof-of-principle EARLY_EVIDENCE, evidenced WORKING_PROTOTYPE, or commercially sold/delivered MARKET_PRODUCT.',
    'IDEA describes an early project without a real product or revenue: problem/user/market understanding, innovation, technology foundation and preliminary commercial logic.',
    'POC has a prototype or initial development evidence; consider technical readiness, project management, validation/traction, path to first dollar and evidenced commercial impact.',
    'Stage alone never decides the route. No current revenue does not exclude POC with a credible first-dollar plan. Missing market evidence does not automatically demote a prototype to IDEA.',
    'Separate completed work from future plans. A mockup is not a functioning prototype; an unsupported prototype claim needs verification, not invented confirmation.',
    'Use UNCLEAR for unresolved stage contradictions and ask targeted questions. Classification remains qualitative, unscored and subject to officer review, not grant approval.',
  ],
  fundingGuidance:
    'POC requires own contribution >=10%, checked separately from project type. Missing/insufficient contribution never changes POC to IDEA. The existing budget choice cannot verify a percentage or calculation basis, even when own funds/partial co-investment are reported. The server adds a pending-verification notice; AI must not certify funding.',
  programs: [
    {
      program: 'TED_IDEA',
      focus:
        'Understand a problem, develop a technology-based idea, and plan initial concept/market validation.',
      domains: [
        {
          label: 'Problem–opportunity quality',
          considerations: [
            'Problem clarity and significance',
            'Understanding users and problem context',
            'Opportunity size and trends',
          ],
        },
        {
          label: 'Innovation and technology foundation',
          considerations: [
            'Novelty/creativity meaningfully different from existing alternatives',
            'Technology/knowledge central to value and technically feasible',
            'Potential IP or difficult-to-copy advantage',
          ],
        },
        {
          label: 'Commercial logic',
          considerations: [
            'Credible value proposition solving the customer problem',
            'Plausible revenue hypotheses and route to first customers',
            'Competitor/substitute understanding and differentiation',
          ],
        },
        {
          label: 'Team potential and commitment',
          considerations: [
            'Skills/knowledge/experience fit the problem',
            'Evidence of ownership, learning, listening and adaptation',
            'Leadership, roles and division of work supporting delivery',
          ],
        },
        {
          label: 'Execution plan and outcomes',
          considerations: [
            'Feasible 6-month plan with tangible outputs: mockup, initial market test or business plan',
          ],
        },
      ],
    },
    {
      program: 'TED_POC',
      focus:
        'Prototype or initial development evidence, assessed with market validation and a route to commercial utilization/revenue.',
      domains: [
        {
          label: 'Innovation and technology readiness',
          considerations: [
            'Novelty and defensibility through technology/IP/trade secrets/know-how',
            'Prototype or development evidence showing technology works at a POC-appropriate stage',
            'Feasible plan to complete a prototype within requested time/resources',
          ],
        },
        {
          label: 'Market validation and traction',
          considerations: [
            'Real user/customer evidence: market tests, LOIs, preorders, pilots or early sales',
            'Evidence for target market, size and growth',
            'Competitor/substitute understanding and tested/evidenced differentiation',
          ],
        },
        {
          label: 'Business model and path to revenue',
          considerations: [
            'Clear revenue model and market channels matching target customers',
            'Credible evidence OR a clear plan for first dollar during the project; existing revenue is not required',
            'Real commercial utilization, economic/social value, and transfer to users/customers',
            'Revenue scalability without proportional per-unit cost growth',
          ],
        },
        {
          label: 'Financial feasibility and project management',
          considerations: [
            'Credible own contribution >=10% and project cash-flow understanding; officer verification, not an automatic classification gate',
            'Measurable realistic 2-year milestones and risk management',
          ],
        },
        {
          label: 'Team and venture readiness',
          considerations: [
            'Relevant skills/experience, leadership and evidenced commitment',
            'Team/entity organization and people management sufficient to deliver; no mandatory-incorporation classification gate',
          ],
        },
      ],
    },
  ],
};
