import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  readStoredSettings,
  getDefaultProviderSettings,
  getSettingsForProvider,
  DEFAULT_GEMINI_MODEL
} from "../shared/settings";
import { PROVIDER_LIST, getProviderInfo, type ModelOption, type ProviderId } from "../shared/providers";
import {
  formatRelativeTime,
  type SkillLibraryEntry
} from "../shared/skillLibrary";
import {
  DEFAULT_SKILL_LIBRARY_SOFT_CAP,
  MAX_SKILL_LIBRARY_SOFT_CAP,
  MIN_SKILL_LIBRARY_SOFT_CAP
} from "../shared/skillLibraryTypes";
import { SKILL_REVIEW_LAUNCH_KEY, type SkillEvalGrade, type SkillEvalRun, type SkillReviewSession } from "../shared/skillReviewTypes";
import { BrandMark } from "../shared/branding";
import type {
  ExtensionSettings,
  LibraryListResult,
  LibraryRebuildZipResult,
  RuntimeRequest,
  RuntimeResponse,
  SkillReviewApplyResult,
  SkillReviewListResult
} from "../shared/types";

type LibraryTab = "codex-skill" | "codex-reference" | "claude-skill" | "claude-reference";

type LibraryView =
  | { kind: "files"; entry: SkillLibraryEntry; tab: LibraryTab }
  | { kind: "review"; entry: SkillLibraryEntry };

