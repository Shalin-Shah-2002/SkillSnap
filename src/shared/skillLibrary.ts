import {
  DEFAULT_SKILL_LIBRARY_SOFT_CAP,
  MAX_SKILL_LIBRARY_SOFT_CAP,
  MIN_SKILL_LIBRARY_SOFT_CAP,
  SKILL_LIBRARY_CONFIG_KEY,
  SKILL_LIBRARY_STORAGE_KEY,
  type SkillLibraryConfig,
  type SkillLibraryData,
  type SkillLibraryEntry
} from "./skillLibraryTypes";

export type {
  SkillLibraryConfig,
  SkillLibraryData,
  SkillLibraryEntry,
  SkillLibraryEntryFiles,
  SkillLibraryGeneratedVia,
  SkillPackageFiles
} from "./skillLibraryTypes";

export const DEFAULT_SKILL_LIBRARY_CONFIG: SkillLibraryConfig = {
  softCap: DEFAULT_SKILL_LIBRARY_SOFT_CAP
};

export class SkillLibraryQuotaError extends Error {
  readonly kind = "quota" as const;
  constructor(message: string) {
    super(message);
    this.name = "SkillLibraryQuotaError";
  }
}

export class SkillLibraryCorruptEntryError extends Error {
  readonly kind = "corrupt" as const;
  constructor(message: string) {
    super(message);
    this.name = "SkillLibraryCorruptEntryError";
  }
}

export interface SkillLibraryStorage {
  get(keys: string | string[] | null, callback: (items: Record<string, unknown>) => void): void;
  set(items: Record<string, unknown>, callback?: () => void): void;
  remove(keys: string | string[], callback?: () => void): void;
}

export interface SkillLibraryLogger {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface SkillLibraryClock {
  now(): Date;
}

export interface SkillLibraryRandom {
  hex(bytes: number): string;
}

export interface SkillLibraryDeps {
  storage: SkillLibraryStorage;
  logger?: SkillLibraryLogger;
  clock?: SkillLibraryClock;
  random?: SkillLibraryRandom;
}

const defaultClock: SkillLibraryClock = {
  now: () => new Date()
};

const defaultRandom: SkillLibraryRandom = {
  hex(bytes: number): string {
    if (bytes <= 0) {
      return "";
    }
    const arr = new Uint8Array(bytes);
    if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.getRandomValues === "function") {
      globalThis.crypto.getRandomValues(arr);
    } else {
      for (let i = 0; i < bytes; i += 1) {
        arr[i] = Math.floor(Math.random() * 256);
      }
    }
    let out = "";
    for (let i = 0; i < arr.length; i += 1) {
      out += arr[i].toString(16).padStart(2, "0");
    }
    return out;
  }
};

const consoleLogger: SkillLibraryLogger = {
  log: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args)
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validateEntry(raw: unknown, index: number): SkillLibraryEntry | null {
  if (!isPlainObject(raw)) {
    return null;
  }
  if (!isNonEmptyString(raw.id) || !isNonEmptyString(raw.createdAt) || !isNonEmptyString(raw.videoUrl)) {
    return null;
  }
  if (!isNonEmptyString(raw.videoTitle) || !isNonEmptyString(raw.channelName) || !isNonEmptyString(raw.skillName)) {
    return null;
  }
  if (!isNonEmptyString(raw.displayName) || !isNonEmptyString(raw.model)) {
    return null;
  }
  if (!isPlainObject(raw.files)) {
    return null;
  }
  const codex = raw.files.codex;
  const claude = raw.files.claude;
  if (!isPlainObject(codex) || !isPlainObject(claude)) {
    return null;
  }
  if (
    !isNonEmptyString((codex as Record<string, unknown>).skill) ||
    !isNonEmptyString((codex as Record<string, unknown>).reference) ||
    !isNonEmptyString((codex as Record<string, unknown>).transcript)
  ) {
    return null;
  }
  if (
    !isNonEmptyString((claude as Record<string, unknown>).skill) ||
    !isNonEmptyString((claude as Record<string, unknown>).reference) ||
    !isNonEmptyString((claude as Record<string, unknown>).transcript)
  ) {
    return null;
  }
  if (typeof raw.transcript !== "string") {
    return null;
  }

  const entry: SkillLibraryEntry = {
    id: raw.id,
    createdAt: raw.createdAt,
    videoUrl: raw.videoUrl,
    videoTitle: raw.videoTitle,
    channelName: raw.channelName,
    skillName: raw.skillName,
    displayName: raw.displayName,
    model: raw.model,
    files: {
      codex: {
        skill: (codex as Record<string, unknown>).skill as string,
        reference: (codex as Record<string, unknown>).reference as string,
        transcript: (codex as Record<string, unknown>).transcript as string
      },
      claude: {
        skill: (claude as Record<string, unknown>).skill as string,
        reference: (claude as Record<string, unknown>).reference as string,
        transcript: (claude as Record<string, unknown>).transcript as string
      }
    },
    transcript: raw.transcript,
    generatedVia: raw.generatedVia === "external" ? "external" : "extension"
  };
  if (typeof raw.skillNameHint === "string" && raw.skillNameHint.length > 0) {
    entry.skillNameHint = raw.skillNameHint;
  }
  if (typeof raw.templateId === "string" && raw.templateId.length > 0) {
    entry.templateId = raw.templateId;
  }
  if (typeof raw.codexZip === "string" && raw.codexZip.length > 0) {
    entry.codexZip = raw.codexZip;
  }
  if (typeof raw.claudeZip === "string" && raw.claudeZip.length > 0) {
    entry.claudeZip = raw.claudeZip;
  }
  return entry;
}

