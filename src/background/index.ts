import JSZip from "jszip";
import { buildSkillPackages } from "../shared/skillFormat";
import { readStoredSettings, getSettingsForProvider, hasProviderKey } from "../shared/settings";
import {
  createSkillLibrary,
  DEFAULT_SKILL_LIBRARY_CONFIG,
  type SkillLibraryEntry,
  type SkillLibraryEntryFiles
} from "../shared/skillLibrary";
import {
  SKILL_LIBRARY_CONFIG_KEY,
  type SkillLibraryConfig
} from "../shared/skillLibraryTypes";
import { createSkillReviewStorage } from "../shared/skillReviewStorage";
import type { SkillReviewSession } from "../shared/skillReviewTypes";
import type {
  ExtensionSettings,
  GeneratedSkills,
  LibraryListResult,
  LibraryRebuildZipResult,
  RuntimeRequest,
  RuntimeResponse,
  SkillReviewApplyResult,
  SkillReviewListResult
} from "../shared/types";
import { getProvider } from "./providers";
import { requestGeminiTextWithFallback, testGeminiApiKey } from "./gemini";
import { createReviewSession, improveReviewSession, runReviewSession, type ReviewTextGenerator } from "./skillReviewEngine";

interface SettingsStatus {
  hasKey: boolean;
  activeProvider: string;
  providers: Array<{
    id: string;
    hasKey: boolean;
  }>;
}

const consoleLogger = {
  log: (...args: unknown[]) => console.log(...args),
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args)
};

const UI_LAUNCH_CONTEXT_KEY = "uiLaunchContext";

const skillLibrary = createSkillLibrary({
  storage: {
    get(keys, callback) {
      chrome.storage.local.get(keys, (items) => callback((items || {}) as Record<string, unknown>));
    },
    set(items, callback) {
      chrome.storage.local.set(items, () => callback?.());
    },
    remove(keys, callback) {
      chrome.storage.local.remove(keys, () => callback?.());
    }
  },
  logger: consoleLogger
});

const skillReviewStorage = createSkillReviewStorage({
  storage: {
    get(keys, callback) {
      chrome.storage.local.get(keys, (items) => callback((items || {}) as Record<string, unknown>));
    },
    set(items, callback) {
      chrome.storage.local.set(items, () => callback?.());
    },
    remove(keys, callback) {
      chrome.storage.local.remove(keys, () => callback?.());
    }
  },
  logger: consoleLogger
});

chrome.runtime.onMessage.addListener((message: RuntimeRequest, sender, sendResponse) => {
  handleRuntimeMessage(message, sender)
    .then((data) => sendResponse({ ok: true, data } satisfies RuntimeResponse<unknown>))
    .catch((error: unknown) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "The extension could not complete that request."
      } satisfies RuntimeResponse<unknown>)
    );

  return true;
});

async function handleRuntimeMessage(
  message: RuntimeRequest,
  sender: chrome.runtime.MessageSender
): Promise<
  | GeneratedSkills
  | SettingsStatus
  | { transcript: string }
  | { ok: boolean; message: string; model: string }
  | LibraryListResult
  | SkillLibraryEntry
  | { ok: boolean }
  | LibraryRebuildZipResult
  | SkillLibraryConfig
  | SkillReviewSession
  | SkillReviewListResult
  | SkillReviewApplyResult
