import { describe, expect, it } from "vitest";
import { createSkillReviewStorage, pruneReviewSessions } from "./skillReviewStorage";
import {
  MAX_SKILL_REVIEW_SESSIONS_PER_ENTRY,
  SKILL_REVIEW_STORAGE_KEY,
  type SkillReviewSession
} from "./skillReviewTypes";
import type { SkillLibraryStorage } from "./skillLibrary";

class InMemoryStorage implements SkillLibraryStorage {
  store: Record<string, unknown> = {};

  get(keys: string | string[] | null, callback: (items: Record<string, unknown>) => void): void {
    if (keys === null) {
      callback({ ...this.store });
      return;
    }
    const list = Array.isArray(keys) ? keys : [keys];
    const out: Record<string, unknown> = {};
    for (const key of list) {
      if (key in this.store) {
        out[key] = this.store[key];
      }
    }
    callback(out);
  }

  set(items: Record<string, unknown>, callback?: () => void): void {
    Object.assign(this.store, items);
    callback?.();
  }

  remove(keys: string | string[], callback?: () => void): void {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) {
      delete this.store[key];
    }
    callback?.();
  }
}

function makeSession(overrides: Partial<SkillReviewSession> = {}): SkillReviewSession {
  return {
    id: overrides.id || "rev-a",
    entryId: overrides.entryId || "entry-a",
    skillName: overrides.skillName || "demo-skill",
    kind: overrides.kind || "codex",
    createdAt: overrides.createdAt || "2026-06-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt || "2026-06-01T00:00:00.000Z",
    status: overrides.status || "draft",
    cases:
      overrides.cases || [
        {
          id: "eval-one",
          name: "Eval one",
          prompt: "Do the task.",
          expectedOutput: "A good answer.",
          assertions: [{ id: "a1", text: "Includes a good answer." }]
        }
      ],
    runs: overrides.runs || [],
    grades: overrides.grades || [],
    feedback: overrides.feedback || {},
    ...overrides
  };
}

describe("skillReviewStorage", () => {
  it("filters corrupted sessions while reading valid ones", async () => {
    const storage = new InMemoryStorage();
    storage.store[SKILL_REVIEW_STORAGE_KEY] = {
      sessions: [makeSession({ id: "ok" }), { id: "broken" }, null]
    };
    const store = createSkillReviewStorage({ storage });
    const sessions = await store.listSessions();
    expect(sessions.map((session) => session.id)).toEqual(["ok"]);
  });

  it("upserts sessions and lists by entry id", async () => {
    const storage = new InMemoryStorage();
    const store = createSkillReviewStorage({ storage });
    await store.upsertSession(makeSession({ id: "one", entryId: "a" }));
    await store.upsertSession(makeSession({ id: "two", entryId: "b" }));
    await store.upsertSession(makeSession({ id: "one", entryId: "a", status: "ready" }));
    const sessions = await store.listSessions("a");
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("one");
    expect(sessions[0].status).toBe("ready");
  });

  it("prunes to the latest sessions per entry", () => {
    const sessions = Array.from({ length: MAX_SKILL_REVIEW_SESSIONS_PER_ENTRY + 2 }, (_, index) =>
      makeSession({
        id: `rev-${index}`,
        entryId: "entry-a",
        updatedAt: `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`
      })
    );
    const pruned = pruneReviewSessions(sessions);
    expect(pruned).toHaveLength(MAX_SKILL_REVIEW_SESSIONS_PER_ENTRY);
    expect(pruned[0].id).toBe(`rev-${MAX_SKILL_REVIEW_SESSIONS_PER_ENTRY + 1}`);
  });

  it("deletes all sessions for a library entry", async () => {
    const storage = new InMemoryStorage();
    const store = createSkillReviewStorage({ storage });
    await store.upsertSession(makeSession({ id: "one", entryId: "a" }));
    await store.upsertSession(makeSession({ id: "two", entryId: "a" }));
    await store.upsertSession(makeSession({ id: "three", entryId: "b" }));
    const removed = await store.deleteSessionsForEntry("a");
    expect(removed).toBe(2);
    expect((await store.listSessions()).map((session) => session.id)).toEqual(["three"]);
  });
});
