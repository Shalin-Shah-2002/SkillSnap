import { describe, expect, it } from "vitest";
import {
  createSkillLibrary,
  DEFAULT_SKILL_LIBRARY_CONFIG,
  formatRelativeTime,
  SkillLibraryQuotaError,
  type SkillLibraryEntry,
  type SkillLibraryStorage
} from "./skillLibrary";
import type { SkillLibraryConfig } from "./skillLibraryTypes";

class InMemoryStorage implements SkillLibraryStorage {
  store: Record<string, unknown> = {};
  failNextSet: "quota" | "error" | null = null;
  failNextSetCount = 0;

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
    const shouldFail = this.failNextSet && (this.failNextSetCount === 0 || this.failNextSetCount > 0);
    if (shouldFail) {
      const mode = this.failNextSet;
      if (this.failNextSetCount > 0) {
        this.failNextSetCount -= 1;
        if (this.failNextSetCount === 0) {
          this.failNextSet = null;
        }
      } else {
        this.failNextSet = null;
      }
      if (mode === "quota") {
        (globalThis as unknown as { chrome: { runtime: { lastError: { message: string } | null } } }).chrome = {
          runtime: { lastError: { message: "QUOTA_BYTES quota exceeded" } }
        };
        callback?.();
        (globalThis as unknown as { chrome: { runtime: { lastError: { message: string } | null } } }).chrome = {
          runtime: { lastError: null }
        };
        return;
      }
      (globalThis as unknown as { chrome: { runtime: { lastError: { message: string } | null } } }).chrome = {
        runtime: { lastError: { message: "Some other failure" } }
      };
      callback?.();
      (globalThis as unknown as { chrome: { runtime: { lastError: { message: string } | null } } }).chrome = {
        runtime: { lastError: null }
      };
      return;
    }
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

const fixedNow = new Date("2026-05-31T12:00:00.000Z");
const fixedClock = { now: () => fixedNow };
let idCounter = 0;
const fixedRandom = { hex: () => `seq${(idCounter += 1).toString(16).padStart(2, "0")}` };

function makeEntry(overrides: Partial<SkillLibraryEntry> = {}): SkillLibraryEntry {
  return {
    id: overrides.id || "sk_test_001",
    createdAt: overrides.createdAt || "2026-05-30T00:00:00.000Z",
    videoUrl: overrides.videoUrl || "https://www.youtube.com/watch?v=abc",
    videoTitle: overrides.videoTitle || "Test video",
    channelName: overrides.channelName || "Test channel",
    skillName: overrides.skillName || "test-skill",
    displayName: overrides.displayName || "Test Skill",
    model: overrides.model || "gemini/gemini-2.5-flash",
    files: overrides.files || {
      codex: { skill: "c-skill", reference: "c-ref", transcript: "c-trans" },
      claude: { skill: "l-skill", reference: "l-ref", transcript: "l-trans" }
    },
    transcript: overrides.transcript || "full transcript text",
    generatedVia: overrides.generatedVia || "extension",
    ...overrides
  };
}

function makeLibrary(softCap: number = DEFAULT_SKILL_LIBRARY_CONFIG.softCap, storage: InMemoryStorage = new InMemoryStorage()) {
  (globalThis as unknown as { chrome: { runtime: { lastError: { message: string } | null } } }).chrome = {
    runtime: { lastError: null }
  };
  storage.store["skillLibrary.config"] = { softCap } as SkillLibraryConfig;
  const lib = createSkillLibrary({ storage, clock: fixedClock, random: fixedRandom });
  return { lib, storage };
}

describe("skillLibrary", () => {
  it("returns an empty list when no entries are stored", async () => {
    const { lib } = makeLibrary();
    const list = await lib.listEntries();
    expect(list).toEqual([]);
  });

  it("lists entries newest first", async () => {
    const { lib, storage } = makeLibrary();
    storage.store["skillLibrary.v1"] = {
      entries: [
        makeEntry({ id: "a", createdAt: "2026-05-29T00:00:00.000Z" }),
        makeEntry({ id: "b", createdAt: "2026-05-31T00:00:00.000Z" }),
        makeEntry({ id: "c", createdAt: "2026-05-30T00:00:00.000Z" })
      ]
    };
    const list = await lib.listEntries();
    expect(list.map((e) => e.id)).toEqual(["b", "c", "a"]);
  });

  it("adds an entry and assigns id + createdAt when not provided", async () => {
    const { lib } = makeLibrary();
    const { entry, evicted } = await lib.addEntry(makeEntry({ id: undefined as unknown as string, createdAt: undefined as unknown as string }));
    expect(entry.id).toMatch(/^sk_/);
    expect(entry.createdAt).toBe(fixedNow.toISOString());
    expect(evicted).toEqual([]);
  });

  it("evicts oldest entries when soft cap is exceeded", async () => {
    const { lib, storage } = makeLibrary(2);
    storage.store["skillLibrary.v1"] = {
      entries: [
        makeEntry({ id: "old1", createdAt: "2026-01-01T00:00:00.000Z" }),
        makeEntry({ id: "old2", createdAt: "2026-01-02T00:00:00.000Z" })
      ]
    };
    const { entry, evicted } = await lib.addEntry(makeEntry({ id: "new", createdAt: "2026-06-01T00:00:00.000Z" }));
    expect(entry.id).toBe("new");
    expect(evicted.map((e) => e.id)).toEqual(["old1"]);
  });

  it("deletes an entry by id", async () => {
    const { lib, storage } = makeLibrary();
    storage.store["skillLibrary.v1"] = {
      entries: [makeEntry({ id: "a" }), makeEntry({ id: "b" })]
    };
    const ok = await lib.deleteEntry("a");
    expect(ok).toBe(true);
    const list = await lib.listEntries();
    expect(list.map((e) => e.id)).toEqual(["b"]);
  });

  it("delete returns false when id is missing", async () => {
    const { lib } = makeLibrary();
    const ok = await lib.deleteEntry("missing");
    expect(ok).toBe(false);
  });

  it("filters out corrupted entries on read", async () => {
    const { lib, storage } = makeLibrary();
    storage.store["skillLibrary.v1"] = {
      entries: [
        makeEntry({ id: "ok" }),
        { id: "broken" },
        null,
        { id: 42 },
        { id: "missing-files", createdAt: "2026-01-01T00:00:00.000Z", videoUrl: "x", videoTitle: "t", channelName: "c", skillName: "s", displayName: "d", model: "m", files: undefined, transcript: "x" }
      ]
    };
    const list = await lib.listEntries();
    expect(list.map((e) => e.id)).toEqual(["ok"]);
  });

  it("caches ZIP blobs via setZip", async () => {
    const { lib, storage } = makeLibrary();
    storage.store["skillLibrary.v1"] = { entries: [makeEntry({ id: "a" })] };
    const updated = await lib.setZip("a", "codex", "BASE64DATA");
    expect(updated?.codexZip).toBe("BASE64DATA");
    const updated2 = await lib.setZip("a", "claude", "BASE64DATA2");
    expect(updated2?.claudeZip).toBe("BASE64DATA2");
  });

  it("lets updates clear stale ZIP blobs", async () => {
    const { lib, storage } = makeLibrary();
    storage.store["skillLibrary.v1"] = {
      entries: [makeEntry({ id: "a", codexZip: "OLD-CODEX", claudeZip: "OLD-CLAUDE" })]
    };
    await lib.updateEntry("a", { codexZip: "", claudeZip: "" });
    const entry = await lib.getEntry("a");
    expect(entry?.codexZip).toBeUndefined();
    expect(entry?.claudeZip).toBeUndefined();
  });

  it("retries once on quota error by dropping the oldest entry", async () => {
    const { lib, storage } = makeLibrary();
    storage.store["skillLibrary.v1"] = {
      entries: [
        makeEntry({ id: "oldest", createdAt: "2026-01-01T00:00:00.000Z" }),
        makeEntry({ id: "newer", createdAt: "2026-01-02T00:00:00.000Z" })
      ]
    };
    storage.failNextSet = "quota";
    storage.failNextSetCount = 1;
    const { entry, evicted } = await lib.addEntry(makeEntry({ id: "newest", createdAt: "2026-06-01T00:00:00.000Z" }));
    expect(entry.id).toBe("newest");
    expect(evicted.map((e) => e.id)).toEqual([]);
    const list = await lib.listEntries();
    expect(list.map((e) => e.id)).toEqual(["newest", "newer"]);
  });

  it("surfaces quota error when there is nothing left to evict", async () => {
    const { lib, storage } = makeLibrary();
    storage.failNextSet = "quota";
    storage.failNextSetCount = 5;
    let caught: unknown = null;
    try {
      await lib.addEntry(makeEntry({ id: "only" }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SkillLibraryQuotaError);
  });

  it("updates soft cap and evicts extra entries", async () => {
    const { lib, storage } = makeLibrary(10);
    storage.store["skillLibrary.v1"] = {
      entries: [
        makeEntry({ id: "a", createdAt: "2026-01-01T00:00:00.000Z" }),
        makeEntry({ id: "b", createdAt: "2026-01-02T00:00:00.000Z" }),
        makeEntry({ id: "c", createdAt: "2026-01-03T00:00:00.000Z" })
      ]
    };
    const config = await lib.setSoftCap(1);
    expect(config.softCap).toBe(1);
    const list = await lib.listEntries();
    expect(list.map((e) => e.id)).toEqual(["c"]);
  });

  it("formatRelativeTime returns human-friendly strings", () => {
    const base = new Date("2026-05-31T12:00:00.000Z").getTime();
    expect(formatRelativeTime(new Date(base - 30 * 1000).toISOString(), new Date(base))).toBe("just now");
    expect(formatRelativeTime(new Date(base - 10 * 60 * 1000).toISOString(), new Date(base))).toBe("10m ago");
    expect(formatRelativeTime(new Date(base - 3 * 60 * 60 * 1000).toISOString(), new Date(base))).toBe("3h ago");
    expect(formatRelativeTime(new Date(base - 2 * 24 * 60 * 60 * 1000).toISOString(), new Date(base))).toBe("2d ago");
    expect(formatRelativeTime(new Date(base + 1000).toISOString(), new Date(base))).toBe("just now");
  });
});
