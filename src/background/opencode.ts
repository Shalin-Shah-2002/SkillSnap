import { parseSkillDraftJson, redactApiKey } from "../shared/parseSkillJson";
import { buildSkillGenerationPrompt } from "../shared/skillPrompt";
import { DEFAULT_OPENCODE_FALLBACK_MODELS } from "../shared/settings";
import { OPENCODE_GO_MODELS, OPENCODE_ZEN_MODELS, type ModelOption, type ProviderGenerateParams, type ProviderId, type SkillProvider } from "../shared/providers";
import type { SkillDraft, VideoContext } from "../shared/types";

const OPENCODE_BASE_URL = "https://opencode.ai/zen/v1";
const OPENCODE_KEY_PATTERN = /sk-[A-Za-z0-9_\-]{16,}|oc-[A-Za-z0-9_\-]{16,}/g;

type OpenCodeEndpointKind = "openai" | "openai-responses" | "anthropic" | "google";

function classifyEndpoint(model: string): OpenCodeEndpointKind {
  const lower = model.toLowerCase();
  if (lower.startsWith("gpt-") || lower.startsWith("o1") || lower.startsWith("o3") || lower.startsWith("o4")) {
    return "openai-responses";
  }
  if (lower.startsWith("claude-")) {
    return "anthropic";
  }
  if (lower.startsWith("gemini-")) {
    return "google";
  }
  return "openai";
}

export class OpenCodeZenProvider implements SkillProvider {
  readonly id = "opencode-zen" as const;
  readonly displayName = "OpenCode Zen";
  readonly defaultModel = "gpt-5-nano";
  readonly placeholderKey = "oc-...";
  readonly keyHintUrl = "https://opencode.ai/auth";
  readonly endpointHint = "opencode.ai/zen/v1";
  readonly keyPattern = OPENCODE_KEY_PATTERN;
  readonly models: ModelOption[] = OPENCODE_ZEN_MODELS;

  getCandidateModels(inputModel: string): string[] {
    const normalizedInput = inputModel.trim();
    if (!normalizedInput) {
      return [...DEFAULT_OPENCODE_FALLBACK_MODELS];
    }
    return Array.from(new Set([normalizedInput, ...DEFAULT_OPENCODE_FALLBACK_MODELS]));
  }

  generateDraft(params: ProviderGenerateParams): Promise<Partial<SkillDraft>> {
    return runOpenCodeDraft(params, this.id);
  }
}

export class OpenCodeGoProvider implements SkillProvider {
  readonly id = "opencode-go" as const;
  readonly displayName = "OpenCode Go";
  readonly defaultModel = "gpt-5-nano";
  readonly placeholderKey = "oc-...";
  readonly keyHintUrl = "https://opencode.ai/auth";
  readonly endpointHint = "opencode.ai/zen/v1 (Go subscription)";
  readonly keyPattern = OPENCODE_KEY_PATTERN;
  readonly models: ModelOption[] = OPENCODE_GO_MODELS;

  getCandidateModels(inputModel: string): string[] {
    const normalizedInput = inputModel.trim();
    if (!normalizedInput) {
      return [...DEFAULT_OPENCODE_FALLBACK_MODELS];
    }
    return Array.from(new Set([normalizedInput, ...DEFAULT_OPENCODE_FALLBACK_MODELS]));
  }

  generateDraft(params: ProviderGenerateParams): Promise<Partial<SkillDraft>> {
    return runOpenCodeDraft(params, this.id);
  }
}

async function runOpenCodeDraft(
  params: ProviderGenerateParams,
  _tier: ProviderId
): Promise<Partial<SkillDraft>> {
  const { apiKey, model, video, preferredSkillName } = params;
  const prompt = buildSkillGenerationPrompt(video, preferredSkillName);
  const kind = classifyEndpoint(model);

  switch (kind) {
    case "openai-responses":
      return requestOpenAIResponses({ apiKey, model, prompt });
    case "anthropic":
      return requestAnthropic({ apiKey, model, prompt });
    case "google":
      return requestGoogle({ apiKey, model, prompt });
    case "openai":
    default:
      return requestChatCompletions({ apiKey, model, prompt });
  }
}

async function requestChatCompletions(params: {
  apiKey: string;
  model: string;
  prompt: string;
}): Promise<Partial<SkillDraft>> {
  const response = await fetch(`${OPENCODE_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`
    },
    body: JSON.stringify({
      model: params.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: params.prompt }]
    })
  });

  return parseChatResponse(response);
}