function parseEntries(stored: unknown, logger: SkillLibraryLogger): SkillLibraryEntry[] {
  if (!isPlainObject(stored) || !Array.isArray(stored.entries)) {
    return [];
  }
  const out: SkillLibraryEntry[] = [];
  for (let i = 0; i < stored.entries.length; i += 1) {
    const valid = validateEntry(stored.entries[i], i);
    if (valid) {
      out.push(valid);
    } else {
      logger.warn(`[skillLibrary] Skipping corrupted entry at index ${i}`);
    }
  }
  return out;
}

function parseConfig(stored: unknown): SkillLibraryConfig {
  if (!isPlainObject(stored)) {
    return { ...DEFAULT_SKILL_LIBRARY_CONFIG };
  }
  const cap = stored.softCap;
  if (typeof cap !== "number" || !Number.isFinite(cap)) {
    return { ...DEFAULT_SKILL_LIBRARY_CONFIG };
  }
  const safe = Math.max(MIN_SKILL_LIBRARY_SOFT_CAP, Math.min(MAX_SKILL_LIBRARY_SOFT_CAP, Math.floor(cap)));
  return { softCap: safe };
}

function isQuotaErrorMessage(message: string | undefined): boolean {
  if (!message) {
    return false;
  }
  const lower = message.toLowerCase();
  return (
    lower.includes("quota_bytes") ||
    lower.includes("quota") ||
    lower.includes("exceeded") ||
    lower.includes("quotaexceeded")
  );
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

function writeStorage(
  storage: SkillLibraryStorage,
  payload: Record<string, unknown>
): Promise<void> {
  return new Promise((resolve, reject) => {
    storage.set(payload, () => {
      const lastError =
        typeof chrome !== "undefined" && chrome.runtime?.lastError?.message
          ? chrome.runtime.lastError.message
          : undefined;
      if (lastError) {
        if (isQuotaErrorMessage(lastError)) {
          reject(new SkillLibraryQuotaError(lastError));
        } else {
          reject(new Error(lastError));
        }
        return;
      }
      resolve();
    });
  });
}

export function createSkillLibrary(deps: SkillLibraryDeps) {
  const logger = deps.logger || consoleLogger;
  const clock = deps.clock || defaultClock;
  const random = deps.random || defaultRandom;
  const storage = deps.storage;

  function readAll(): Promise<{ entries: SkillLibraryEntry[]; config: SkillLibraryConfig }> {
    return new Promise((resolve) => {
      readStorage(storage, [SKILL_LIBRARY_STORAGE_KEY, SKILL_LIBRARY_CONFIG_KEY], (items, _err) => {
        const entries = parseEntries(items[SKILL_LIBRARY_STORAGE_KEY], logger);
        const config = parseConfig(items[SKILL_LIBRARY_CONFIG_KEY]);
        resolve({ entries, config });
      });
    });
  }

  function listEntries(): Promise<SkillLibraryEntry[]> {
    return readAll().then((data) =>
      [...data.entries].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    );
  }

  function getEntry(id: string): Promise<SkillLibraryEntry | null> {
    return readAll().then((data) => data.entries.find((entry) => entry.id === id) || null);
  }

  function generateId(): string {
    const ts = clock.now().getTime().toString(36);
    return `sk_${ts}_${random.hex(3)}`;
  }

  async function addEntry(input: Omit<SkillLibraryEntry, "id" | "createdAt"> & Partial<Pick<SkillLibraryEntry, "id" | "createdAt">>): Promise<{
    entry: SkillLibraryEntry;
    evicted: SkillLibraryEntry[];
  }> {
    const { entries, config } = await readAll();
    const id = input.id || generateId();
    const createdAt = input.createdAt || clock.now().toISOString();
    const entry: SkillLibraryEntry = { ...input, id, createdAt };
    const next = [...entries, entry];
    const evicted: SkillLibraryEntry[] = [];
    while (next.length > config.softCap) {
      const removed = next.shift();
      if (removed) {
        evicted.push(removed);
      }
    }
    await persist(next, config);
    return { entry, evicted };
  }

  async function deleteEntry(id: string): Promise<boolean> {
    const { entries, config } = await readAll();
    const next = entries.filter((entry) => entry.id !== id);
    if (next.length === entries.length) {
      return false;
    }
    await persist(next, config);
    return true;
  }

  async function updateEntry(id: string, patch: Partial<Omit<SkillLibraryEntry, "id" | "createdAt">>): Promise<SkillLibraryEntry | null> {
    const { entries, config } = await readAll();
    let updated: SkillLibraryEntry | null = null;
    const next = entries.map((entry) => {
      if (entry.id !== id) {
        return entry;
      }
      const merged: SkillLibraryEntry = { ...entry, ...patch, id: entry.id, createdAt: entry.createdAt };
      updated = merged;
      return merged;
    });
    if (!updated) {
      return null;
    }
    await persist(next, config);
    return updated;
  }

  async function setZip(id: string, kind: "codex" | "claude", base64: string): Promise<SkillLibraryEntry | null> {
    const patch = kind === "codex" ? { codexZip: base64 } : { claudeZip: base64 };
    return updateEntry(id, patch);
  }

  async function setSoftCap(softCap: number): Promise<SkillLibraryConfig> {
    const safe = Math.max(MIN_SKILL_LIBRARY_SOFT_CAP, Math.min(MAX_SKILL_LIBRARY_SOFT_CAP, Math.floor(softCap)));
    const { entries } = await readAll();
    let evicted: SkillLibraryEntry[] = [];
    let next = entries;
    while (next.length > safe) {
      const removed = next.shift();
      if (removed) {
        evicted.push(removed);
      } else {
        break;
      }
    }
    const config: SkillLibraryConfig = { softCap: safe };
    await persist(next, config);
    if (evicted.length > 0) {
      logger.warn(`[skillLibrary] Soft cap reduced to ${safe}; evicted ${evicted.length} oldest entries.`);
    }
    return config;
  }

  async function persist(entries: SkillLibraryEntry[], config: SkillLibraryConfig): Promise<void> {
    const payload: SkillLibraryData = { entries };
    try {
      await writeStorage(storage, {
        [SKILL_LIBRARY_STORAGE_KEY]: payload,
        [SKILL_LIBRARY_CONFIG_KEY]: config
      });
    } catch (error) {
      if (error instanceof SkillLibraryQuotaError) {
        if (entries.length > 0) {
          const dropped = entries.shift();
          if (dropped) {
            logger.warn(`[skillLibrary] Quota exceeded; dropping oldest entry ${dropped.id} and retrying.`);
            try {
              await writeStorage(storage, {
                [SKILL_LIBRARY_STORAGE_KEY]: { entries },
                [SKILL_LIBRARY_CONFIG_KEY]: config
              });
              return;
            } catch (retryError) {
              throw retryError;
            }
          }
        }
        throw error;
      }
      throw error;
    }
  }

  return {
    listEntries,
    getEntry,
    addEntry,
    deleteEntry,
    updateEntry,
    setZip,
    setSoftCap,
    readAll,
    validateEntry
  };
}

export type SkillLibrary = ReturnType<typeof createSkillLibrary>;

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) {
    return "unknown";
  }
  const diffMs = now.getTime() - then;
  if (diffMs < 0) {
    return "just now";
  }
  const sec = Math.floor(diffMs / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}mo ago`;
  const year = Math.floor(day / 365);
  return `${year}y ago`;
}
