import { buildSkillGenerationPrompt } from "../shared/geminiPrompt";
import { DEFAULT_GEMINI_MODEL, FALLBACK_FLASH_MODELS } from "../shared/settings";
import type { SkillDraft, VideoContext } from "../shared/types";

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

const API_KEY_IN_ERROR_PATTERN = /AIza[0-9A-Za-z\-_]{20,}/g;

export async function generateDraftWithGemini(params: {
  apiKey: string;
  model: string;
  video: VideoContext;
  preferredSkillName?: string;
}): Promise<Partial<SkillDraft>> {
  const { apiKey, model, video, preferredSkillName } = params;
  const candidateModels = getCandidateFlashModels(model);
  let lastError: Error | null = null;

  for (const candidateModel of candidateModels) {
    try {
      return await requestDraft({
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

async function requestDraft(params: {
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

  return parseGeminiSkillJson(extractGeminiText(payload));
}

export function getCandidateFlashModels(inputModel: string): string[] {
  const normalizedInput = inputModel.trim();
  const preferredModels = normalizedInput.toLowerCase().includes("flash")
    ? [normalizedInput]
    : [];

  return Array.from(new Set([...preferredModels, DEFAULT_GEMINI_MODEL, ...FALLBACK_FLASH_MODELS]));
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
  const safeMessage = redactApiKeys(message || "").trim();
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

function redactApiKeys(message: string): string {
  return message.replace(API_KEY_IN_ERROR_PATTERN, "[redacted-api-key]");
}

export function extractGeminiText(payload: GeminiResponse): string {
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
  if (!text?.trim()) {
    throw new Error("Gemini returned an empty response.");
  }

  return text;
}

export function parseGeminiSkillJson(text: string): Partial<SkillDraft> {
  const cleaned = stripJsonFence(text.trim());

  try {
    return JSON.parse(cleaned) as Partial<SkillDraft>;
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as Partial<SkillDraft>;
    }

    throw new Error("Gemini did not return valid skill JSON.");
  }
}

function stripJsonFence(text: string): string {
  return text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}