> {
  if (message.type === "GET_SETTINGS_STATUS") {
    const settings = await getSettings();
    return buildSettingsStatus(settings);
  }

  if (message.type === "OPEN_EXTENSION_UI") {
    await openExtensionUi(sender);
    return { ok: true };
  }

  if (message.type === "GENERATE_SKILLS") {
    const settings = await getSettings();
    if (!hasProviderKey(settings, settings.activeProvider)) {
      throw new Error(
        `Add an API key for the active provider in extension settings first. Active provider: ${settings.activeProvider}.`
      );
    }

    const providerSettings = getSettingsForProvider(settings, settings.activeProvider);
    const provider = getProvider(settings.activeProvider);

    const draft = await provider.generateDraft({
      apiKey: providerSettings.apiKey.trim(),
      model: providerSettings.model.trim() || provider.defaultModel,
      video: message.video,
      preferredSkillName: message.preferredSkillName
    });

    const generated = buildSkillPackages(draft, message.video);

    try {
      const skillNameHint =
        message.preferredSkillName && message.preferredSkillName.trim().length > 0
          ? message.preferredSkillName.trim()
          : undefined;
      const entryFiles: SkillLibraryEntryFiles = {
        codex: {
          skill: generated.codex.skillMd,
          reference: generated.codex.referenceMd,
          transcript: generated.codex.transcriptMd
        },
        claude: {
          skill: generated.claude.skillMd,
          reference: generated.claude.referenceMd,
          transcript: generated.claude.transcriptMd
        }
      };
      const modelId = `${settings.activeProvider}/${providerSettings.model.trim() || provider.defaultModel}`;
      await skillLibrary.addEntry({
        videoUrl: generated.sourceVideo.url,
        videoTitle: generated.sourceVideo.title,
        channelName: generated.sourceVideo.channel,
        skillName: generated.draft.skillName,
        displayName: generated.draft.displayName,
        model: modelId,
        files: entryFiles,
        transcript: generated.sourceVideo.transcript,
        generatedVia: "extension",
        ...(skillNameHint ? { skillNameHint } : {})
      });
    } catch (err) {
      consoleLogger.warn("[background] Failed to persist generated skill to library:", err);
    }

    return generated;
  }

  if (message.type === "FETCH_CAPTION_URL") {
    const url = (message as unknown as { url: string }).url;
    console.log(`[background] Fetching caption URL: ${url}`);
    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.log(`[background] Caption URL returned ${response.status}`);
        return { transcript: "" };
      }
      const text = await response.text();
      console.log(`[background] Caption URL returned ${text.length} chars`);
      return { transcript: text };
    } catch (err) {
      console.error(`[background] Caption URL fetch failed:`, err);
      return { transcript: "" };
    }
  }

  if (message.type === "TEST_API_KEY") {
    const apiKey = (message as unknown as { apiKey: string }).apiKey;
    console.log(`[background] Testing API key...`);
    const result = await testGeminiApiKey(apiKey);
    console.log(`[background] Test result: ${result.ok ? "OK" : "FAIL"} - ${result.message}`);
    return result;
  }

  if (message.type === "LIBRARY_LIST") {
    const [entries, config] = await Promise.all([skillLibrary.listEntries(), getLibraryConfig()]);
    return { entries, config };
  }

  if (message.type === "LIBRARY_GET") {
    const entry = await skillLibrary.getEntry(message.id);
    if (!entry) {
      throw new Error("That skill is no longer in the library.");
    }
    return entry;
  }

  if (message.type === "LIBRARY_DELETE") {
    const ok = await skillLibrary.deleteEntry(message.id);
    if (ok) {
      await skillReviewStorage.deleteSessionsForEntry(message.id);
    }
    return { ok };
  }

  if (message.type === "LIBRARY_REBUILD_ZIP") {
    const entry = await skillLibrary.getEntry(message.id);
    if (!entry) {
      throw new Error("That skill is no longer in the library.");
    }
    const files = message.kind === "codex" ? entry.files.codex : entry.files.claude;
    const fileName = `${entry.skillName}-${message.kind}.zip`;
    if (message.kind === "codex" && entry.codexZip) {
      return { base64: entry.codexZip, fileName, cached: true };
    }
    if (message.kind === "claude" && entry.claudeZip) {
      return { base64: entry.claudeZip, fileName, cached: true };
    }
    const base64 = await buildLibraryZipBase64(entry.skillName, files);
    try {
      await skillLibrary.setZip(entry.id, message.kind, base64);
    } catch (err) {
      consoleLogger.warn("[background] Failed to cache rebuilt ZIP:", err);
    }
    return { base64, fileName, cached: false };
  }

  if (message.type === "LIBRARY_SET_ZIP") {
    const updated = await skillLibrary.setZip(message.id, message.kind, message.base64);
    if (!updated) {
      throw new Error("That skill is no longer in the library.");
    }
    return updated;
  }

  if (message.type === "LIBRARY_GET_CONFIG") {
    return getLibraryConfig();
  }

  if (message.type === "LIBRARY_SET_SOFT_CAP") {
    return skillLibrary.setSoftCap(message.softCap);
  }

  if (message.type === "LIBRARY_RESAVE") {
    const existing = await skillLibrary.getEntry(message.id);
    if (!existing) {
      throw new Error("That skill is no longer in the library.");
    }
    const updated = await skillLibrary.updateEntry(message.id, {
      files: message.files,
      skillName: message.skillName,
      displayName: message.displayName,
      codexZip: "",
      claudeZip: "",
      ...(message.skillNameHint !== undefined ? { skillNameHint: message.skillNameHint } : {})
    });
    if (!updated) {
      throw new Error("Could not update the library entry.");
    }
    return updated;
  }

  if (message.type === "SKILL_REVIEW_LIST") {
    return { sessions: await skillReviewStorage.listSessions(message.entryId) };
  }

  if (message.type === "SKILL_REVIEW_CREATE") {
    const entry = await getLibraryEntryOrThrow(message.entryId);
    const session = await createReviewSession(entry, message.kind || "codex", {
      generateText: await buildReviewTextGenerator()
    });
    await skillReviewStorage.upsertSession(session);
    return session;
  }

  if (message.type === "SKILL_REVIEW_STEP") {
    const session = await getReviewSessionOrThrow(message.sessionId);
    const entry = await getLibraryEntryOrThrow(session.entryId);
    const running: SkillReviewSession = { ...session, status: "running", updatedAt: new Date().toISOString() };
    await skillReviewStorage.upsertSession(running);
    try {
      const updated = await runReviewSession(running, entry, {
        generateText: await buildReviewTextGenerator()
      });
      await skillReviewStorage.upsertSession(updated);
      return updated;
    } catch (error) {
      await skillReviewStorage.upsertSession({
        ...running,
        status: "failed",
        updatedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "The review run failed."
      });
      throw error;
    }
  }

  if (message.type === "SKILL_REVIEW_SAVE_FEEDBACK") {
    const session = await getReviewSessionOrThrow(message.sessionId);
    const updated: SkillReviewSession = {
      ...session,
      feedback: { ...session.feedback, [message.evalCaseId]: message.feedback },
      updatedAt: new Date().toISOString()
    };
    await skillReviewStorage.upsertSession(updated);
    return updated;
  }

  if (message.type === "SKILL_REVIEW_IMPROVE") {
    const session = await getReviewSessionOrThrow(message.sessionId);
    const entry = await getLibraryEntryOrThrow(session.entryId);
    const improving: SkillReviewSession = { ...session, status: "improving", updatedAt: new Date().toISOString() };
    await skillReviewStorage.upsertSession(improving);
    try {
      const updated = await improveReviewSession(improving, entry, {
        generateText: await buildReviewTextGenerator()
      });
      await skillReviewStorage.upsertSession(updated);
      return updated;
    } catch (error) {
      await skillReviewStorage.upsertSession({
        ...improving,
        status: "failed",
        updatedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "The improvement step failed."
      });
      throw error;
    }
  }

  if (message.type === "SKILL_REVIEW_APPLY_IMPROVEMENT") {
    const session = await getReviewSessionOrThrow(message.sessionId);
    if (!session.improvement?.proposedSkillMd) {
      throw new Error("This review session does not have an improvement to apply yet.");
    }
    const entry = await getLibraryEntryOrThrow(session.entryId);
    const files =
      session.kind === "codex"
        ? {
            ...entry.files,
            codex: { ...entry.files.codex, skill: session.improvement.proposedSkillMd }
          }
        : {
            ...entry.files,
            claude: { ...entry.files.claude, skill: session.improvement.proposedSkillMd }
          };
    const updatedEntry = await skillLibrary.updateEntry(entry.id, {
      files,
      ...(session.kind === "codex" ? { codexZip: "" } : { claudeZip: "" })
    });
    if (!updatedEntry) {
      throw new Error("Could not apply the improved skill.");
    }
    const updatedSession: SkillReviewSession = {
      ...session,
      status: "applied",
      updatedAt: new Date().toISOString()
    };
    await skillReviewStorage.upsertSession(updatedSession);
    return { entry: updatedEntry, session: updatedSession };
  }

  throw new Error("Unsupported extension request.");
}

