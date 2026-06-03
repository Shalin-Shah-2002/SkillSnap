import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_SETTINGS } from "../shared/settings";
import type { ExtensionSettings } from "../shared/types";

function OptionsApp() {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    chrome.storage.local.get(DEFAULT_SETTINGS, (items) => {
      setSettings({
        geminiApiKey: String(items.geminiApiKey || ""),
        geminiModel: String(items.geminiModel || DEFAULT_SETTINGS.geminiModel)
      });
    });
  }, []);

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    chrome.storage.local.set(
      {
        geminiApiKey: settings.geminiApiKey.trim(),
        geminiModel: settings.geminiModel.trim() || DEFAULT_SETTINGS.geminiModel
      },
      () => {
        setStatus("Settings saved.");
        window.setTimeout(() => setStatus(""), 2200);
      }
    );
  }

  return (
    <section className="options-shell stack">
      <header className="topbar">
        <div>
          <h1>YouTube Skill Maker Settings</h1>
          <p className="muted">Gemini powers the skill generation step.</p>
        </div>
        <a className="button-link" href="https://aistudio.google.com/api-keys" target="_blank" rel="noreferrer">
          Get API Key
        </a>
      </header>

      <div className="warning">
        Your key is saved in Chrome local extension storage and sent only to the Gemini API by this extension. Restrict it to the Gemini API before sharing this extension or using it beyond a personal MVP.
      </div>

      {status && <div className="success">{status}</div>}

      <form className="panel stack" onSubmit={save}>
        <label>
          Gemini API key
          <input
            type={showKey ? "text" : "password"}
            value={settings.geminiApiKey}
            onChange={(event) => setSettings({ ...settings, geminiApiKey: event.target.value })}
            placeholder="AIza..."
            autoComplete="off"
          />
        </label>

        <div className="row">
          <input
            id="show-key"
            type="checkbox"
            checked={showKey}
            onChange={(event) => setShowKey(event.target.checked)}
            style={{ width: 16, height: 16 }}
          />
          <label htmlFor="show-key" style={{ display: "block", fontWeight: 500 }}>
            Show key
          </label>
        </div>

        <label>
          Gemini model
          <input
            type="text"
            value={settings.geminiModel}
            onChange={(event) => setSettings({ ...settings, geminiModel: event.target.value })}
            placeholder={DEFAULT_SETTINGS.geminiModel}
          />
        </label>

        <p className="muted">Recommended Flash model: <code>{DEFAULT_SETTINGS.geminiModel}</code></p>

        <div className="button-row">
          <button className="primary" type="submit">
            Save Settings
          </button>
          <button type="button" onClick={() => setSettings(DEFAULT_SETTINGS)}>
            Reset
          </button>
        </div>
      </form>
    </section>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<OptionsApp />);