function OptionsApp() {
  const [settings, setSettings] = useState<ExtensionSettings>(() => defaultEmptySettings());
  const [showKey, setShowKey] = useState<Record<ProviderId, boolean>>({
    gemini: false
  });
  const [status, setStatus] = useState("");
  const [testResults, setTestResults] = useState<Record<ProviderId, { ok: boolean; message: string } | null>>({
    gemini: null
  });
  const [testing, setTesting] = useState<Record<ProviderId, boolean>>({
    gemini: false
  });

  useEffect(() => {
    chrome.storage.local.get(null, (items) => {
      setSettings(readStoredSettings((items || {}) as Record<string, unknown>));
    });
  }, []);

  const activeProviderInfo = useMemo(
    () => getProviderInfo(settings.activeProvider),
    [settings.activeProvider]
  );

  function updateProvider(provider: ProviderId, patch: Partial<{ apiKey: string; model: string }>) {
    const current = getSettingsForProvider(settings, provider);
    const nextProviderSettings = { ...current, ...patch };
    const nextProviders = {
      ...settings.providers,
      [provider]: nextProviderSettings
    };

    const typedKey =
      patch.apiKey !== undefined && patch.apiKey.trim().length > 0;

    setSettings({
      ...settings,
      activeProvider: typedKey ? provider : settings.activeProvider,
      providers: nextProviders
    });
  }

  function selectActiveProvider(id: ProviderId) {
    setSettings({ ...settings, activeProvider: id });
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleaned: ExtensionSettings = {
      activeProvider: "gemini",
      providers: {
        gemini: {
          apiKey: settings.providers.gemini.apiKey.trim(),
          model: settings.providers.gemini.model.trim() || DEFAULT_GEMINI_MODEL
        }
      }
    };
    chrome.storage.local.set(cleaned, () => {
      setSettings(cleaned);
      setStatus("Settings saved.");
      window.setTimeout(() => setStatus(""), 2200);
    });
  }

  function reset() {
    setSettings(defaultEmptySettings());
  }

  function testKey(provider: ProviderId) {
    const apiKey = getSettingsForProvider(settings, provider).apiKey.trim();
    if (!apiKey) {
      setTestResults((prev) => ({ ...prev, [provider]: { ok: false, message: "No API key to test" } }));
      return;
    }

    setTesting((prev) => ({ ...prev, [provider]: true }));
    setTestResults((prev) => ({ ...prev, [provider]: null }));

    chrome.runtime.sendMessage(
      { type: "TEST_API_KEY", apiKey },
      (response: { ok: boolean; data?: { ok: boolean; message: string; model: string }; error?: string } | undefined) => {
        setTesting((prev) => ({ ...prev, [provider]: false }));
        if (chrome.runtime.lastError) {
          setTestResults((prev) => ({ ...prev, [provider]: { ok: false, message: chrome.runtime.lastError?.message || "Unknown error" } }));
          return;
        }
        if (!response?.ok || !response.data) {
          setTestResults((prev) => ({ ...prev, [provider]: { ok: false, message: response?.error || "Test failed" } }));
          return;
        }
        setTestResults((prev) => ({ ...prev, [provider]: { ok: response.data!.ok, message: response.data!.message } }));
      }
    );
  }

  function toggleKeyVisibility(id: ProviderId) {
    setShowKey({ ...showKey, [id]: !showKey[id] });
  }

  return (
    <section className="options-shell stack">
      <header className="topbar">
        <div className="brand-row">
          <BrandMark size={56} />
          <div className="brand-copy">
            <h1>SkillSnap Settings</h1>
            <p className="muted">
              Pick a provider to generate skills. Active provider: <strong>{activeProviderInfo.displayName}</strong>.
            </p>
          </div>
        </div>
      </header>

      <div className="warning">
        API keys are stored in Chrome local extension storage. This is fine for a personal MVP — restrict the key
        before sharing the extension or using it beyond a personal setup.
      </div>

      {status && <div className="success">{status}</div>}

      <form className="panel stack" onSubmit={save}>
        <label>
          Active provider
          <select
            value={settings.activeProvider}
            onChange={(event) => selectActiveProvider(event.target.value as ProviderId)}
          >
            {PROVIDER_LIST.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.displayName}
              </option>
            ))}
          </select>
        </label>

        {PROVIDER_LIST.map((provider) => (
          <ProviderSection
            key={provider.id}
            id={provider.id}
            displayName={provider.displayName}
            isActive={settings.activeProvider === provider.id}
            apiKey={getSettingsForProvider(settings, provider.id).apiKey}
            model={getSettingsForProvider(settings, provider.id).model}
            placeholderKey={provider.placeholderKey}
            keyHintUrl={provider.keyHintUrl}
            endpointHint={provider.endpointHint}
            models={provider.models}
            showKey={showKey[provider.id]}
            onToggleKeyVisibility={() => toggleKeyVisibility(provider.id)}
            onChangeApiKey={(value) => updateProvider(provider.id, { apiKey: value })}
            onChangeModel={(value) => updateProvider(provider.id, { model: value })}
            onTestKey={() => testKey(provider.id)}
            testResult={testResults[provider.id]}
            testing={testing[provider.id]}
          />
        ))}

        <div className="button-row">
          <button className="primary" type="submit">
            Save Settings
          </button>
          <button type="button" onClick={reset}>
            Reset
          </button>
        </div>
      </form>

      <SkillLibrarySection />
    </section>
  );
}

