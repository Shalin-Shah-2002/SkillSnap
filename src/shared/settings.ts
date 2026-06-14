import type { ProviderSettings } from "./types";
import type { ProviderId } from "./providers";
import { PROVIDER_LIST } from "./providers";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

export const FALLBACK_FLASH_MODELS = [
  DEFAULT_GEMINI_MODEL,
  "gemini-flash-latest",
  "gemini-2.0-flash"
];

export const DEFAULT_GEMINI_SETTINGS: ProviderSettings = {
  apiKey: "",
  model: DEFAULT_GEMINI_MODEL
};

export interface ExtensionSettingsV1 {
  geminiApiKey: string;
  geminiModel: string;
}

export interface ExtensionSettingsV2 {
  activeProvider: ProviderId;
  providers: Record<ProviderId, ProviderSettings>;
}

export function getDefaultProviderSettings(): Record<ProviderId, ProviderSettings> {
  return {
    gemini: { ...DEFAULT_GEMINI_SETTINGS }
  };
}

export const DEFAULT_SETTINGS: ExtensionSettingsV2 = {
  activeProvider: "gemini",
  providers: getDefaultProviderSettings()
};

export function hasProviderKey(settings: ExtensionSettingsV2, id: ProviderId): boolean {
  const provider = getSettingsForProvider(settings, id);
  return Boolean(provider?.apiKey?.trim());
}

export function getActiveProviderSettings(settings: ExtensionSettingsV2): ProviderSettings {
  return getSettingsForProvider(settings, settings.activeProvider);
}

export function getSettingsForProvider(
  settings: ExtensionSettingsV2,
  id: ProviderId
): ProviderSettings {
  const found = settings.providers?.[id];
  if (found) {
    return found;
  }
  const info = PROVIDER_LIST.find((p) => p.id === id);
  return { apiKey: "", model: info?.defaultModel || "" };
}

export function readStoredSettings(stored: Record<string, unknown>): ExtensionSettingsV2 {
  const migrated = migrateSettings(stored);
  const storedProviders = (migrated.providers || {}) as Record<string, Partial<ProviderSettings>>;

  const providers: Record<ProviderId, ProviderSettings> = {
    gemini: readProviderSettings(storedProviders.gemini, DEFAULT_GEMINI_SETTINGS)
  };

  const activeProvider = (migrated.activeProvider as ProviderId) || "gemini";
  const safeActive = providers[activeProvider] ? activeProvider : "gemini";

  return { activeProvider: safeActive, providers };
}

function readProviderSettings(
  stored: Partial<ProviderSettings> | undefined,
  fallback: ProviderSettings
): ProviderSettings {
  if (!stored || typeof stored !== "object") {
    return { ...fallback };
  }
  return {
    apiKey: typeof stored.apiKey === "string" ? stored.apiKey : "",
    model: typeof stored.model === "string" && stored.model.trim().length > 0 ? stored.model : fallback.model
  };
}

function migrateSettings(stored: Record<string, unknown>): Record<string, unknown> {
  const hasV2Shape =
    stored && typeof stored === "object" && "providers" in (stored as object);

  if (hasV2Shape) {
    return stored;
  }

  const legacyKey = typeof stored.geminiApiKey === "string" ? stored.geminiApiKey : "";
  const legacyModel =
    typeof stored.geminiModel === "string" && stored.geminiModel.trim().length > 0
      ? stored.geminiModel
      : DEFAULT_GEMINI_MODEL;

  return {
    activeProvider: "gemini",
    providers: {
      gemini: { apiKey: legacyKey, model: legacyModel }
    }
  };
}
