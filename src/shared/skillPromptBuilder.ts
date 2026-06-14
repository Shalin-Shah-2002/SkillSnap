import { trimTranscript } from "./skillPrompt";
import type { VideoContext } from "./types";

export const MAX_TRANSCRIPT_CHARS_FOR_PROMPT = 90000;

export interface SkillPromptBuilderOptions {
  maxTranscriptChars?: number;
}

export function buildSkillPrompt(video: VideoContext, options: SkillPromptBuilderOptions = {}): string {
  const maxChars = options.maxTranscriptChars ?? MAX_TRANSCRIPT_CHARS_FOR_PROMPT;
  const transcriptResult = trimTranscriptWithMarker(video.transcript, maxChars);
  const language = video.captionLanguage?.trim() || "unknown";

  return [
    "You generate a reusable AI agent skill from a YouTube video transcript.",
    "",
    "Return only valid JSON. Do not wrap it in markdown fences.",
    "",
    "Source video:",
    `- Title: ${video.title || "(unknown)"}`,
    `- Channel: ${video.channel || "(unknown)"}`,
    `- URL: ${video.url || "(unknown)"}`,
    `- Caption language: ${language}`,
    "",
    "Full transcript:",
    transcriptResult.text,
    "",
    "Create one source skill concept that can be rendered into both Codex and Claude skill packages. The generated skill must teach an AI agent how to perform the method, workflow, or domain task shown in the video. It must not merely summarize the video.",
    "",
    "Use this exact JSON shape:",
    "{",
    '  "skillName": "kebab-case-name",',
    '  "displayName": "Human readable skill name",',
    '  "description": "One concise trigger description for when an agent should use this skill.",',
    '  "triggerGuidance": "A concise paragraph explaining when to use this skill.",',
    '  "workflow": ["ordered step", "ordered step"],',
    '  "importantDetails": ["durable technique, rule, checklist item, or concept"],',
    '  "limitations": ["when not to use this skill or what the transcript did not establish"],',
    '  "videoSummary": "Short factual source summary.",',
    '  "referenceNotes": ["source-derived supporting note", "source-derived supporting note"]',
    "}",
    "",
    "Rules:",
    "- Keep skillName kebab-case, lowercase, under 48 characters.",
    "- Base the skill only on the transcript and metadata.",
    "- If the transcript is thin, say so in limitations instead of inventing facts.",
    "- Make workflow steps actionable for agents like Codex and Claude.",
    "- Keep description under 180 characters.",
    "- Avoid references to \"this video\" in the main workflow; the skill should stand alone.",
    "",
    "Output packaging (handled outside this prompt by the SkillSnap extension):",
    "The JSON you return will be turned into a skill ZIP containing:",
    "- <skillName>/SKILL.md",
    "- <skillName>/references/video-summary.md",
    "- <skillName>/references/full-transcript.md",
    "",
    "Make sure the JSON you return produces a complete, self-contained skill that can be dropped into Codex or Claude Code without further editing."
  ].join("\n");
}

export interface TrimResult {
  text: string;
  trimmed: boolean;
  originalLength: number;
  finalLength: number;
}

export function trimTranscriptWithMarker(transcript: string, maxChars: number): TrimResult {
  if (!transcript) {
    return { text: "", trimmed: false, originalLength: 0, finalLength: 0 };
  }
  if (transcript.length <= maxChars) {
    return { text: transcript, trimmed: false, originalLength: transcript.length, finalLength: transcript.length };
  }
  const trimmed = trimTranscript(transcript, maxChars);
  return { text: trimmed, trimmed: true, originalLength: transcript.length, finalLength: trimmed.length };
}
