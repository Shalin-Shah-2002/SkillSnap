import type { SkillDraft } from "./types";

export function parseSkillDraftJson(text: string): Partial<SkillDraft> {
  const cleaned = stripJsonFence(text.trim());

  try {
    return JSON.parse(cleaned) as Partial<SkillDraft>;
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as Partial<SkillDraft>;
    }

    throw new Error("Model did not return valid skill JSON.");
  }
}

export function stripJsonFence(text: string): string {
  return text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export function redactApiKey(message: string, pattern: RegExp): string {
  return message.replace(pattern, "[redacted-api-key]");
}
