export interface SpecificityJudgment { score: number; rationale: string }

export function readSpecificityJudgment(body: string): SpecificityJudgment {
  const value: unknown = JSON.parse(body);
  if (!value || typeof value !== 'object' || !('score' in value) || !('rationale' in value) ||
    typeof value.score !== 'number' || !Number.isFinite(value.score) || value.score < 0 || value.score > 1 ||
    typeof value.rationale !== 'string' || !value.rationale.trim() || value.rationale.length > 2000) {
    throw new Error('The specificity judge returned an invalid score or rationale.');
  }
  return { score: value.score, rationale: value.rationale };
}
