import { stripJsonFence } from "../shared/parseSkillJson";
import type { SkillLibraryEntry } from "../shared/skillLibrary";
import type {
  SkillEvalAssertion,
  SkillEvalCase,
  SkillEvalExpectationResult,
  SkillEvalGrade,
  SkillEvalRun,
  SkillReviewKind,
  SkillReviewSession,
  SkillReviewSummary
} from "../shared/skillReviewTypes";

export interface ReviewTextResult {
  text: string;
  durationMs?: number;
  totalTokens?: number;
  model?: string;
}

export type ReviewTextGenerator = (
  prompt: string,
  options?: { json?: boolean; temperature?: number }
) => Promise<ReviewTextResult>;

export interface ReviewEngineDeps {
  generateText: ReviewTextGenerator;
  now?: () => Date;
  idFactory?: () => string;
}

interface RawEvalCase {
  name?: unknown;
  prompt?: unknown;
  expectedOutput?: unknown;
  assertions?: unknown;
}

const MAX_PROMPT_CHARS = 14000;
const MAX_OUTPUT_CHARS_FOR_GRADING = 5000;

export async function createReviewSession(
  entry: SkillLibraryEntry,
  kind: SkillReviewKind,
  deps: ReviewEngineDeps
): Promise<SkillReviewSession> {
  const now = deps.now?.() || new Date();
  const result = await deps.generateText(buildEvalCasePrompt(entry, kind), { json: true, temperature: 0.2 });
  const cases = parseEvalCases(result.text);
  const id = deps.idFactory?.() || `rev_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    entryId: entry.id,
    skillName: entry.skillName,
    kind,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    status: "draft",
    cases,
    runs: [],
    grades: [],
    feedback: {}
  };
}

export async function runReviewSession(
  session: SkillReviewSession,
  entry: SkillLibraryEntry,
  deps: ReviewEngineDeps
): Promise<SkillReviewSession> {
  const started = deps.now?.() || new Date();
  const next: SkillReviewSession = {
    ...session,
    status: "running",
    updatedAt: started.toISOString(),
    error: undefined
  };

  for (const evalCase of next.cases) {
    for (const kind of ["baseline", "with_skill"] as const) {
      if (!next.runs.some((run) => run.evalCaseId === evalCase.id && run.kind === kind)) {
        const run = await runSingleEval(evalCase, entry, next.kind, kind, deps);
        next.runs = [...next.runs, run];
      }
    }
  }

  for (const run of next.runs) {
    if (run.status !== "completed") {
      continue;
    }
    if (!next.grades.some((grade) => grade.runId === run.id)) {
      const evalCase = next.cases.find((item) => item.id === run.evalCaseId);
      if (evalCase) {
        const grade = await gradeSingleRun(evalCase, run, deps);
        next.grades = [...next.grades, grade];
      }
    }
  }

  const completed = deps.now?.() || new Date();
  next.summary = aggregateReviewSummary(next.cases, next.runs, next.grades);
  next.status = "ready";
  next.updatedAt = completed.toISOString();
  return next;
}

export async function improveReviewSession(
  session: SkillReviewSession,
  entry: SkillLibraryEntry,
  deps: ReviewEngineDeps
): Promise<SkillReviewSession> {
  const now = deps.now?.() || new Date();
  const running: SkillReviewSession = {
    ...session,
    status: "improving",
    updatedAt: now.toISOString(),
    error: undefined
  };
  const result = await deps.generateText(buildImprovementPrompt(running, entry), { json: true, temperature: 0.2 });
  const parsed = parseJsonObject(result.text);
  const proposedSkillMd = typeof parsed.proposedSkillMd === "string" ? parsed.proposedSkillMd.trim() : "";
  if (!proposedSkillMd.includes("SKILL.md") && !proposedSkillMd.includes("---")) {
    throw new Error("Gemini did not return a usable improved SKILL.md.");
  }
  const finished = deps.now?.() || new Date();
  return {
    ...running,
    status: "improved",
    updatedAt: finished.toISOString(),
    improvement: {
      proposedSkillMd,
      rationale:
        typeof parsed.rationale === "string" && parsed.rationale.trim()
          ? parsed.rationale.trim()
          : "Improved based on review feedback and grades.",
      createdAt: finished.toISOString()
    }
  };
}

async function runSingleEval(
  evalCase: SkillEvalCase,
  entry: SkillLibraryEntry,
  skillKind: SkillReviewKind,
  runKind: "baseline" | "with_skill",
  deps: ReviewEngineDeps
): Promise<SkillEvalRun> {
  const started = deps.now?.() || new Date();
  const id = `${evalCase.id}-${runKind}`;
  try {
    const prompt =
      runKind === "baseline"
        ? buildBaselineRunPrompt(evalCase)
        : buildWithSkillRunPrompt(evalCase, entry, skillKind);
    const result = await deps.generateText(prompt, { temperature: 0.3 });
    const completed = deps.now?.() || new Date();
    return {
      id,
      evalCaseId: evalCase.id,
      kind: runKind,
      status: "completed",
      output: result.text.trim(),
      startedAt: started.toISOString(),
      completedAt: completed.toISOString(),
      ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
      ...(result.totalTokens !== undefined ? { totalTokens: result.totalTokens } : {})
    };
  } catch (error) {
    const completed = deps.now?.() || new Date();
    return {
      id,
      evalCaseId: evalCase.id,
      kind: runKind,
      status: "failed",
      output: "",
      startedAt: started.toISOString(),
      completedAt: completed.toISOString(),
      error: error instanceof Error ? error.message : "The eval run failed."
    };
  }
}

async function gradeSingleRun(
  evalCase: SkillEvalCase,
  run: SkillEvalRun,
  deps: ReviewEngineDeps
): Promise<SkillEvalGrade> {
  try {
    const result = await deps.generateText(buildGradePrompt(evalCase, run), { json: true, temperature: 0 });
    const parsed = parseJsonObject(result.text);
    const expectations = normalizeExpectations(parsed.expectations, evalCase.assertions);
    const passed = expectations.filter((item) => item.passed).length;
    return {
      runId: run.id,
      evalCaseId: run.evalCaseId,
      kind: run.kind,
      expectations,
      passRate: expectations.length > 0 ? passed / expectations.length : 0,
      summary:
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim()
          : `${passed} of ${expectations.length} checks passed.`
    };
  } catch (error) {
    const expectations = evalCase.assertions.map((assertion) => ({
      text: assertion.text,
      passed: false,
      evidence: error instanceof Error ? error.message : "Could not grade this run."
    }));
    return {
      runId: run.id,
      evalCaseId: run.evalCaseId,
      kind: run.kind,
      expectations,
      passRate: 0,
      summary: "The grading step failed."
    };
  }
}

export function aggregateReviewSummary(
  cases: SkillEvalCase[],
  runs: SkillEvalRun[],
  grades: SkillEvalGrade[]
): SkillReviewSummary {
  const baselineGrades = grades.filter((grade) => grade.kind === "baseline");
  const withSkillGrades = grades.filter((grade) => grade.kind === "with_skill");
  const baselineRuns = runs.filter((run) => run.kind === "baseline" && run.status === "completed");
  const withSkillRuns = runs.filter((run) => run.kind === "with_skill" && run.status === "completed");
  const baselinePassRate = mean(baselineGrades.map((grade) => grade.passRate));
  const withSkillPassRate = mean(withSkillGrades.map((grade) => grade.passRate));
  const summary: SkillReviewSummary = {
    evalCount: cases.length,
    baselinePassRate,
    withSkillPassRate,
    passRateDelta: withSkillPassRate - baselinePassRate
  };
  const baselineDuration = meanDefined(baselineRuns.map((run) => run.durationMs));
  const withSkillDuration = meanDefined(withSkillRuns.map((run) => run.durationMs));
  const baselineTokens = meanDefined(baselineRuns.map((run) => run.totalTokens));
  const withSkillTokens = meanDefined(withSkillRuns.map((run) => run.totalTokens));
  if (baselineDuration !== undefined) summary.baselineMeanDurationMs = baselineDuration;
  if (withSkillDuration !== undefined) summary.withSkillMeanDurationMs = withSkillDuration;
  if (baselineTokens !== undefined) summary.baselineMeanTokens = baselineTokens;
  if (withSkillTokens !== undefined) summary.withSkillMeanTokens = withSkillTokens;
  return summary;
}

function buildEvalCasePrompt(entry: SkillLibraryEntry, kind: SkillReviewKind): string {
  const files = entry.files[kind];
  return [
    "Create lightweight text/markdown evaluation cases for this generated AI-agent skill.",
    "",
    "Return only valid JSON with this shape:",
    '{"evals":[{"name":"short descriptive name","prompt":"realistic user task","expectedOutput":"what a good answer should include","assertions":["objective check"]}]}',
    "",
    "Rules:",
    "- Create 2 or 3 evals.",
    "- Prompts must sound like real users and must be answerable as text or Markdown.",
    "- Assertions must be objective checks a grader can verify from the output.",
    "- Do not require local files, browsers, APIs, images, or external tools.",
    "",
    "Skill name:",
    entry.skillName,
    "",
    "SKILL.md:",
    truncate(files.skill, MAX_PROMPT_CHARS),
    "",
    "Reference notes:",
    truncate(files.reference, 4000)
  ].join("\n");
}

function buildBaselineRunPrompt(evalCase: SkillEvalCase): string {
  return [
    "You are a capable AI assistant. Complete the user's task directly.",
    "Do not mention that this is an evaluation. Return only the final answer.",
    "",
    "User task:",
    evalCase.prompt
  ].join("\n");
}

function buildWithSkillRunPrompt(evalCase: SkillEvalCase, entry: SkillLibraryEntry, kind: SkillReviewKind): string {
  const files = entry.files[kind];
  return [
    "You are a capable AI agent. Use the provided skill when answering the user's task.",
    "Do not mention that this is an evaluation. Return only the final answer.",
    "",
    "SKILL.md:",
    truncate(files.skill, MAX_PROMPT_CHARS),
    "",
    "Reference notes:",
    truncate(files.reference, 4000),
    "",
    "User task:",
    evalCase.prompt
  ].join("\n");
}

function buildGradePrompt(evalCase: SkillEvalCase, run: SkillEvalRun): string {
  return [
    "Grade this output against the expected result and assertions.",
    "",
    "Return only valid JSON with this shape:",
    '{"expectations":[{"text":"assertion text","passed":true,"evidence":"short quote or paraphrase"}],"summary":"one sentence"}',
    "",
    "Expected output:",
    evalCase.expectedOutput,
    "",
    "Assertions:",
    ...evalCase.assertions.map((assertion) => `- ${assertion.text}`),
    "",
    "Output to grade:",
    truncate(run.output, MAX_OUTPUT_CHARS_FOR_GRADING)
  ].join("\n");
}

function buildImprovementPrompt(session: SkillReviewSession, entry: SkillLibraryEntry): string {
  const files = entry.files[session.kind];
  const reviewNotes = session.cases
    .map((evalCase) => {
      const baselineGrade = session.grades.find((grade) => grade.evalCaseId === evalCase.id && grade.kind === "baseline");
      const withSkillGrade = session.grades.find((grade) => grade.evalCaseId === evalCase.id && grade.kind === "with_skill");
      const feedback = session.feedback[evalCase.id] || "";
      const withSkillRun = session.runs.find((run) => run.evalCaseId === evalCase.id && run.kind === "with_skill");
      return [
        `Eval: ${evalCase.name}`,
        `Prompt: ${evalCase.prompt}`,
        `Expected: ${evalCase.expectedOutput}`,
        `Baseline pass rate: ${formatRate(baselineGrade?.passRate)}`,
        `With-skill pass rate: ${formatRate(withSkillGrade?.passRate)}`,
        feedback ? `Human feedback: ${feedback}` : "Human feedback: none",
        withSkillRun?.output ? `With-skill output: ${truncate(withSkillRun.output, 1200)}` : "With-skill output: unavailable"
      ].join("\n");
    })
    .join("\n\n");

  return [
    "Improve this SKILL.md based on review grades and human feedback.",
    "",
    "Return only valid JSON with this shape:",
    '{"proposedSkillMd":"full revised SKILL.md markdown","rationale":"short explanation of what changed"}',
    "",
    "Keep the same skill name unless the existing frontmatter is invalid. Preserve source grounding and avoid overfitting to only these evals.",
    "Make the skill easier to trigger, clearer about expected outputs, and more useful for future prompts.",
    "",
    "Current SKILL.md:",
    truncate(files.skill, MAX_PROMPT_CHARS),
    "",
    "Review notes:",
    reviewNotes || "No review notes were captured."
  ].join("\n");
}

function parseEvalCases(text: string): SkillEvalCase[] {
  const parsed = parseJsonObject(text);
  const rawCases = Array.isArray(parsed.evals) ? parsed.evals : [];
  const cases = rawCases.map(normalizeEvalCase).filter((item): item is SkillEvalCase => Boolean(item));
  if (cases.length === 0) {
    throw new Error("Gemini did not return usable eval cases.");
  }
  return makeCaseIdsUnique(cases.slice(0, 3));
}

function normalizeEvalCase(raw: RawEvalCase, index: number): SkillEvalCase | null {
  if (typeof raw !== "object" || raw === null) return null;
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : `Eval ${index + 1}`;
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  const expectedOutput = typeof raw.expectedOutput === "string" ? raw.expectedOutput.trim() : "";
  const assertions = Array.isArray(raw.assertions)
    ? raw.assertions
        .map((item, assertionIndex): SkillEvalAssertion | null => {
          const text = typeof item === "string" ? item.trim() : "";
          return text ? { id: `a${assertionIndex + 1}`, text } : null;
        })
        .filter((item): item is SkillEvalAssertion => Boolean(item))
    : [];
  if (!prompt || !expectedOutput || assertions.length === 0) {
    return null;
  }
  return {
    id: slugifyId(name, `eval-${index + 1}`),
    name,
    prompt,
    expectedOutput,
    assertions: assertions.slice(0, 5)
  };
}

function makeCaseIdsUnique(cases: SkillEvalCase[]): SkillEvalCase[] {
  const seen = new Map<string, number>();
  return cases.map((evalCase) => {
    const count = seen.get(evalCase.id) || 0;
    seen.set(evalCase.id, count + 1);
    if (count === 0) {
      return evalCase;
    }
    return { ...evalCase, id: `${evalCase.id}-${count + 1}` };
  });
}

function normalizeExpectations(value: unknown, assertions: SkillEvalAssertion[]): SkillEvalExpectationResult[] {
  if (!Array.isArray(value)) {
    return assertions.map((assertion) => ({
      text: assertion.text,
      passed: false,
      evidence: "The grader did not return expectation details."
    }));
  }
  return assertions.map((assertion, index) => {
    const raw = value[index];
    if (typeof raw === "object" && raw !== null) {
      const record = raw as Record<string, unknown>;
      return {
        text: typeof record.text === "string" && record.text.trim() ? record.text.trim() : assertion.text,
        passed: record.passed === true,
        evidence:
          typeof record.evidence === "string" && record.evidence.trim()
            ? record.evidence.trim()
            : "No evidence supplied."
      };
    }
    return {
      text: assertion.text,
      passed: false,
      evidence: "No grade supplied for this assertion."
    };
  });
}

function parseJsonObject(text: string): Record<string, unknown> {
  const cleaned = stripJsonFence(text.trim());
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    }
  }
  throw new Error("Gemini did not return valid JSON.");
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function meanDefined(values: Array<number | undefined>): number | undefined {
  const clean = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return clean.length > 0 ? mean(clean) : undefined;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n\n[Omitted ${value.length - max} chars for review prompt length.]`;
}

function slugifyId(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || fallback;
}

function formatRate(value: number | undefined): string {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "not graded";
}
