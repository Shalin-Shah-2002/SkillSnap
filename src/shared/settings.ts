import type { ProviderSettings } from "./types";
import type { ProviderId } from "./providers";
import { PROVIDER_LIST } from "./providers";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

export const FALLBACK_FLASH_MODELS = [
  DEFAULT_GEMINI_MODEL,
  "gemini-flash-latest",
  "gemini-2.0-flash"
];

export const DEFAULT_OPENCODE_ZEN_MODEL = "gpt-5-nano";

export const DEFAULT_OPENCODE_GO_MODEL = "gpt-5-nano";

export const DEFAULT_OPENCODE_FALLBACK_MODELS = [
  "gpt-5-nano",
  "claude-haiku-4-5",
  "kimi-k2.6"
];

export const DEFAULT_NVIDIA_MODEL = "meta/llama-3.3-70b-instruct";

export const DEFAULT_NVIDIA_FALLBACK_MODELS = [
  "meta/llama-3.3-70b-instruct",
  "nvidia/llama-3.1-nemotron-ultra-253b-v1",
  "qwen/qwen3-coder-480b-a35b-instruct",
  "meta/llama-3.1-8b-instruct",
  "google/gemma-2-9b-it",
  "microsoft/phi-3-mini-4k-instruct"
];

export const DEFAULT_GEMINI_SETTINGS: ProviderSettings = {
  apiKey: "",
  model: DEFAULT_GEMINI_MODEL
};

export const DEFAULT_OPENCODE_ZEN_SETTINGS: ProviderSettings = {
  apiKey: "",
  model: DEFAULT_OPENCODE_ZEN_MODEL
};

export const DEFAULT_OPENCODE_GO_SETTINGS: ProviderSettings = {
  apiKey: "",
  model: DEFAULT_OPENCODE_GO_MODEL
};

export const DEFAULT_NVIDIA_SETTINGS: ProviderSettings = {
  apiKey: "",
  model: DEFAULT_NVIDIA_MODEL
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
    gemini: { ...DEFAULT_GEMINI_SETTINGS },
    "opencode-zen": { ...DEFAULT_OPENCODE_ZEN_SETTINGS },
    "opencode-go": { ...DEFAULT_OPENCODE_GO_SETTINGS },
    "nvidia-nim": { ...DEFAULT_NVIDIA_SETTINGS }
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
    gemini: readProviderSettings(storedProviders.gemini, DEFAULT_GEMINI_SETTINGS),
    "opencode-zen": readProviderSettings(storedProviders["opencode-zen"], DEFAULT_OPENCODE_ZEN_SETTINGS),
    "opencode-go": readProviderSettings(storedProviders["opencode-go"], DEFAULT_OPENCODE_GO_SETTINGS),
    "nvidia-nim": readProviderSettings(storedProviders["nvidia-nim"], DEFAULT_NVIDIA_SETTINGS)
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
      gemini: { apiKey: legacyKey, model: legacyModel },
      "opencode-zen": { apiKey: "", model: DEFAULT_OPENCODE_ZEN_MODEL },
      "opencode-go": { apiKey: "", model: DEFAULT_OPENCODE_GO_MODEL },
      "nvidia-nim": { apiKey: "", model: DEFAULT_NVIDIA_MODEL }
    }
  };
}
