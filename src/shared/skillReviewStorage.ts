import {
  MAX_SKILL_REVIEW_SESSIONS_PER_ENTRY,
  MAX_SKILL_REVIEW_SESSIONS_TOTAL,
  SKILL_REVIEW_STORAGE_KEY,
  type SkillEvalAssertion,
  type SkillEvalCase,
  type SkillEvalExpectationResult,
  type SkillEvalGrade,
  type SkillEvalRun,
  type SkillReviewData,
  type SkillReviewImprovement,
  type SkillReviewSession,
  type SkillReviewStatus
} from "./skillReviewTypes";
import type { SkillLibraryLogger, SkillLibraryStorage } from "./skillLibrary";

const noopLogger: SkillLibraryLogger = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function readStorage(
  storage: SkillLibraryStorage,
  keys: string[],
  callback: (items: Record<string, unknown>, lastError: string | undefined) => void
): void {
  storage.get(keys, (items) => {
    const lastError =
      typeof chrome !== "undefined" && chrome.runtime?.lastError?.message
        ? chrome.runtime.lastError.message
        : undefined;
    callback(items || {}, lastError);
  });
}

function writeStorage(storage: SkillLibraryStorage, payload: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    storage.set(payload, () => {
      const lastError =
        typeof chrome !== "undefined" && chrome.runtime?.lastError?.message
          ? chrome.runtime.lastError.message
          : undefined;
      if (lastError) {
        reject(new Error(lastError));
        return;
      }
      resolve();
    });
  });
}

function validateAssertion(raw: unknown, index: number): SkillEvalAssertion | null {
  if (!isRecord(raw)) return null;
  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  if (!text) return null;
  const id = isNonEmptyString(raw.id) ? raw.id : `assertion-${index + 1}`;
  return { id, text };
}

function validateCase(raw: unknown, index: number): SkillEvalCase | null {
  if (!isRecord(raw)) return null;
  if (!isNonEmptyString(raw.name) || !isNonEmptyString(raw.prompt) || !isNonEmptyString(raw.expectedOutput)) {
    return null;
  }
  const assertions = Array.isArray(raw.assertions)
    ? raw.assertions.map(validateAssertion).filter((item): item is SkillEvalAssertion => Boolean(item))
    : [];
  if (assertions.length === 0) return null;
  const id = isNonEmptyString(raw.id) ? raw.id : `eval-${index + 1}`;
  return {
    id,
    name: raw.name,
    prompt: raw.prompt,
    expectedOutput: raw.expectedOutput,
    assertions
  };
}

function validateRun(raw: unknown): SkillEvalRun | null {
  if (!isRecord(raw)) return null;
  if (!isNonEmptyString(raw.id) || !isNonEmptyString(raw.evalCaseId)) return null;
  if (raw.kind !== "baseline" && raw.kind !== "with_skill") return null;
  if (raw.status !== "completed" && raw.status !== "failed") return null;
  if (typeof raw.output !== "string" || !isNonEmptyString(raw.startedAt) || !isNonEmptyString(raw.completedAt)) {
    return null;
  }
  const run: SkillEvalRun = {
    id: raw.id,
    evalCaseId: raw.evalCaseId,
    kind: raw.kind,
    status: raw.status,
    output: raw.output,
    startedAt: raw.startedAt,
    completedAt: raw.completedAt
  };
  if (typeof raw.durationMs === "number" && Number.isFinite(raw.durationMs)) run.durationMs = raw.durationMs;
  if (typeof raw.totalTokens === "number" && Number.isFinite(raw.totalTokens)) run.totalTokens = raw.totalTokens;
  if (typeof raw.error === "string") run.error = raw.error;
  return run;
}

function validateExpectation(raw: unknown): SkillEvalExpectationResult | null {
  if (!isRecord(raw)) return null;
  if (!isNonEmptyString(raw.text) || typeof raw.passed !== "boolean" || !isNonEmptyString(raw.evidence)) {
    return null;
  }
  return { text: raw.text, passed: raw.passed, evidence: raw.evidence };
}

function validateGrade(raw: unknown): SkillEvalGrade | null {
  if (!isRecord(raw)) return null;
  if (!isNonEmptyString(raw.runId) || !isNonEmptyString(raw.evalCaseId)) return null;
  if (raw.kind !== "baseline" && raw.kind !== "with_skill") return null;
  if (!Array.isArray(raw.expectations) || typeof raw.passRate !== "number" || !isNonEmptyString(raw.summary)) {
    return null;
  }
  const expectations = raw.expectations
    .map(validateExpectation)
    .filter((item): item is SkillEvalExpectationResult => Boolean(item));
  return {
    runId: raw.runId,
    evalCaseId: raw.evalCaseId,
    kind: raw.kind,
    expectations,
    passRate: Math.max(0, Math.min(1, raw.passRate)),
    summary: raw.summary
  };
}

function validateImprovement(raw: unknown): SkillReviewImprovement | undefined {
  if (!isRecord(raw)) return undefined;
  if (!isNonEmptyString(raw.proposedSkillMd) || !isNonEmptyString(raw.rationale) || !isNonEmptyString(raw.createdAt)) {
    return undefined;
  }
  return {
    proposedSkillMd: raw.proposedSkillMd,
    rationale: raw.rationale,
    createdAt: raw.createdAt
  };
}

function validateStatus(value: unknown): SkillReviewStatus {
  if (
    value === "draft" ||
    value === "running" ||
    value === "ready" ||
    value === "improving" ||
    value === "improved" ||
    value === "applied" ||
    value === "failed"
  ) {
    return value;
  }
  return "draft";
}

