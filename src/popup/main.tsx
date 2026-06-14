import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { packageFilesToMap, buildZipBase64 } from "../shared/zip";
import { getPackageFiles } from "../shared/skillFormat";
import { buildSkillPrompt, trimTranscriptWithMarker } from "../shared/skillPromptBuilder";
import { DEFAULT_SETTINGS } from "../shared/settings";
import { getProviderInfo, type ProviderId } from "../shared/providers";
import { BrandMark } from "../shared/branding";
import {
  formatRelativeTime,
  type SkillLibraryEntry
} from "../shared/skillLibrary";
import {
  MAX_SKILL_LIBRARY_SOFT_CAP,
  MIN_SKILL_LIBRARY_SOFT_CAP
} from "../shared/skillLibraryTypes";
import { SKILL_REVIEW_LAUNCH_KEY } from "../shared/skillReviewTypes";
import type {
  ContentRequest,
  GeneratedSkills,
  LibraryListResult,
  LibraryRebuildZipResult,
  RuntimeRequest,
  RuntimeResponse,
  VideoContext
} from "../shared/types";
import { downloadZipFile } from "./zip";

type Stage = "idle" | "capturing" | "generating" | "ready";
type EditorTab = "codex-skill" | "codex-reference" | "claude-skill" | "claude-reference";
type ClipboardStatus = "idle" | "copied" | "error";
type HistoryView =
  | { kind: "closed" }
  | { kind: "list" }
  | { kind: "view"; entry: SkillLibraryEntry; tab: EditorTab };

interface EditablePackages {
  skillName: string;
  codexSkillMd: string;
  codexReferenceMd: string;
  claudeSkillMd: string;
  claudeReferenceMd: string;
}

interface SettingsStatus {
  hasKey: boolean;
  activeProvider: string;
  providers: Array<{ id: string; hasKey: boolean }>;
}

const FIRST_COPY_KEY = "promptBuilder.firstCopyShown";

