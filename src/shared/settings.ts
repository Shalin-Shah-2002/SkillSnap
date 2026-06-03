import type { ExtensionSettings } from "./types";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

export const FALLBACK_FLASH_MODELS = [
  DEFAULT_GEMINI_MODEL,
  "gemini-flash-latest",
  "gemini-2.0-flash"
];

export const DEFAULT_SETTINGS: ExtensionSettings = {
  geminiApiKey: "",
  geminiModel: DEFAULT_GEMINI_MODEL
};

export function hasGeminiKey(settings: ExtensionSettings): boolean {
  return settings.geminiApiKey.trim().length > 0;
}