async function getLibraryEntryOrThrow(id: string): Promise<SkillLibraryEntry> {
  const entry = await skillLibrary.getEntry(id);
  if (!entry) {
    throw new Error("That skill is no longer in the library.");
  }
  return entry;
}

async function getReviewSessionOrThrow(id: string): Promise<SkillReviewSession> {
  const session = await skillReviewStorage.getSession(id);
  if (!session) {
    throw new Error("That review session is no longer available.");
  }
  return session;
}

async function buildReviewTextGenerator(): Promise<ReviewTextGenerator> {
  const settings = await getSettings();
  if (!hasProviderKey(settings, settings.activeProvider)) {
    throw new Error(
      `Add an API key for the active provider in extension settings first. Active provider: ${settings.activeProvider}.`
    );
  }
  const providerSettings = getSettingsForProvider(settings, settings.activeProvider);
  const provider = getProvider(settings.activeProvider);
  return (prompt, options) =>
    requestGeminiTextWithFallback({
      apiKey: providerSettings.apiKey.trim(),
      model: providerSettings.model.trim() || provider.defaultModel,
      prompt,
      temperature: options?.temperature,
      responseMimeType: options?.json ? "application/json" : undefined
    });
}

async function openExtensionUi(sender: chrome.runtime.MessageSender): Promise<void> {
  if (sender.tab?.id !== undefined) {
    await chrome.storage.local.set({
      [UI_LAUNCH_CONTEXT_KEY]: {
        tabId: sender.tab.id,
        url: sender.tab.url || "",
        savedAt: Date.now()
      }
    });
  }

  try {
    await chrome.action.openPopup();
    return;
  } catch (error) {
    consoleLogger.warn("[background] Could not open action popup, falling back to popup window:", error);
  }

  await chrome.windows.create({
    url: chrome.runtime.getURL("popup.html"),
    type: "popup",
    width: 480,
    height: 720
  });
}

