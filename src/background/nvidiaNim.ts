import { parseSkillDraftJson, redactApiKey } from "../shared/parseSkillJson";
import { buildSkillGenerationPrompt } from "../shared/skillPrompt";
import { DEFAULT_NVIDIA_FALLBACK_MODELS, DEFAULT_NVIDIA_MODEL } from "../shared/settings";
import { NVIDIA_NIM_MODELS, type ModelOption, type ProviderGenerateParams, type SkillProvider } from "../shared/providers";
import type { SkillDraft, VideoContext } from "../shared/types";

const NVIDIA_NIM_BASE_URL = "https://integrate.api.nvidia.com";
const NVIDIA_NIM_KEY_PATTERN = /nvapi-[A-Za-z0-9_\-]{20,}/g;

export class NvidiaNimProvider implements SkillProvider {
  readonly id = "nvidia-nim" as const;
  readonly displayName = "NVIDIA NIM";
  readonly defaultModel = DEFAULT_NVIDIA_MODEL;
  readonly placeholderKey = "nvapi-...";
  readonly keyHintUrl = "https://build.nvidia.com";
  readonly endpointHint = "integrate.api.nvidia.com";
  readonly keyPattern = NVIDIA_NIM_KEY_PATTERN;
  readonly models: ModelOption[] = NVIDIA_NIM_MODELS;

  getCandidateModels(inputModel: string): string[] {
    const normalizedInput = inputModel.trim();
    if (!normalizedInput) {
      return [...DEFAULT_NVIDIA_FALLBACK_MODELS];
    }
    return Array.from(new Set([normalizedInput, ...DEFAULT_NVIDIA_FALLBACK_MODELS]));
  }

  async generateDraft(params: ProviderGenerateParams): Promise<Partial<SkillDraft>> {
    const { apiKey, model, video, preferredSkillName } = params;
    const candidates = this.getCandidateModels(model);
    let lastError: Error | null = null;

    for (const candidate of candidates) {
      try {
        return await requestNvidiaNimDraft({
          apiKey,
          model: candidate,
          video,
          preferredSkillName
        });
      } catch (error) {
        if (!(error instanceof Error) || !isRetryableModelError(error)) {
          throw error;
        }
        lastError = error;
      }
    }

    throw lastError || new Error("No compatible NVIDIA NIM model was available.");
  }
}

async function requestNvidiaNimDraft(params: {
  apiKey: string;
  model: string;
  video: VideoContext;
  preferredSkillName?: string;
}): Promise<Partial<SkillDraft>> {
  const { apiKey, model, video, preferredSkillName } = params;
  const prompt = buildSkillGenerationPrompt(video, preferredSkillName);

  const response = await fetch(`${NVIDIA_NIM_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      top_p: 0.9,
      max_tokens: 4096,
      stream: false,
      messages: [
        {
          role: "system",
          content:
            "You are a JSON generator. Return only valid JSON. Do not wrap the response in markdown fences."
        },
        { role: "user", content: prompt }
      ]
    })
  });

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(normalizeNvidiaNimError(payload.error?.message, response.status));
  }

  const text = payload.choices?.[0]?.message?.content;
  if (!text?.trim()) {
    throw new Error("NVIDIA NIM returned an empty response.");
  }
  return parseSkillDraftJson(text);
}

function isRetryableModelError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("not found") ||
    message.includes("unsupported") ||
    message.includes("is not found") ||
    message.includes("unexpected model") ||
    message.includes("does not exist") ||
    message.includes("model_not_found")
  );
}

export function normalizeNvidiaNimError(message: string | undefined, status: number): string {
  const safe = redactApiKey(message || "", NVIDIA_NIM_KEY_PATTERN).trim();
  const lower = safe.toLowerCase();

  if (status === 401 || lower.includes("unauthorized") || lower.includes("invalid api key")) {
    return "This NVIDIA NIM API key is invalid. Open Settings and paste a valid nvapi- key from build.nvidia.com.";
  }

  if (status === 403 || lower.includes("forbidden") || lower.includes("permission")) {
    return "NVIDIA NIM rejected this API key. Check that the key is active and has access to the chosen model.";
  }

  if (status === 404 || lower.includes("not found") || lower.includes("model_not_found")) {
    return "NVIDIA NIM does not recognize this model. Try a different model in Settings.";
  }

  if (status === 429 || lower.includes("rate limit")) {
    return "NVIDIA NIM rate-limited this request. Wait a moment and try again.";
  }

  if (status === 402 || lower.includes("insufficient") || lower.includes("billing") || lower.includes("quota")) {
    return "NVIDIA NIM reported a quota or billing issue. Check your build.nvidia.com account, then try again.";
  }

  return safe || `NVIDIA NIM request failed with ${status}.`;
}
