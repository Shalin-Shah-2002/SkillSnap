import { parseSkillDraftJson, redactApiKey } from "../shared/parseSkillJson";
import { buildSkillGenerationPrompt } from "../shared/skillPrompt";
import { DEFAULT_GEMINI_MODEL, FALLBACK_FLASH_MODELS } from "../shared/settings";
import { GEMINI_MODELS, type ModelOption, type ProviderGenerateParams, type SkillProvider } from "../shared/providers";
import type { SkillDraft, VideoContext } from "../shared/types";

const API_KEY_IN_ERROR_PATTERN = /AIza[0-9A-Za-z\-_]{20,}/g;

interface GeminiPart {
  text?: string;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
  }>;
  error?: {
    message?: string;
  };
}

export class GeminiProvider implements SkillProvider {
  readonly id = "gemini" as const;
  readonly displayName = "Google Gemini";
  readonly defaultModel = DEFAULT_GEMINI_MODEL;
  readonly placeholderKey = "AIza...";
  readonly keyHintUrl = "https://aistudio.google.com/api-keys";
  readonly endpointHint = "generativelanguage.googleapis.com";
  readonly keyPattern = API_KEY_IN_ERROR_PATTERN;
  readonly models: ModelOption[] = GEMINI_MODELS;

  getCandidateModels(inputModel: string): string[] {
    const normalizedInput = inputModel.trim();
    const preferredModels = normalizedInput.toLowerCase().includes("flash")
      ? [normalizedInput]
      : [];

    return Array.from(new Set([...preferredModels, DEFAULT_GEMINI_MODEL, ...FALLBACK_FLASH_MODELS]));
  }

  async generateDraft(params: ProviderGenerateParams): Promise<Partial<SkillDraft>> {
    const { apiKey, model, video, preferredSkillName } = params;
    const candidateModels = this.getCandidateModels(model);
    let lastError: Error | null = null;

    for (const candidateModel of candidateModels) {
      try {
        return await requestGeminiDraft({
          apiKey,
          model: candidateModel,
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

    throw lastError || new Error("No compatible Gemini Flash model was available.");
  }
}

async function requestGeminiDraft(params: {
  apiKey: string;
  model: string;
  video: VideoContext;
  preferredSkillName?: string;
}): Promise<Partial<SkillDraft>> {
  const { apiKey, model, video, preferredSkillName } = params;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: buildSkillGenerationPrompt(video, preferredSkillName) }]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json"
      }
    })
  });

  const payload = (await response.json()) as GeminiResponse;

  if (!response.ok) {
    throw new Error(normalizeGeminiErrorMessage(payload.error?.message, response.status));
  }

  return parseSkillDraftJson(extractGeminiText(payload));
}

function isRetryableModelError(error: Error): boolean {
  const message = error.message.toLowerCase();

  return (
    message.includes("not found") ||
    message.includes("unsupported") ||
    message.includes("is not found") ||
    message.includes("unexpected model") ||
    message.includes("does not exist")
  );
}

export function normalizeGeminiErrorMessage(message: string | undefined, status: number): string {
  const safeMessage = redactApiKey(message || "", API_KEY_IN_ERROR_PATTERN).trim();
  const lower = safeMessage.toLowerCase();

  if (lower.includes("consumer") && lower.includes("suspended")) {
    return "This Gemini API key has been suspended. Open Settings and replace it with a new active key.";
  }

  if (lower.includes("api key not valid") || lower.includes("invalid api key")) {
    return "This Gemini API key is invalid. Open Settings and paste a valid Gemini API key.";
  }

  if (lower.includes("permission denied") || lower.includes("access denied")) {
    return "Gemini rejected this API key. Check that the key is active and allowed to use the Gemini API, then try again.";
  }

  if (status === 429) {
    return "Gemini rate-limited this request. Wait a moment and try again.";
  }

  return safeMessage || `Gemini request failed with ${status}.`;
}

export function extractGeminiText(payload: GeminiResponse): string {
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
  if (!text?.trim()) {
    throw new Error("Gemini returned an empty response.");
  }

  return text;
}

export async function testGeminiApiKey(
  apiKey: string
): Promise<{ ok: boolean; message: string; model: string }> {
  const candidates = [DEFAULT_GEMINI_MODEL, ...FALLBACK_FLASH_MODELS];
  for (const model of candidates) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent`;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: "hi" }]
            }
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 1
          }
        })
      });

      if (response.ok) {
        return { ok: true, message: `Key works with model: ${model}`, model };
      }

      const payload = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      const errorMsg = payload.error?.message || `HTTP ${response.status}`;

      if (response.status === 400 && /api ?key/i.test(errorMsg)) {
        return { ok: false, message: `Invalid API key: ${errorMsg}`, model };
      }

      if (response.status === 401 || response.status === 403) {
        return { ok: false, message: `${response.status}: ${errorMsg}`, model };
      }

      if (response.status === 404) {
        continue;
      }

      return { ok: false, message: `${response.status}: ${errorMsg}`, model };
    } catch (err) {
      return {
        ok: false,
        message: `Network error: ${err instanceof Error ? err.message : String(err)}`,
        model
      };
    }
  }
  return { ok: false, message: "No accessible Gemini models found for this key.", model: "" };
}
