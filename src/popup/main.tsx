import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { getPackageFiles } from "../shared/skillFormat";
import { DEFAULT_SETTINGS } from "../shared/settings";
import type { ContentRequest, GeneratedSkills, RuntimeRequest, RuntimeResponse, VideoContext } from "../shared/types";
import { downloadZipFile } from "./zip";

type Stage = "idle" | "capturing" | "generating" | "ready";
type EditorTab = "codex-skill" | "codex-reference" | "claude-skill" | "claude-reference";

interface EditablePackages {
  skillName: string;
  codexSkillMd: string;
  codexReferenceMd: string;
  claudeSkillMd: string;
  claudeReferenceMd: string;
}

function App() {
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [activeTabUrl, setActiveTabUrl] = useState("");
  const [video, setVideo] = useState<VideoContext | null>(null);
  const [generated, setGenerated] = useState<GeneratedSkills | null>(null);
  const [editable, setEditable] = useState<EditablePackages | null>(null);
  const [editorTab, setEditorTab] = useState<EditorTab>("codex-skill");
  const [preferredName, setPreferredName] = useState("");

  useEffect(() => {
    void refreshEnvironment();
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

    const [settingsStatus, tab] = await Promise.all([sendRuntime<{ hasKey: boolean }>({ type: "GET_SETTINGS_STATUS" }), getActiveTab()]);
    setHasKey(settingsStatus.hasKey);
    setActiveTabUrl(tab.url || "");
  }

  async function makeSkill() {
    setError("");
    setGenerated(null);
    setEditable(null);

    try {
      const tab = await getActiveTab();
      if (!tab.id || !isYouTubeVideoUrl(tab.url || "")) {
        throw new Error("Open a YouTube video with captions, then click Make Skill.");
      }

      setStage("capturing");
      const captured = await sendTabMessage<VideoContext>(tab.id, { type: "GET_YOUTUBE_CONTEXT" });
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
    } catch (caught) {
      setStage("idle");
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    }
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
  }

  return (
    <section className="app-shell">
      <header className="topbar">
        <div>
          <h1>YouTube Skill Maker</h1>
          <p className="muted">Generate editable Codex and Claude skill ZIPs from captions.</p>
        </div>
        <button type="button" className="ghost" onClick={() => chrome.runtime.openOptionsPage()}>
          Settings
        </button>
      </header>

      <div className="warning">
        Gemini keys are stored in Chrome local extension storage. This is fine for a personal MVP; restrict the key before sharing the extension.
      </div>

      {!hasKey && (
        <div className="error" role="alert">
          Add a Gemini API key in Settings before generating a skill.
        </div>
      )}

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      <section className="panel stack">
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

        <button type="button" className="primary" onClick={makeSkill} disabled={!canGenerate}>
          {stage === "capturing" ? "Reading captions..." : stage === "generating" ? "Generating..." : "Make Skill"}
        </button>

        {isBusy && <div className="progress" aria-label="Working" />}
      </section>

      {editable && (
        <section className="panel stack">
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
    </section>
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

function getActiveTab(): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab) {
        reject(new Error("No active tab found."));
        return;
      }

      resolve(tab);
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

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