export async function testApiKey(apiKey: string): Promise<{ ok: boolean; message: string; model: string }> {
  const models = ["gpt-5-nano", "claude-haiku-4-5", "kimi-k2.6"];
  for (const model of models) {
    try {
      const response = await fetch(`${OPENCODE_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 10,
          messages: [{ role: "user", content: "hi" }]
        })
      });

      if (response.ok) {
        return { ok: true, message: `Key works with model: ${model}`, model };
      }

      const textBody = await response.text();
      let payload: { error?: { message?: string } } = {};
      try { payload = JSON.parse(textBody); } catch {}
      const errorMsg = payload.error?.message || textBody.slice(0, 200);

      if (response.status === 401) {
        return { ok: false, message: `401 Unauthorized: ${errorMsg}`, model };
      }

      if (response.status === 404 || errorMsg.toLowerCase().includes("not found") || errorMsg.toLowerCase().includes("model_not_found")) {
        continue;
      }

      return { ok: false, message: `${response.status}: ${errorMsg}`, model };
    } catch (err) {
      return { ok: false, message: `Network error: ${err instanceof Error ? err.message : String(err)}`, model };
    }
  }
  return { ok: false, message: "No accessible models found. Check your key at opencode.ai/auth", model: "" };
}

async function requestOpenAIResponses(params: {
  apiKey: string;
  model: string;
  prompt: string;
}): Promise<Partial<SkillDraft>> {
  const response = await fetch(`${OPENCODE_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`
    },
    body: JSON.stringify({
      model: params.model,
      temperature: 0.2,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: params.prompt }]
        }
      ],
      text: { format: { type: "json_object" } }
    })
  });

  return parseOpenAIResponsesResponse(response);
}

async function requestAnthropic(params: {
  apiKey: string;
  model: string;
  prompt: string;
}): Promise<Partial<SkillDraft>> {
  const response = await fetch(`${OPENCODE_BASE_URL}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": params.apiKey,
      "anthropic-version": "2023-06-01",
      Authorization: `Bearer ${params.apiKey}`
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: 4096,
      temperature: 0.2,
      system: "You are a JSON generator. Return only valid JSON, no markdown fences.",
      messages: [{ role: "user", content: params.prompt }]
    })
  });

  return parseAnthropicResponse(response);
}

async function requestGoogle(params: {
  apiKey: string;
  model: string;
  prompt: string;
}): Promise<Partial<SkillDraft>> {
  const endpoint = `${OPENCODE_BASE_URL}/models/${encodeURIComponent(params.model)}:generateContent`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": params.apiKey,
      Authorization: `Bearer ${params.apiKey}`
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: params.prompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json"
      }
    })
  });

  return parseGoogleResponse(response);
}

interface OpenCodeErrorPayload {
  error?: { message?: string; code?: string; type?: string };
  message?: string;
}

async function parseChatResponse(response: Response): Promise<Partial<SkillDraft>> {
  const rawText = await response.text();
  let payload: {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  } = {};
  try {
    payload = JSON.parse(rawText);
  } catch {
    console.log(`[opencode] Failed to parse response as JSON: ${rawText.slice(0, 200)}`);
  }

  if (!response.ok) {
    console.log(`[opencode] API error: status=${response.status}, message=${payload.error?.message || rawText.slice(0, 200) || 'unknown'}`);
    throw new Error(normalizeOpenCodeError((payload as OpenCodeErrorPayload).error?.message, response.status));
  }

  const text = payload.choices?.[0]?.message?.content;
  if (!text?.trim()) {
    throw new Error("OpenCode returned an empty response.");
  }
  return parseSkillDraftJson(text);
}

async function parseOpenAIResponsesResponse(response: Response): Promise<Partial<SkillDraft>> {
  const payload = (await response.json()) as {
    output?: Array<{
      content?: Array<{ type?: string; text?: string }>;
    }>;
    output_text?: string;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(normalizeOpenCodeError(payload.error?.message, response.status));
  }

  let text = payload.output_text;
  if (!text && Array.isArray(payload.output)) {
    text = payload.output
      .flatMap((item) => item.content || [])
      .filter((part) => part.type === "output_text" || typeof part.text === "string")
      .map((part) => part.text || "")
      .join("");
  }

  if (!text?.trim()) {
    throw new Error("OpenCode returned an empty response.");
  }
  return parseSkillDraftJson(text);
}

async function parseAnthropicResponse(response: Response): Promise<Partial<SkillDraft>> {
  const payload = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(normalizeOpenCodeError(payload.error?.message, response.status));
  }

  const text = (payload.content || [])
    .filter((part) => part.type === "text" || typeof part.text === "string")
    .map((part) => part.text || "")
    .join("");

  if (!text.trim()) {
    throw new Error("OpenCode returned an empty response.");
  }
  return parseSkillDraftJson(text);
}

async function parseGoogleResponse(response: Response): Promise<Partial<SkillDraft>> {
  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(normalizeOpenCodeError(payload.error?.message, response.status));
  }

  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
  if (!text?.trim()) {
    throw new Error("OpenCode returned an empty response.");
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

export function normalizeOpenCodeError(message: string | undefined, status: number): string {
  const safe = redactApiKey(message || "", OPENCODE_KEY_PATTERN).trim();
  const lower = safe.toLowerCase();

  if (status === 401 || lower.includes("unauthorized") || lower.includes("invalid api key")) {
    return "This OpenCode API key is invalid. Open Settings and paste a valid OpenCode key from opencode.ai/auth.";
  }

  if (status === 403 || lower.includes("forbidden") || lower.includes("permission")) {
    return "OpenCode rejected this API key. Check that the key is active and has access to the chosen model.";
  }

  if (status === 404 || lower.includes("not found") || lower.includes("model_not_found")) {
    return "OpenCode does not recognize this model. Try a different model in Settings.";
  }

  if (status === 429 || lower.includes("rate limit")) {
    return "OpenCode rate-limited this request. Wait a moment and try again.";
  }

  if (status === 402 || lower.includes("insufficient") || lower.includes("billing")) {
    return "OpenCode reported a billing or credit issue. Top up your OpenCode account, then try again.";
  }

  return safe || `OpenCode request failed with ${status}.`;
}
