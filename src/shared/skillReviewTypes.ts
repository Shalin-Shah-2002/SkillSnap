export type SkillReviewKind = "codex" | "claude";

export type SkillReviewStatus =
  | "draft"
  | "running"
  | "ready"
  | "improving"
  | "improved"
  | "applied"
  | "failed";

export interface SkillEvalAssertion {
  id: string;
  text: string;
}

export interface SkillEvalCase {
  id: string;
  name: string;
  prompt: string;
  expectedOutput: string;
  assertions: SkillEvalAssertion[];
}

export interface SkillEvalRun {
  id: string;
  evalCaseId: string;
  kind: "baseline" | "with_skill";
  status: "completed" | "failed";
  output: string;
  startedAt: string;
  completedAt: string;
  durationMs?: number;
  totalTokens?: number;
  error?: string;
}

export interface SkillEvalExpectationResult {
  text: string;
  passed: boolean;
  evidence: string;
}

export interface SkillEvalGrade {
  runId: string;
  evalCaseId: string;
  kind: "baseline" | "with_skill";
  expectations: SkillEvalExpectationResult[];
  passRate: number;
  summary: string;
}

export interface SkillReviewSummary {
  evalCount: number;
  baselinePassRate: number;
  withSkillPassRate: number;
  passRateDelta: number;
  baselineMeanDurationMs?: number;
  withSkillMeanDurationMs?: number;
  baselineMeanTokens?: number;
  withSkillMeanTokens?: number;
}

export interface SkillReviewImprovement {
  proposedSkillMd: string;
  rationale: string;
  createdAt: string;
}

export interface SkillReviewSession {
  id: string;
  entryId: string;
  skillName: string;
  kind: SkillReviewKind;
  createdAt: string;
  updatedAt: string;
  status: SkillReviewStatus;
  cases: SkillEvalCase[];
  runs: SkillEvalRun[];
  grades: SkillEvalGrade[];
  feedback: Record<string, string>;
  summary?: SkillReviewSummary;
  improvement?: SkillReviewImprovement;
  error?: string;
}

export interface SkillReviewData {
  sessions: SkillReviewSession[];
}

export const SKILL_REVIEW_STORAGE_KEY = "skillReviews.v1";
export const SKILL_REVIEW_LAUNCH_KEY = "skillReviewLaunch.v1";
export const MAX_SKILL_REVIEW_SESSIONS_PER_ENTRY = 5;
export const MAX_SKILL_REVIEW_SESSIONS_TOTAL = 80;