function SkillLibrarySection() {
  const [entries, setEntries] = useState<SkillLibraryEntry[]>([]);
  const [softCap, setSoftCap] = useState<number>(DEFAULT_SKILL_LIBRARY_SOFT_CAP);
  const [pendingCap, setPendingCap] = useState<number>(DEFAULT_SKILL_LIBRARY_SOFT_CAP);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<LibraryView | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    chrome.storage.local.get(SKILL_REVIEW_LAUNCH_KEY, (items) => {
      const launch = (items || {})[SKILL_REVIEW_LAUNCH_KEY] as { entryId?: string; savedAt?: number } | undefined;
      if (!launch?.entryId) return;
      if (typeof launch.savedAt === "number" && Date.now() - launch.savedAt > 10 * 60 * 1000) return;
      chrome.storage.local.remove(SKILL_REVIEW_LAUNCH_KEY);
      void openReviewById(launch.entryId);
    });
  }, []);

  async function refresh() {
    setError("");
    try {
      const result = await sendOptionsRuntime<LibraryListResult>({ type: "LIBRARY_LIST" });
      setEntries(result.entries);
      setSoftCap(result.config.softCap);
      setPendingCap(result.config.softCap);
      setView((current) => {
        if (!current) return current;
        const updatedEntry = result.entries.find((entry) => entry.id === current.entry.id);
        if (!updatedEntry) return null;
        return { ...current, entry: updatedEntry } as LibraryView;
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the library.");
    }
  }

  async function deleteEntry(entry: SkillLibraryEntry) {
    if (!window.confirm(`Delete "${entry.skillName}" from the library?`)) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await sendOptionsRuntime({ type: "LIBRARY_DELETE", id: entry.id });
      if (view?.entry.id === entry.id) {
        setView(null);
      }
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete entry.");
    } finally {
      setBusy(false);
    }
  }

  async function openReviewById(entryId: string) {
    setError("");
    try {
      const entry = await sendOptionsRuntime<SkillLibraryEntry>({ type: "LIBRARY_GET", id: entryId });
      setView({ kind: "review", entry });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open the review workspace.");
    }
  }

  async function handleEntryUpdated(entry: SkillLibraryEntry) {
    setEntries((current) => current.map((item) => (item.id === entry.id ? entry : item)));
    setView((current) => (current ? ({ ...current, entry } as LibraryView) : current));
    await refresh();
  }

  async function downloadEntry(entry: SkillLibraryEntry, kind: "codex" | "claude") {
    setBusy(true);
    setError("");
    try {
      const result = await sendOptionsRuntime<LibraryRebuildZipResult>({
        type: "LIBRARY_REBUILD_ZIP",
        id: entry.id,
        kind
      });
      downloadBase64Zip(result.base64, result.fileName);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not rebuild ZIP.");
    } finally {
      setBusy(false);
    }
  }

  async function copyUrl(entry: SkillLibraryEntry) {
    try {
      await navigator.clipboard.writeText(entry.videoUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not copy URL.");
    }
  }

  async function saveCap() {
    if (pendingCap === softCap) return;
    setBusy(true);
    setError("");
    try {
      const config = await sendOptionsRuntime<{ softCap: number }>({ type: "LIBRARY_SET_SOFT_CAP", softCap: pendingCap });
      setSoftCap(config.softCap);
      setPendingCap(config.softCap);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update cap.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel stack" aria-label="Skill library">
      <div className="row-between">
        <div>
          <h2>Skill Library</h2>
          <p className="muted">
            {entries.length} of {softCap} entries stored locally. Older entries are evicted automatically when the cap is exceeded.
          </p>
        </div>
        <div className="button-row">
          <button type="button" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="error" role="alert">{error}</div>}

      <div className="row">
        <label style={{ flex: 1 }}>
          Soft cap
          <input
            type="number"
            min={MIN_SKILL_LIBRARY_SOFT_CAP}
            max={MAX_SKILL_LIBRARY_SOFT_CAP}
            value={pendingCap}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value)) {
                setPendingCap(Math.max(MIN_SKILL_LIBRARY_SOFT_CAP, Math.min(MAX_SKILL_LIBRARY_SOFT_CAP, Math.floor(value))));
              }
            }}
          />
        </label>
        <button type="button" onClick={saveCap} disabled={busy || pendingCap === softCap} style={{ marginTop: 22 }}>
          Save cap
        </button>
      </div>

      {view ? (
        view.kind === "files" ? (
          <LibraryEntryView entry={view.entry} tab={view.tab} setTab={setView} onClose={() => setView(null)} />
        ) : (
          <LibraryReviewView entry={view.entry} onClose={() => setView(null)} onEntryUpdated={(entry) => void handleEntryUpdated(entry)} />
        )
      ) : entries.length === 0 ? (
        <p className="muted">No skills yet. Generate a skill in the popup to populate the library.</p>
      ) : (
        <ul className="library-list">
          {entries.map((entry) => (
            <li key={entry.id} className="library-row">
              <div className="library-row-main">
                <p className="library-title">{entry.videoTitle}</p>
                <p className="muted">
                  {entry.channelName} · {entry.skillName} · {formatRelativeTime(entry.createdAt)} · {entry.model}
                </p>
              </div>
              <div className="button-row">
                <button type="button" disabled={busy} onClick={() => void downloadEntry(entry, "codex")}>
                  ⬇ Codex
                </button>
                <button type="button" disabled={busy} onClick={() => void downloadEntry(entry, "claude")}>
                  ⬇ Claude
                </button>
                <button type="button" onClick={() => setView({ kind: "files", entry, tab: "codex-skill" })}>
                  View
                </button>
                <button type="button" onClick={() => setView({ kind: "review", entry })}>
                  Review & Improve
                </button>
                <button type="button" onClick={() => void copyUrl(entry)}>
                  Copy URL
                </button>
                <button type="button" className="danger" onClick={() => void deleteEntry(entry)} disabled={busy}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LibraryEntryView(props: {
  entry: SkillLibraryEntry;
  tab: LibraryTab;
  setTab: React.Dispatch<React.SetStateAction<LibraryView | null>>;
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
    <div className="stack">
      <div className="row-between">
        <div>
          <h3>{props.entry.videoTitle}</h3>
          <p className="muted">
            {props.entry.skillName} · {formatRelativeTime(props.entry.createdAt)}
          </p>
        </div>
        <button type="button" onClick={props.onClose}>
          Back
        </button>
      </div>
      <div className="button-row" role="tablist" aria-label="Skill files">
        <TabButton id="codex-skill" active={props.tab} setActive={(tab) => props.setTab({ kind: "files", entry: props.entry, tab })}>
          Codex SKILL.md
        </TabButton>
        <TabButton id="codex-reference" active={props.tab} setActive={(tab) => props.setTab({ kind: "files", entry: props.entry, tab })}>
          Codex Notes
        </TabButton>
        <TabButton id="claude-skill" active={props.tab} setActive={(tab) => props.setTab({ kind: "files", entry: props.entry, tab })}>
          Claude SKILL.md
        </TabButton>
        <TabButton id="claude-reference" active={props.tab} setActive={(tab) => props.setTab({ kind: "files", entry: props.entry, tab })}>
          Claude Notes
        </TabButton>
      </div>
      <textarea value={value} readOnly spellCheck={false} />
    </div>
  );
}

function LibraryReviewView(props: {
  entry: SkillLibraryEntry;
  onClose: () => void;
  onEntryUpdated: (entry: SkillLibraryEntry) => void;
}) {
  const [sessions, setSessions] = useState<SkillReviewSession[]>([]);
  const [active, setActive] = useState<SkillReviewSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    void refreshSessions();
  }, [props.entry.id]);

  useEffect(() => {
    if (!active) {
      setFeedbackDrafts({});
      return;
    }
    setFeedbackDrafts(active.feedback);
  }, [active?.id, active?.updatedAt]);

  async function refreshSessions() {
    setError("");
    try {
      const result = await sendOptionsRuntime<SkillReviewListResult>({
        type: "SKILL_REVIEW_LIST",
        entryId: props.entry.id
      });
      setSessions(result.sessions);
      setActive((current) => {
        if (current) {
          return result.sessions.find((session) => session.id === current.id) || result.sessions[0] || null;
        }
        return result.sessions[0] || null;
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load review sessions.");
    }
  }

  async function startReview() {
    setBusy(true);
    setError("");
    setNotice("Preparing eval cases...");
    try {
      const created = await sendOptionsRuntime<SkillReviewSession>({
        type: "SKILL_REVIEW_CREATE",
        entryId: props.entry.id,
        kind: "codex"
      });
      setActive(created);
      setSessions((current) => [created, ...current.filter((session) => session.id !== created.id)]);
      setNotice("Running baseline and with-skill answers...");
      const completed = await sendOptionsRuntime<SkillReviewSession>({
        type: "SKILL_REVIEW_STEP",
        sessionId: created.id
      });
      setActive(completed);
      setSessions((current) => [completed, ...current.filter((session) => session.id !== completed.id)]);
      setNotice("Review ready.");
      window.setTimeout(() => setNotice(""), 2200);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not run the review.");
      setNotice("");
      void refreshSessions();
    } finally {
      setBusy(false);
    }
  }

  async function saveFeedback(evalCaseId: string) {
    if (!active) return;
    setBusy(true);
    setError("");
    try {
      const updated = await sendOptionsRuntime<SkillReviewSession>({
        type: "SKILL_REVIEW_SAVE_FEEDBACK",
        sessionId: active.id,
        evalCaseId,
        feedback: feedbackDrafts[evalCaseId] || ""
      });
      setActive(updated);
      setSessions((current) => [updated, ...current.filter((session) => session.id !== updated.id)]);
      setNotice("Feedback saved.");
      window.setTimeout(() => setNotice(""), 1800);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save feedback.");
    } finally {
      setBusy(false);
    }
  }

  async function draftImprovement() {
    if (!active) return;
    setBusy(true);
    setError("");
    setNotice("Drafting an improved SKILL.md...");
    try {
      const updated = await sendOptionsRuntime<SkillReviewSession>({
        type: "SKILL_REVIEW_IMPROVE",
        sessionId: active.id
      });
      setActive(updated);
      setSessions((current) => [updated, ...current.filter((session) => session.id !== updated.id)]);
      setNotice("Improvement drafted.");
      window.setTimeout(() => setNotice(""), 2200);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not draft an improvement.");
      setNotice("");
      void refreshSessions();
    } finally {
      setBusy(false);
    }
  }

  async function applyImprovement() {
    if (!active?.improvement) return;
    setBusy(true);
    setError("");
    try {
      const result = await sendOptionsRuntime<SkillReviewApplyResult>({
        type: "SKILL_REVIEW_APPLY_IMPROVEMENT",
        sessionId: active.id
      });
      setActive(result.session);
      setSessions((current) => [result.session, ...current.filter((session) => session.id !== result.session.id)]);
      props.onEntryUpdated(result.entry);
      setNotice("Improved skill applied.");
      window.setTimeout(() => setNotice(""), 2200);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not apply the improvement.");
    } finally {
      setBusy(false);
    }
  }

  const canImprove = active?.status === "ready" || active?.status === "improved" || active?.status === "applied";

  return (
    <div className="stack review-workspace">
      <div className="row-between">
        <div>
          <h3>Review & Improve</h3>
          <p className="muted">
            {props.entry.skillName} · text/markdown evals · Codex package
          </p>
        </div>
        <div className="button-row">
          <button type="button" onClick={props.onClose}>
            Back
          </button>
          <button type="button" className="primary" onClick={() => void startReview()} disabled={busy}>
            {busy ? "Working..." : "Start review"}
          </button>
        </div>
      </div>

      {notice && <div className="success">{notice}</div>}
      {error && <div className="error" role="alert">{error}</div>}

      {sessions.length > 1 && (
        <label>
          Review session
          <select
            value={active?.id || ""}
            onChange={(event) => setActive(sessions.find((session) => session.id === event.target.value) || null)}
          >
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {formatRelativeTime(session.updatedAt)} · {session.status} · {session.cases.length} evals
              </option>
            ))}
          </select>
        </label>
      )}

      {!active ? (
        <p className="muted">
          Start a review to generate realistic test prompts, compare baseline answers with skill-guided answers, and draft a better SKILL.md.
        </p>
      ) : (
        <>
          {active.summary && <ReviewSummaryPanel session={active} />}

          <div className="review-grid">
            {active.cases.map((evalCase) => {
              const baselineRun = findRun(active.runs, evalCase.id, "baseline");
              const skillRun = findRun(active.runs, evalCase.id, "with_skill");
              const baselineGrade = findGrade(active.grades, evalCase.id, "baseline");
              const skillGrade = findGrade(active.grades, evalCase.id, "with_skill");
              return (
                <article key={evalCase.id} className="review-card">
                  <div className="row-between">
                    <div>
                      <h3>{evalCase.name}</h3>
                      <p className="muted">{evalCase.expectedOutput}</p>
                    </div>
                    <span className="score-pill">
                      {formatPercent(skillGrade?.passRate)} with skill
                    </span>
                  </div>
                  <div className="review-prompt">
                    <strong>Prompt</strong>
                    <p>{evalCase.prompt}</p>
                  </div>
                  <RunComparison
                    baselineRun={baselineRun}
                    skillRun={skillRun}
                    baselineGrade={baselineGrade}
                    skillGrade={skillGrade}
                  />
                  <label>
                    Feedback
                    <textarea
                      className="feedback-box"
                      value={feedbackDrafts[evalCase.id] || ""}
                      placeholder="What should the next version do better?"
                      onChange={(event) =>
                        setFeedbackDrafts((current) => ({ ...current, [evalCase.id]: event.target.value }))
                      }
                    />
                  </label>
                  <button type="button" onClick={() => void saveFeedback(evalCase.id)} disabled={busy}>
                    Save feedback
                  </button>
                </article>
              );
            })}
          </div>

          <div className="review-actions">
            <button type="button" onClick={() => void draftImprovement()} disabled={busy || !canImprove}>
              Draft improved SKILL.md
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => void applyImprovement()}
              disabled={busy || !active.improvement || active.status === "applied"}
            >
              Apply improvement
            </button>
          </div>

          {active.improvement && (
            <section className="stack improvement-panel">
              <div>
                <h3>Improvement proposal</h3>
                <p className="muted">{active.improvement.rationale}</p>
              </div>
              <textarea value={active.improvement.proposedSkillMd} readOnly spellCheck={false} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function ReviewSummaryPanel(props: { session: SkillReviewSession }) {
  const summary = props.session.summary;
  if (!summary) return null;
  return (
    <div className="review-summary" aria-label="Review benchmark summary">
      <div>
        <span className="metric-label">With skill</span>
        <strong>{formatPercent(summary.withSkillPassRate)}</strong>
      </div>
      <div>
        <span className="metric-label">Baseline</span>
        <strong>{formatPercent(summary.baselinePassRate)}</strong>
      </div>
      <div>
        <span className="metric-label">Delta</span>
        <strong>{formatSignedPercent(summary.passRateDelta)}</strong>
      </div>
      <div>
        <span className="metric-label">Evals</span>
        <strong>{summary.evalCount}</strong>
      </div>
      {summary.withSkillMeanTokens !== undefined && (
        <div>
          <span className="metric-label">Avg tokens</span>
          <strong>{Math.round(summary.withSkillMeanTokens).toLocaleString()}</strong>
        </div>
      )}
    </div>
  );
}

function RunComparison(props: {
  baselineRun?: SkillEvalRun;
  skillRun?: SkillEvalRun;
  baselineGrade?: SkillEvalGrade;
  skillGrade?: SkillEvalGrade;
}) {
  return (
    <div className="run-comparison">
      <RunColumn title="Baseline" run={props.baselineRun} grade={props.baselineGrade} />
      <RunColumn title="With skill" run={props.skillRun} grade={props.skillGrade} />
    </div>
  );
}

function RunColumn(props: { title: string; run?: SkillEvalRun; grade?: SkillEvalGrade }) {
  return (
    <div className="run-column">
      <div className="row-between">
        <strong>{props.title}</strong>
        <span className="score-pill">{formatPercent(props.grade?.passRate)}</span>
      </div>
      <pre>{props.run?.output || props.run?.error || "Not run yet."}</pre>
      {props.grade && (
        <ul className="grade-list">
          {props.grade.expectations.map((item, index) => (
            <li key={`${item.text}-${index}`} className={item.passed ? "passed" : "failed"}>
              <strong>{item.passed ? "Pass" : "Check"}</strong> {item.text}
              <span>{item.evidence}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TabButton(props: {
  id: LibraryTab;
  active: LibraryTab;
  setActive: (tab: LibraryTab) => void;
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

function findRun(runs: SkillEvalRun[], evalCaseId: string, kind: "baseline" | "with_skill"): SkillEvalRun | undefined {
  return runs.find((run) => run.evalCaseId === evalCaseId && run.kind === kind);
}

function findGrade(grades: SkillEvalGrade[], evalCaseId: string, kind: "baseline" | "with_skill"): SkillEvalGrade | undefined {
  return grades.find((grade) => grade.evalCaseId === evalCaseId && grade.kind === kind);
}

function formatPercent(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0%";
  return `${Math.round(value * 100)}%`;
}

function formatSignedPercent(value: number): string {
  const rounded = Math.round(value * 100);
  return `${rounded >= 0 ? "+" : ""}${rounded}%`;
}

function downloadBase64Zip(base64: string, fileName: string): void {
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

function sendOptionsRuntime<T>(message: RuntimeRequest): Promise<T> {
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

function ProviderSection(props: {
  id: ProviderId;
  displayName: string;
  isActive: boolean;
  apiKey: string;
  model: string;
  placeholderKey: string;
  keyHintUrl: string;
  endpointHint?: string;
  models: ModelOption[];
  showKey: boolean;
  onToggleKeyVisibility: () => void;
  onChangeApiKey: (value: string) => void;
  onChangeModel: (value: string) => void;
  onTestKey: () => void;
  testResult: { ok: boolean; message: string } | null;
  testing: boolean;
}) {
  const knownModelIds = useMemo(() => new Set(props.models.map((m) => m.id)), [props.models]);
  const modelIsKnown = knownModelIds.has(props.model);
  const selectedModel = useMemo(() => {
    if (!props.model) return "";
    if (knownModelIds.has(props.model)) return props.model;
    return "__custom__";
  }, [props.model, knownModelIds]);

  return (
    <fieldset className="provider-section">
      <legend>
        {props.displayName}
        {props.isActive ? " (active)" : ""}
      </legend>

      <div className="row-between">
        <p className="muted">
          {props.endpointHint && <>Endpoint: <code>{props.endpointHint}</code> · </>}
          <a className="button-link" href={props.keyHintUrl} target="_blank" rel="noreferrer">
            Get API key
          </a>
        </p>
      </div>

      <label>
        API key
        <input
          type={props.showKey ? "text" : "password"}
          value={props.apiKey}
          onChange={(event) => props.onChangeApiKey(event.target.value)}
          placeholder={props.placeholderKey}
          autoComplete="off"
        />
      </label>

      <div className="row">
        <input
          id={`show-key-${props.id}`}
          type="checkbox"
          checked={props.showKey}
          onChange={props.onToggleKeyVisibility}
          style={{ width: 16, height: 16 }}
        />
        <label htmlFor={`show-key-${props.id}`} style={{ display: "block", fontWeight: 500 }}>
          Show key
        </label>
        <button
          type="button"
          onClick={props.onTestKey}
          disabled={props.testing || !props.apiKey.trim()}
          style={{ marginLeft: "auto" }}
        >
          {props.testing ? "Testing..." : "Test key"}
        </button>
      </div>

      {props.testResult && (
        <div
          className={props.testResult.ok ? "success" : "error"}
          role="alert"
          style={{ fontSize: "0.85rem", padding: "0.5rem" }}
        >
          {props.testResult.ok ? "✓ " : "✗ "}
          {props.testResult.message}
        </div>
      )}

      <label>
        Model
        <select
          value={selectedModel}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "__custom__") {
              props.onChangeModel(props.model && !modelIsKnown ? props.model : "");
            } else {
              props.onChangeModel(value);
            }
          }}
        >
          {props.models.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
              {option.description ? ` — ${option.description}` : ""}
            </option>
          ))}
          <option value="__custom__">Custom model…</option>
        </select>
      </label>

      {selectedModel === "__custom__" && (
        <label>
          Custom model id
          <input
            type="text"
            value={props.model}
            onChange={(event) => props.onChangeModel(event.target.value)}
            placeholder="paste any model id"
          />
        </label>
      )}

      <p className="muted">
        Current: <code>{props.model || "not set"}</code>
      </p>
    </fieldset>
  );
}

function defaultEmptySettings(): ExtensionSettings {
  return {
    activeProvider: "gemini",
    providers: getDefaultProviderSettings()
  };
}

createRoot(document.getElementById("root") as HTMLElement).render(<OptionsApp />);