export function validateReviewSession(raw: unknown): SkillReviewSession | null {
  if (!isRecord(raw)) return null;
  if (!isNonEmptyString(raw.id) || !isNonEmptyString(raw.entryId) || !isNonEmptyString(raw.skillName)) {
    return null;
  }
  if (raw.kind !== "codex" && raw.kind !== "claude") return null;
  if (!isNonEmptyString(raw.createdAt) || !isNonEmptyString(raw.updatedAt)) return null;
  if (!Array.isArray(raw.cases) || !Array.isArray(raw.runs) || !Array.isArray(raw.grades)) return null;

  const cases = raw.cases.map(validateCase).filter((item): item is SkillEvalCase => Boolean(item));
  const runs = raw.runs.map(validateRun).filter((item): item is SkillEvalRun => Boolean(item));
  const grades = raw.grades.map(validateGrade).filter((item): item is SkillEvalGrade => Boolean(item));
  const feedback = isRecord(raw.feedback)
    ? Object.fromEntries(
        Object.entries(raw.feedback).filter((entry): entry is [string, string] => typeof entry[1] === "string")
      )
    : {};

  const session: SkillReviewSession = {
    id: raw.id,
    entryId: raw.entryId,
    skillName: raw.skillName,
    kind: raw.kind,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    status: validateStatus(raw.status),
    cases,
    runs,
    grades,
    feedback
  };
  if (isRecord(raw.summary)) {
    session.summary = {
      evalCount: typeof raw.summary.evalCount === "number" ? raw.summary.evalCount : cases.length,
      baselinePassRate: typeof raw.summary.baselinePassRate === "number" ? raw.summary.baselinePassRate : 0,
      withSkillPassRate: typeof raw.summary.withSkillPassRate === "number" ? raw.summary.withSkillPassRate : 0,
      passRateDelta: typeof raw.summary.passRateDelta === "number" ? raw.summary.passRateDelta : 0
    };
    if (typeof raw.summary.baselineMeanDurationMs === "number") session.summary.baselineMeanDurationMs = raw.summary.baselineMeanDurationMs;
    if (typeof raw.summary.withSkillMeanDurationMs === "number") session.summary.withSkillMeanDurationMs = raw.summary.withSkillMeanDurationMs;
    if (typeof raw.summary.baselineMeanTokens === "number") session.summary.baselineMeanTokens = raw.summary.baselineMeanTokens;
    if (typeof raw.summary.withSkillMeanTokens === "number") session.summary.withSkillMeanTokens = raw.summary.withSkillMeanTokens;
  }
  const improvement = validateImprovement(raw.improvement);
  if (improvement) session.improvement = improvement;
  if (typeof raw.error === "string") session.error = raw.error;
  return session;
}

export function pruneReviewSessions(sessions: SkillReviewSession[]): SkillReviewSession[] {
  const byEntry = new Map<string, SkillReviewSession[]>();
  for (const session of sessions) {
    const list = byEntry.get(session.entryId) || [];
    list.push(session);
    byEntry.set(session.entryId, list);
  }
  const pruned: SkillReviewSession[] = [];
  for (const list of byEntry.values()) {
    pruned.push(
      ...list
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
        .slice(0, MAX_SKILL_REVIEW_SESSIONS_PER_ENTRY)
    );
  }
  return pruned
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    .slice(0, MAX_SKILL_REVIEW_SESSIONS_TOTAL);
}

export function createSkillReviewStorage(deps: { storage: SkillLibraryStorage; logger?: SkillLibraryLogger }) {
  const storage = deps.storage;
  const logger = deps.logger || noopLogger;

  function readAll(): Promise<SkillReviewSession[]> {
    return new Promise((resolve) => {
      readStorage(storage, [SKILL_REVIEW_STORAGE_KEY], (items) => {
        const raw = items[SKILL_REVIEW_STORAGE_KEY];
        if (!isRecord(raw) || !Array.isArray(raw.sessions)) {
          resolve([]);
          return;
        }
        const sessions: SkillReviewSession[] = [];
        raw.sessions.forEach((item, index) => {
          const parsed = validateReviewSession(item);
          if (parsed) {
            sessions.push(parsed);
          } else {
            logger.warn(`[skillReviewStorage] Skipping corrupted session at index ${index}`);
          }
        });
        resolve(pruneReviewSessions(sessions));
      });
    });
  }

  async function persist(sessions: SkillReviewSession[]): Promise<void> {
    const data: SkillReviewData = { sessions: pruneReviewSessions(sessions) };
    await writeStorage(storage, { [SKILL_REVIEW_STORAGE_KEY]: data });
  }

  async function listSessions(entryId?: string): Promise<SkillReviewSession[]> {
    const sessions = await readAll();
    const filtered = entryId ? sessions.filter((session) => session.entryId === entryId) : sessions;
    return filtered.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  }

  async function getSession(id: string): Promise<SkillReviewSession | null> {
    const sessions = await readAll();
    return sessions.find((session) => session.id === id) || null;
  }

  async function upsertSession(session: SkillReviewSession): Promise<SkillReviewSession> {
    const sessions = await readAll();
    const index = sessions.findIndex((item) => item.id === session.id);
    const next = index >= 0 ? [...sessions.slice(0, index), session, ...sessions.slice(index + 1)] : [...sessions, session];
    await persist(next);
    return session;
  }

  async function deleteSessionsForEntry(entryId: string): Promise<number> {
    const sessions = await readAll();
    const next = sessions.filter((session) => session.entryId !== entryId);
    const removed = sessions.length - next.length;
    if (removed > 0) {
      await persist(next);
    }
    return removed;
  }

  return {
    readAll,
    listSessions,
    getSession,
    upsertSession,
    deleteSessionsForEntry
  };
}

export type SkillReviewStorage = ReturnType<typeof createSkillReviewStorage>;