function buildSettingsStatus(settings: ExtensionSettings): SettingsStatus {
  return {
    hasKey: hasProviderKey(settings, settings.activeProvider),
    activeProvider: settings.activeProvider,
    providers: [
      { id: "gemini", hasKey: hasProviderKey(settings, "gemini") }
    ]
  };
}

function getSettings(): Promise<ExtensionSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (items) => {
      resolve(readStoredSettings((items || {}) as Record<string, unknown>));
    });
  });
}

function getLibraryConfig(): Promise<SkillLibraryConfig> {
  return new Promise((resolve) => {
    chrome.storage.local.get(SKILL_LIBRARY_CONFIG_KEY, (items) => {
      const raw = (items || {})[SKILL_LIBRARY_CONFIG_KEY] as unknown;
      if (!raw || typeof raw !== "object") {
        resolve({ ...DEFAULT_SKILL_LIBRARY_CONFIG });
        return;
      }
      const cap = (raw as { softCap?: unknown }).softCap;
      if (typeof cap !== "number" || !Number.isFinite(cap)) {
        resolve({ ...DEFAULT_SKILL_LIBRARY_CONFIG });
        return;
      }
      resolve({ softCap: Math.max(1, Math.floor(cap)) });
    });
  });
}

async function buildLibraryZipBase64(
  skillName: string,
  files: { skill: string; reference: string; transcript: string }
): Promise<string> {
  const zip = new JSZip();
  zip.file(`${skillName}/SKILL.md`, files.skill);
  zip.file(`${skillName}/references/video-summary.md`, files.reference);
  zip.file(`${skillName}/references/full-transcript.md`, files.transcript);
  return zip.generateAsync({ type: "base64" });
}
