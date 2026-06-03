import { buildSkillPackages } from "../shared/skillFormat";
import { DEFAULT_SETTINGS, hasGeminiKey } from "../shared/settings";
import type { ExtensionSettings, GeneratedSkills, RuntimeRequest, RuntimeResponse } from "../shared/types";
import { generateDraftWithGemini } from "./gemini";

chrome.runtime.onMessage.addListener((message: RuntimeRequest, _sender, sendResponse) => {
  handleRuntimeMessage(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error: unknown) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "The extension could not complete that request."
      })
    );

  return true;
});

async function handleRuntimeMessage(message: RuntimeRequest): Promise<GeneratedSkills | { hasKey: boolean }> {
  if (message.type === "GET_SETTINGS_STATUS") {
    const settings = await getSettings();
    return { hasKey: hasGeminiKey(settings) };
  }

  if (message.type === "GENERATE_SKILLS") {
    const settings = await getSettings();
    if (!hasGeminiKey(settings)) {
      throw new Error("Add a Gemini API key in extension settings first.");
    }

    const draft = await generateDraftWithGemini({
      apiKey: settings.geminiApiKey.trim(),
      model: settings.geminiModel.trim() || DEFAULT_SETTINGS.geminiModel,
      video: message.video,
      preferredSkillName: message.preferredSkillName
    });

    return buildSkillPackages(draft, message.video);
  }

  throw new Error("Unsupported extension request.");
}

function getSettings(): Promise<ExtensionSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get(DEFAULT_SETTINGS, (items) => {
      resolve({
        geminiApiKey: String(items.geminiApiKey || ""),
        geminiModel: String(items.geminiModel || DEFAULT_SETTINGS.geminiModel)
      });
    });
  });
}