function App() {
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [activeProvider, setActiveProvider] = useState<ProviderId>("gemini");
  const [activeTabUrl, setActiveTabUrl] = useState("");
  const [video, setVideo] = useState<VideoContext | null>(null);
  const [generated, setGenerated] = useState<GeneratedSkills | null>(null);
  const [editable, setEditable] = useState<EditablePackages | null>(null);
  const [editorTab, setEditorTab] = useState<EditorTab>("codex-skill");
  const [libraryEntryId, setLibraryEntryId] = useState<string>("");
  const [preferredName, setPreferredName] = useState("");
  const [providersWithKey, setProvidersWithKey] = useState<Set<ProviderId>>(new Set());
  const [savedToast, setSavedToast] = useState<string>("");
  const [historyEntries, setHistoryEntries] = useState<SkillLibraryEntry[]>([]);
  const [historyConfig, setHistoryConfig] = useState<{ softCap: number }>({ softCap: MAX_SKILL_LIBRARY_SOFT_CAP });
  const [historyView, setHistoryView] = useState<HistoryView>({ kind: "closed" });
  const [historyError, setHistoryError] = useState("");
  const [historyBusy, setHistoryBusy] = useState(false);
  const [clipboardStatus, setClipboardStatus] = useState<ClipboardStatus>("idle");
  const [clipboardModal, setClipboardModal] = useState<string | null>(null);
  const [copyTipVisible, setCopyTipVisible] = useState(false);
  const [longTranscriptNotice, setLongTranscriptNotice] = useState(false);

  useEffect(() => {
    void refreshEnvironment();
    void refreshHistory();
    void loadFirstCopyFlag();
  }, []);

  useEffect(() => {
    if (!savedToast) {
      return;
    }
    const handle = window.setTimeout(() => setSavedToast(""), 3500);
    return () => window.clearTimeout(handle);
  }, [savedToast]);

  useEffect(() => {
    if (clipboardStatus === "idle") {
      return;
    }
    const handle = window.setTimeout(() => setClipboardStatus("idle"), 3000);
    return () => window.clearTimeout(handle);
  }, [clipboardStatus]);

  useEffect(() => {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local") return;
      if (changes[SKILL_LIBRARY_KEY] || changes[SKILL_LIBRARY_CONFIG_KEY]) {
        void refreshHistory();
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  const isBusy = stage === "capturing" || stage === "generating";
  const canGenerate = !isBusy && hasKey;
  const activeEditorValue = useMemo(() => {
    if (!editable) {
      return "";
    }
    return {
      "codex-skill": editable.codexSkillMd,
      "codex-reference": editable.codexReferenceMd,
      "claude-skill": editable.claudeSkillMd,
      "claude-reference": editable.claudeReferenceMd
    }[editorTab];
  }, [editable, editorTab]);

  async function refreshEnvironment() {
    setError("");
    const [settingsStatus, tab] = await Promise.all([
      sendRuntime<SettingsStatus>({ type: "GET_SETTINGS_STATUS" }),
      getActiveTab()
    ]);
    setHasKey(settingsStatus.hasKey);
    setActiveProvider((settingsStatus.activeProvider as ProviderId) || "gemini");
    setProvidersWithKey(new Set(settingsStatus.providers.filter((p) => p.hasKey).map((p) => p.id as ProviderId)));
    setActiveTabUrl(tab.url || "");
  }

  async function refreshHistory() {
    try {
      const result = await sendRuntime<LibraryListResult>({ type: "LIBRARY_LIST" });
      setHistoryEntries(result.entries);
      setHistoryConfig(result.config);
      setHistoryError("");
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "Could not load the library.");
    }
  }

  function loadFirstCopyFlag() {
    chrome.storage.local.get(FIRST_COPY_KEY, (items) => {
      if (items && items[FIRST_COPY_KEY] === true) {
        return;
      }
      setCopyTipVisible(true);
    });
  }

  function markFirstCopyShown() {
    chrome.storage.local.set({ [FIRST_COPY_KEY]: true });
    setCopyTipVisible(false);
  }

  async function captureTranscriptFromActiveTab(): Promise<VideoContext> {
    const tab = await getActiveTab();
    if (!tab.id || !isYouTubeVideoUrl(tab.url || "")) {
      throw new Error("Open a YouTube video with captions, then click Make Skill.");
    }
    return sendTabMessage<VideoContext>(tab.id, { type: "GET_YOUTUBE_CONTEXT" });
  }

  async function makeSkill() {
    setError("");
    setGenerated(null);
    setEditable(null);
    setLibraryEntryId("");

    try {
      setStage("capturing");
      const captured = await captureTranscriptFromActiveTab();
      setVideo(captured);

      setStage("generating");
      const result = await sendRuntime<GeneratedSkills>({
        type: "GENERATE_SKILLS",
        video: captured,
        preferredSkillName: preferredName
      });

      setGenerated(result);
      setEditable({
        skillName: result.draft.skillName,
        codexSkillMd: result.codex.skillMd,
        codexReferenceMd: result.codex.referenceMd,
        claudeSkillMd: result.claude.skillMd,
        claudeReferenceMd: result.claude.referenceMd
      });
      setEditorTab("codex-skill");
      setStage("ready");
      setSavedToast("Saved to library.");
      void refreshHistory().then(() => {
        // After refresh, the first entry is the just-saved one.
        setHistoryEntries((current) => {
          if (current.length > 0) {
            setLibraryEntryId(current[0].id);
          }
          return current;
        });
      });
    } catch (caught) {
      setStage("idle");
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    }
  }

  async function copySkillPrompt() {
    setError("");
    setLongTranscriptNotice(false);
    try {
      const captured = video || (await captureTranscriptFromActiveTab());
      setVideo(captured);
      const trim = trimTranscriptWithMarker(captured.transcript, 90000);
      if (trim.trimmed) {
        setLongTranscriptNotice(true);
      }
      const prompt = buildSkillPrompt(captured, { preferredSkillName: preferredName });
      await writeToClipboard(prompt);
      setClipboardStatus("copied");
      if (copyTipVisible) {
        markFirstCopyShown();
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not copy the prompt.";
      setError(message);
      setClipboardStatus("error");
    }
  }

  async function writeToClipboard(text: string): Promise<void> {
    if (navigator?.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (err) {
        console.warn("navigator.clipboard.writeText failed, falling back:", err);
      }
    }
    setClipboardModal(text);
    throw new Error("Clipboard access blocked. Use the copy dialog.");
  }

  function copyFromFallback() {
    if (!clipboardModal) return;
    const ta = document.getElementById("clipboard-fallback-textarea") as HTMLTextAreaElement | null;
    if (ta) {
      ta.select();
    }
  }

  function dismissClipboardModal() {
    setClipboardModal(null);
  }

  function updateEditorValue(value: string) {
    if (!editable) {
      return;
    }
    const next = { ...editable };
    if (editorTab === "codex-skill") next.codexSkillMd = value;
    if (editorTab === "codex-reference") next.codexReferenceMd = value;
    if (editorTab === "claude-skill") next.claudeSkillMd = value;
    if (editorTab === "claude-reference") next.claudeReferenceMd = value;
    setEditable(next);
  }

  async function download(kind: "codex" | "claude") {
    if (!editable || !generated) {
      return;
    }
    const pkg =
      kind === "codex"
        ? {
            skillName: editable.skillName,
            skillMd: editable.codexSkillMd,
            referenceMd: editable.codexReferenceMd,
            transcriptMd: generated.codex.transcriptMd
          }
        : {
            skillName: editable.skillName,
            skillMd: editable.claudeSkillMd,
            referenceMd: editable.claudeReferenceMd,
            transcriptMd: generated.claude.transcriptMd
          };

    await downloadZipFile({
      fileName: `${editable.skillName}-${kind}.zip`,
      files: getPackageFiles(pkg)
    });

    try {
      if (libraryEntryId) {
        const base64 = await buildBase64FromMap(getPackageFiles(pkg));
        await sendRuntime({ type: "LIBRARY_SET_ZIP", id: libraryEntryId, kind, base64 });
      }
    } catch (err) {
      console.warn("Could not cache ZIP in library:", err);
    }
  }

  function openHistoryList() {
    setHistoryView({ kind: "list" });
    void refreshHistory();
  }

  function closeHistory() {
    setHistoryView({ kind: "closed" });
  }

  function viewEntry(entry: SkillLibraryEntry) {
    setHistoryView({ kind: "view", entry, tab: "codex-skill" });
  }

  async function downloadHistoryEntry(entry: SkillLibraryEntry, kind: "codex" | "claude") {
    setHistoryBusy(true);
    setHistoryError("");
    try {
      const result = await sendRuntime<LibraryRebuildZipResult>({
        type: "LIBRARY_REBUILD_ZIP",
        id: entry.id,
        kind
      });
      await downloadBase64Zip(result.base64, result.fileName);
    } catch (caught) {
      setHistoryError(caught instanceof Error ? caught.message : "Could not rebuild ZIP.");
    } finally {
      setHistoryBusy(false);
    }
  }

  async function copyHistoryUrl(entry: SkillLibraryEntry) {
    try {
      await navigator.clipboard.writeText(entry.videoUrl);
    } catch (caught) {
      setHistoryError(caught instanceof Error ? caught.message : "Could not copy URL.");
    }
  }

  async function deleteHistoryEntry(entry: SkillLibraryEntry) {
    if (!window.confirm(`Delete "${entry.skillName}" from the library?`)) {
      return;
    }
    setHistoryBusy(true);
    setHistoryError("");
    try {
      await sendRuntime({ type: "LIBRARY_DELETE", id: entry.id });
      await refreshHistory();
      if (historyView.kind === "view" && historyView.entry.id === entry.id) {
        setHistoryView({ kind: "list" });
      }
    } catch (caught) {
      setHistoryError(caught instanceof Error ? caught.message : "Could not delete entry.");
    } finally {
      setHistoryBusy(false);
    }
  }

  async function openReview(entryId: string) {
    if (!entryId) {
      setError("Save this skill to the library before reviewing it.");
      return;
    }
    await chrome.storage.local.set({ [SKILL_REVIEW_LAUNCH_KEY]: { entryId, savedAt: Date.now() } });
    chrome.runtime.openOptionsPage();
  }

  async function regenerateFromEntry(entry: SkillLibraryEntry) {
    setError("");
    setStage("capturing");
    try {
      const videoContext: VideoContext = {
        videoId: extractVideoId(entry.videoUrl) || entry.id,
        url: entry.videoUrl,
        title: entry.videoTitle,
        channel: entry.channelName,
        transcript: entry.transcript,
        transcriptSource: "library",
        captionLanguage: undefined,
        capturedAt: new Date().toISOString()
      };
      setVideo(videoContext);
      setStage("generating");
      const result = await sendRuntime<GeneratedSkills>({
        type: "GENERATE_SKILLS",
        video: videoContext,
        preferredSkillName: entry.skillNameHint
      });
      setGenerated(result);
      setEditable({
        skillName: result.draft.skillName,
        codexSkillMd: result.codex.skillMd,
        codexReferenceMd: result.codex.referenceMd,
        claudeSkillMd: result.claude.skillMd,
        claudeReferenceMd: result.claude.referenceMd
      });
      setEditorTab("codex-skill");
      setStage("ready");
      setHistoryView({ kind: "closed" });
      setSavedToast("Regenerated. Saved to library.");
      void refreshHistory().then(() => {
        setHistoryEntries((current) => {
          if (current.length > 0) {
            setLibraryEntryId(current[0].id);
          }
          return current;
        });
      });
    } catch (caught) {
      setStage("idle");
      setError(caught instanceof Error ? caught.message : "Could not regenerate skill.");
    }
  }

  function resaveFromEditor() {
    if (!editable || !generated) return;
    if (!libraryEntryId) {
      setError("No library entry to update. Generate a skill first.");
      return;
    }
    void sendRuntime({
      type: "LIBRARY_RESAVE",
      id: libraryEntryId,
      files: {
        codex: {
          skill: editable.codexSkillMd,
          reference: editable.codexReferenceMd,
          transcript: generated.codex.transcriptMd
        },
        claude: {
          skill: editable.claudeSkillMd,
          reference: editable.claudeReferenceMd,
          transcript: generated.claude.transcriptMd
        }
      },
      skillName: editable.skillName,
      displayName: editable.skillName,
      ...(preferredName ? { skillNameHint: preferredName } : {})
    }).then(() => {
      setSavedToast("Library entry updated.");
      void refreshHistory();
    });
  }

  return (
    <section className="app-shell">
      <header className="topbar">
        <div className="brand-row">
          <BrandMark size={56} />
          <div className="brand-copy">
            <h1>SkillSnap</h1>
            <p className="muted">Generate editable Codex and Claude skill ZIPs from captions.</p>
          </div>
        </div>
        <div className="button-row">
          <button type="button" className="ghost" onClick={openHistoryList}>
            History
          </button>
          <button type="button" className="ghost" onClick={() => chrome.runtime.openOptionsPage()}>
            Settings
          </button>
        </div>
      </header>

      <div className="warning">
        API keys are stored in Chrome local extension storage. This is fine for a personal MVP; restrict the key before sharing the extension.
      </div>

      <p className="muted">
        Active provider: <strong>{getProviderInfo(activeProvider).displayName}</strong>
        {providersWithKey.size > 0 && (
          <>
            {" · "}Configured:{" "}
            {Array.from(providersWithKey)
              .map((id) => getProviderInfo(id).displayName)
              .join(", ")}
          </>
        )}
      </p>

      {savedToast && <div className="success">{savedToast}</div>}
      {clipboardStatus === "copied" && (
        <div className="success">Prompt copied! Paste it into Claude Code or Codex.</div>
      )}
      {longTranscriptNotice && (
        <div className="warning">Long transcript — middle trimmed to fit context windows.</div>
      )}

      {!hasKey && (
        <div className="error" role="alert">
          Add an API key for the active provider (<strong>{getProviderInfo(activeProvider).displayName}</strong>) in Settings before generating a skill.
        </div>
      )}

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      <section className="panel stack prompt-panel">
        <div className="row-between">
          <div>
            <h2>Current Video</h2>
            <p className="muted">{isYouTubeVideoUrl(activeTabUrl) ? "Ready to read captions." : "Open a YouTube video first."}</p>
          </div>
          <button type="button" onClick={refreshEnvironment} disabled={isBusy}>
            Refresh
          </button>
        </div>

        {video && (
          <div>
            <p className="video-title">{video.title}</p>
            <p className="muted">
              {video.channel} · {video.captionLanguage || "captions"} · {video.transcript.length.toLocaleString()} chars
            </p>
          </div>
        )}

        <label>
          Skill name hint
          <input
            type="text"
            value={preferredName}
            placeholder="optional, for example: react-performance-audit"
            onChange={(event) => setPreferredName(event.target.value)}
            disabled={isBusy}
          />
        </label>

        <div className="button-row">
          <button type="button" className="primary" onClick={makeSkill} disabled={!canGenerate}>
            {stage === "capturing" ? "Reading captions..." : stage === "generating" ? "Generating..." : "Make Skill"}
          </button>
          <button type="button" onClick={copySkillPrompt} disabled={isBusy}>
            Copy Skill Prompt
          </button>
        </div>

        {copyTipVisible && (
          <div className="muted">
            Tip: paste this into Claude Code or Codex to generate the skill — no API key needed.
          </div>
        )}

        <details>
          <summary className="muted">What does "Copy Skill Prompt" do?</summary>
          <p className="muted">
            It copies a self-contained prompt with the video transcript and metadata already inlined. Paste it into Claude Code or Codex, and your CLI will produce the skill JSON you can drop into your skills folder.
          </p>
        </details>

        {isBusy && <div className="progress" aria-label="Working" />}
      </section>

      {editable && (
        <section className="panel stack editor-panel">
          <div className="row-between">
            <div>
              <h2>Preview And Edit</h2>
              <p className="muted">{editable.skillName}</p>
            </div>
            <div className="button-row">
              <button type="button" onClick={() => download("codex")}>
                Download Codex
              </button>
              <button type="button" onClick={() => download("claude")}>
                Download Claude
              </button>
              <button type="button" onClick={resaveFromEditor}>
                Save to library
              </button>
              <button type="button" onClick={() => void openReview(libraryEntryId)} disabled={!libraryEntryId}>
                Review & Improve
              </button>
            </div>
          </div>

          <div className="button-row" role="tablist" aria-label="Skill files">
            <TabButton id="codex-skill" active={editorTab} setActive={setEditorTab}>
              Codex SKILL.md
            </TabButton>
            <TabButton id="codex-reference" active={editorTab} setActive={setEditorTab}>
              Codex Notes
            </TabButton>
            <TabButton id="claude-skill" active={editorTab} setActive={setEditorTab}>
              Claude SKILL.md
            </TabButton>
            <TabButton id="claude-reference" active={editorTab} setActive={setEditorTab}>
              Claude Notes
            </TabButton>
          </div>

          <textarea value={activeEditorValue} onChange={(event) => updateEditorValue(event.target.value)} spellCheck={false} />
        </section>
      )}

      {historyView.kind === "list" && (
        <HistoryList
          entries={historyEntries}
          config={historyConfig}
          error={historyError}
          busy={historyBusy}
          onClose={closeHistory}
          onView={viewEntry}
          onDownload={downloadHistoryEntry}
          onCopyUrl={copyHistoryUrl}
          onDelete={deleteHistoryEntry}
          onRegenerate={regenerateFromEntry}
          onReview={(entry) => void openReview(entry.id)}
        />
      )}

      {historyView.kind === "view" && (
        <HistoryView
          entry={historyView.entry}
          tab={historyView.tab}
          setTab={(tab) => setHistoryView({ kind: "view", entry: historyView.entry, tab })}
          onClose={() => setHistoryView({ kind: "list" })}
        />
      )}

      {clipboardModal !== null && (
        <ClipboardModal text={clipboardModal} onCopy={copyFromFallback} onClose={dismissClipboardModal} />
      )}
    </section>
  );
}

function HistoryList(props: {
  entries: SkillLibraryEntry[];
  config: { softCap: number };
  error: string;
  busy: boolean;
  onClose: () => void;
  onView: (entry: SkillLibraryEntry) => void;
  onDownload: (entry: SkillLibraryEntry, kind: "codex" | "claude") => void;
  onCopyUrl: (entry: SkillLibraryEntry) => void;
  onDelete: (entry: SkillLibraryEntry) => void;
  onRegenerate: (entry: SkillLibraryEntry) => void;
  onReview: (entry: SkillLibraryEntry) => void;
}) {
  return (
    <section className="panel stack" aria-label="Skill library">
      <div className="row-between">
        <div>
          <h2>Skill Library</h2>
          <p className="muted">
            {props.entries.length} of {props.config.softCap} entries
          </p>
        </div>
        <button type="button" onClick={props.onClose}>
          Close
        </button>
      </div>

      {props.error && <div className="error" role="alert">{props.error}</div>}

      {props.entries.length === 0 ? (
        <p className="muted">No skills yet. Generate your first skill to populate the library.</p>
      ) : (
        <ul className="library-list">
          {props.entries.map((entry) => (
            <li key={entry.id} className="library-row">
              <div className="library-row-main">
                <p className="library-title">{entry.videoTitle}</p>
                <p className="muted">
                  {entry.channelName} · {entry.skillName} · {formatRelativeTime(entry.createdAt)} · {entry.model}
                </p>
              </div>
              <div className="button-row">
                <button type="button" disabled={props.busy} onClick={() => props.onDownload(entry, "codex")}>
                  ⬇ Codex
                </button>
                <button type="button" disabled={props.busy} onClick={() => props.onDownload(entry, "claude")}>
                  ⬇ Claude
                </button>
                <button type="button" onClick={() => props.onView(entry)}>
                  View
                </button>
                <button type="button" onClick={() => props.onCopyUrl(entry)}>
                  Copy URL
                </button>
                <button type="button" onClick={() => props.onRegenerate(entry)}>
                  Regenerate
                </button>
                <button type="button" onClick={() => props.onReview(entry)}>
                  Review
                </button>
                <button type="button" className="danger" onClick={() => props.onDelete(entry)} disabled={props.busy}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="muted">
        Cap: {props.config.softCap}. Change in Settings → Skill Library.
      </p>
    </section>
  );
}

function HistoryView(props: {
  entry: SkillLibraryEntry;
  tab: EditorTab;
  setTab: (tab: EditorTab) => void;
  onClose: () => void;
}) {
  const value = useMemo(() => {
    const e = props.entry;
    if (props.tab === "codex-skill") return e.files.codex.skill;
    if (props.tab === "codex-reference") return e.files.codex.reference;
    if (props.tab === "claude-skill") return e.files.claude.skill;
    return e.files.claude.reference;
  }, [props.entry, props.tab]);

  return (
    <section className="panel stack" aria-label="Library entry preview">
      <div className="row-between">
        <div>
          <h2>{props.entry.videoTitle}</h2>
          <p className="muted">
            {props.entry.skillName} · {formatRelativeTime(props.entry.createdAt)}
          </p>
        </div>
        <button type="button" onClick={props.onClose}>
          Back
        </button>
      </div>

      <div className="button-row" role="tablist" aria-label="Skill files">
        <TabButton id="codex-skill" active={props.tab} setActive={props.setTab}>
          Codex SKILL.md
        </TabButton>
        <TabButton id="codex-reference" active={props.tab} setActive={props.setTab}>
          Codex Notes
        </TabButton>
        <TabButton id="claude-skill" active={props.tab} setActive={props.setTab}>
          Claude SKILL.md
        </TabButton>
        <TabButton id="claude-reference" active={props.tab} setActive={props.setTab}>
          Claude Notes
        </TabButton>
      </div>

      <textarea value={value} readOnly spellCheck={false} />
    </section>
  );
}

function ClipboardModal(props: { text: string; onCopy: () => void; onClose: () => void }) {
  useEffect(() => {
    const handle = window.setTimeout(() => props.onCopy(), 50);
    return () => window.clearTimeout(handle);
  }, [props.text]);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Copy this prompt">
      <div className="modal">
        <h2>Copy this prompt</h2>
        <p className="muted">Clipboard access was blocked. Press Cmd/Ctrl-C to copy the prompt below.</p>
        <textarea
          id="clipboard-fallback-textarea"
          value={props.text}
          readOnly
          onFocus={(event) => event.currentTarget.select()}
        />
        <div className="button-row">
          <button type="button" onClick={props.onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function TabButton(props: {
  id: EditorTab;
  active: EditorTab;
  setActive: (tab: EditorTab) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={props.id === props.active ? "tab active" : "tab"}
      onClick={() => props.setActive(props.id)}
      role="tab"
      aria-selected={props.id === props.active}
    >
      {props.children}
    </button>
  );
}

const SKILL_LIBRARY_KEY = "skillLibrary.v1";
const SKILL_LIBRARY_CONFIG_KEY = "skillLibrary.config";
const UI_LAUNCH_CONTEXT_KEY = "uiLaunchContext";

interface UiLaunchContext {
  tabId?: number;
  url?: string;
  savedAt?: number;
}

function extractVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith("youtube.com") && parsed.pathname === "/watch") {
      return parsed.searchParams.get("v");
    }
    if (parsed.pathname.startsWith("/shorts/")) {
      return parsed.pathname.split("/")[2] || null;
    }
  } catch {
    return null;
  }
  return null;
}

async function buildBase64FromMap(files: Record<string, string>): Promise<string> {
  return buildZipBase64(files);
}

async function downloadBase64Zip(base64: string, fileName: string): Promise<void> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function getActiveTab(): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab && isYouTubeVideoUrl(tab.url || "")) {
        resolve(tab);
        return;
      }

      getLaunchSourceTab()
        .then((sourceTab) => {
          if (sourceTab) {
            resolve(sourceTab);
            return;
          }
          if (tab) {
            resolve(tab);
            return;
          }
          reject(new Error("No active tab found."));
        })
        .catch(() => {
          if (tab) {
            resolve(tab);
            return;
          }
          reject(new Error("No active tab found."));
        });
    });
  });
}

async function getLaunchSourceTab(): Promise<chrome.tabs.Tab | null> {
  const context = await getStoredLaunchContext();
  const isFresh = context.savedAt !== undefined && Date.now() - context.savedAt < 5 * 60 * 1000;
  if (!context.tabId || !isFresh) {
    return null;
  }

  return new Promise((resolve) => {
    chrome.tabs.get(context.tabId as number, (tab) => {
      if (chrome.runtime.lastError || !tab || !isYouTubeVideoUrl(tab.url || context.url || "")) {
        resolve(null);
        return;
      }
      resolve(tab);
    });
  });
}

function getStoredLaunchContext(): Promise<UiLaunchContext> {
  return new Promise((resolve) => {
    chrome.storage.local.get(UI_LAUNCH_CONTEXT_KEY, (items) => {
      resolve((items?.[UI_LAUNCH_CONTEXT_KEY] as UiLaunchContext | undefined) || {});
    });
  });
}

function sendRuntime<T>(message: RuntimeRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: RuntimeResponse<T> | undefined) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      if (!response) {
        reject(new Error("The extension did not return a response."));
        return;
      }
      if (!response.ok) {
        reject(new Error(response.error));
        return;
      }
      resolve(response.data);
    });
  });
}

function sendTabMessage<T>(tabId: number, message: ContentRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response: RuntimeResponse<T> | undefined) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error("Refresh the YouTube tab, then try again."));
        return;
      }
      if (!response) {
        reject(new Error("The YouTube page did not respond."));
        return;
      }
      if (!response.ok) {
        reject(new Error(response.error));
        return;
      }
      resolve(response.data);
    });
  });
}

function isYouTubeVideoUrl(url: string): boolean {
  if (!url) {
    return false;
  }
  try {
    const parsed = new URL(url);
    return (
      /(^|\.)youtube\.com$/.test(parsed.hostname) &&
      (parsed.pathname === "/watch" || parsed.pathname.startsWith("/shorts/"))
    );
  } catch {
    return false;
  }
}

void packageFilesToMap;
void DEFAULT_SETTINGS;
void MIN_SKILL_LIBRARY_SOFT_CAP;

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
