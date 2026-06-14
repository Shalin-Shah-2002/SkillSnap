import type { SkillDraft, VideoContext } from "./types";

export type ProviderId = "gemini";

export interface ModelOption {
  id: string;
  label: string;
  description?: string;
}

export interface ProviderGenerateParams {
  apiKey: string;
  model: string;
  video: VideoContext;
  preferredSkillName?: string;
}

export interface SkillProvider {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly defaultModel: string;
  readonly placeholderKey: string;
  readonly keyHintUrl: string;
  readonly keyPattern?: RegExp;
  readonly endpointHint?: string;
  readonly models: ModelOption[];
  getCandidateModels(inputModel: string): string[];
  generateDraft(params: ProviderGenerateParams): Promise<Partial<SkillDraft>>;
}

export interface ProviderInfo {
  id: ProviderId;
  displayName: string;
  defaultModel: string;
  placeholderKey: string;
  keyHintUrl: string;
  endpointHint?: string;
  models: ModelOption[];
}

export const GEMINI_MODELS: ModelOption[] = [
  { id: "gemini-3-pro", label: "Gemini 3 Pro", description: "Latest flagship. Highest quality, slower." },
  { id: "gemini-3-pro-preview", label: "Gemini 3 Pro Preview", description: "Preview of Gemini 3 Pro." },
  { id: "gemini-3-flash", label: "Gemini 3 Flash", description: "Latest Flash. Fast, low cost." },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview", description: "Preview of Gemini 3 Flash." },
  { id: "gemini-3.1-pro", label: "Gemini 3.1 Pro", description: "Gemini 3.1 Pro, latest stable." },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview", description: "Preview of 3.1 Pro." },
  { id: "gemini-3.1-flash", label: "Gemini 3.1 Flash", description: "Gemini 3.1 Flash, fast and cheap." },
  { id: "gemini-3.1-flash-preview", label: "Gemini 3.1 Flash Preview", description: "Preview of 3.1 Flash." },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", description: "Recommended. Fast, low cost, good JSON output." },
  { id: "gemini-flash-latest", label: "Gemini Flash (latest alias)", description: "Always points to the newest Flash model." },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", description: "Older Flash model, very fast." },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", description: "Higher quality, slower and pricier." },
  { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite", description: "Cheapest Flash option." },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", description: "Lightweight, fast, low cost." },
  { id: "gemini-2.5-flash-thinking", label: "Gemini 2.5 Flash Thinking", description: "Flash with reasoning, slower." },
  { id: "gemini-pro-latest", label: "Gemini Pro (latest alias)", description: "Always points to newest Pro model." },
  { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro", description: "Older Pro, 1M context window." },
  { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash", description: "Older Flash, 1M context window." },
  { id: "gemini-1.5-flash-8b", label: "Gemini 1.5 Flash-8B", description: "Smallest Gemini, very fast." },
  { id: "gemini-1.0-pro", label: "Gemini 1.0 Pro", description: "Original Gemini Pro." },
  { id: "gemini-embedding-001", label: "Gemini Embedding 001", description: "Text embedding model." },
  { id: "text-embedding-004", label: "Text Embedding 004", description: "Embedding model." },
  { id: "imagen-3.0-generate-002", label: "Imagen 3.0", description: "Image generation." },
  { id: "veo-2.0-generate-001", label: "Veo 2.0", description: "Video generation." }
];

export const PROVIDER_LIST: ProviderInfo[] = [
  {
    id: "gemini",
    displayName: "Google Gemini",
    defaultModel: "gemini-2.5-flash",
    placeholderKey: "AIza...",
    keyHintUrl: "https://aistudio.google.com/api-keys",
    endpointHint: "generativelanguage.googleapis.com",
    models: GEMINI_MODELS
  }
];

export function getProviderInfo(id: ProviderId): ProviderInfo {
  const found = PROVIDER_LIST.find((provider) => provider.id === id);
  if (!found) {
    throw new Error(`Unknown provider: ${id}`);
  }
  return found;
}
