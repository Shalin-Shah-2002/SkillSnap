import type { SkillDraft, VideoContext } from "./types";

export type ProviderId = "gemini" | "opencode-zen" | "opencode-go" | "nvidia-nim";

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

export const OPENCODE_ZEN_MODELS: ModelOption[] = [
  { id: "gpt-5-nano", label: "GPT 5 Nano", description: "Cheapest GPT, default." },
  { id: "gpt-5-mini", label: "GPT 5 Mini", description: "Balanced GPT." },
  { id: "gpt-5", label: "GPT 5", description: "Full GPT 5 quality." },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", description: "Fast Claude." },
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", description: "Balanced Claude." },
  { id: "claude-opus-4-5", label: "Claude Opus 4.5", description: "Highest quality Claude." },
  { id: "gemini-3-flash", label: "Gemini 3 Flash", description: "OpenCode-routed Gemini Flash." },
  { id: "kimi-k2.6", label: "Kimi K2.6", description: "Moonshot model." },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", description: "Strong open model." }
];

export const OPENCODE_GO_MODELS: ModelOption[] = [
  { id: "gpt-5-nano", label: "GPT 5 Nano", description: "Cheapest GPT, default." },
  { id: "gpt-5-mini", label: "GPT 5 Mini", description: "Balanced GPT." },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", description: "Fast Claude." },
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", description: "Balanced Claude." },
  { id: "minimax-m2.5", label: "MiniMax M2.5", description: "MiniMax M2.5 on Go tier." },
  { id: "minimax-m2.7", label: "MiniMax M2.7", description: "MiniMax M2.7 on Go tier." },
  { id: "minimax-m3", label: "MiniMax M3 (3x usage)", description: "MiniMax M3, counts 3x toward Go usage." },
  { id: "qwen3-6-plus", label: "Qwen 3.6 Plus", description: "Open coding model." },
  { id: "qwen3-7-max", label: "Qwen 3.7 Max", description: "Top Qwen on Go tier." },
  { id: "qwen3-7-plus", label: "Qwen 3.7 Plus", description: "Qwen 3.7 Plus on Go tier." },
  { id: "glm-5", label: "GLM 5", description: "Zhipu GLM 5 on Go tier." },
  { id: "glm-5.1", label: "GLM 5.1", description: "Zhipu GLM 5.1 on Go tier." },
  { id: "kimi-k2.5", label: "Kimi K2.5", description: "Moonshot K2.5 on Go tier." },
  { id: "kimi-k2.6", label: "Kimi K2.6", description: "Moonshot K2.6 on Go tier." },
  { id: "mimo-v2.5", label: "MiMo V2.5", description: "Xiaomi MiMo V2.5 on Go tier." },
  { id: "mimo-v2.5-pro", label: "MiMo V2.5 Pro", description: "Xiaomi MiMo V2.5 Pro on Go tier." },
  { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", description: "Fast DeepSeek on Go tier." },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", description: "Strong open model on Go tier." }
];

export const NVIDIA_NIM_MODELS: ModelOption[] = [
  { id: "meta/llama-3.3-70b-instruct", label: "Llama 3.3 70B Instruct", description: "Default. Strong open model." },
  { id: "nvidia/llama-3.1-nemotron-ultra-253b-v1", label: "Llama 3.1 Nemotron Ultra 253B", description: "NVIDIA's flagship reasoning model." },
  { id: "nvidia/llama-3.3-nemotron-super-49b-v1.5", label: "Llama 3.3 Nemotron Super 49B v1.5", description: "Fast Nemotron." },
  { id: "meta/llama-3.1-70b-instruct", label: "Llama 3.1 70B Instruct", description: "Stable Llama 3.1." },
  { id: "meta/llama-3.1-8b-instruct", label: "Llama 3.1 8B Instruct (Free)", description: "Free tier. Fast and small." },
  { id: "mistralai/mistral-large-3-675b-instruct-2512", label: "Mistral Large 3 675B", description: "Latest Mistral flagship." },
  { id: "mistralai/mistral-7b-instruct-v0.3", label: "Mistral 7B Instruct (Free)", description: "Free tier. Fast and small." },
  { id: "qwen/qwen3-coder-480b-a35b-instruct", label: "Qwen 3 Coder 480B", description: "Strong coding model." },
  { id: "qwen/qwen3-next-80b-a3b-instruct", label: "Qwen 3 Next 80B", description: "Fast Qwen." },
  { id: "google/gemma-3-27b-it", label: "Gemma 3 27B IT", description: "Google's open model." },
  { id: "google/gemma-2-9b-it", label: "Gemma 2 9B IT (Free)", description: "Free tier. Google's small model." },
  { id: "microsoft/phi-3-mini-4k-instruct", label: "Phi-3 Mini 4K (Free)", description: "Free tier. Microsoft's small model." },
  { id: "microsoft/phi-3-medium-4k-instruct", label: "Phi-3 Medium 4K (Free)", description: "Free tier. Microsoft's medium model." }
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
  },
  {
    id: "opencode-zen",
    displayName: "OpenCode Zen",
    defaultModel: "gpt-5-nano",
    placeholderKey: "oc-...",
    keyHintUrl: "https://opencode.ai/auth",
    endpointHint: "opencode.ai/zen/v1",
    models: OPENCODE_ZEN_MODELS
  },
  {
    id: "opencode-go",
    displayName: "OpenCode Go",
    defaultModel: "gpt-5-nano",
    placeholderKey: "oc-...",
    keyHintUrl: "https://opencode.ai/auth",
    endpointHint: "opencode.ai/zen/v1 (Go subscription)",
    models: OPENCODE_GO_MODELS
  },
  {
    id: "nvidia-nim",
    displayName: "NVIDIA NIM",
    defaultModel: "meta/llama-3.3-70b-instruct",
    placeholderKey: "nvapi-...",
    keyHintUrl: "https://build.nvidia.com",
    endpointHint: "integrate.api.nvidia.com",
    models: NVIDIA_NIM_MODELS
  }
];

export function getProviderInfo(id: ProviderId): ProviderInfo {
  const found = PROVIDER_LIST.find((provider) => provider.id === id);
  if (!found) {
    throw new Error(`Unknown provider: ${id}`);
  }
  return found;
}
