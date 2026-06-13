import type { VideoContext } from "./types";

const MAX_TRANSCRIPT_CHARS = 90000;

export function trimTranscript(transcript: string, maxChars = MAX_TRANSCRIPT_CHARS): string {
  if (transcript.length <= maxChars) {
    return transcript;
  }

  const half = Math.floor(maxChars / 2);
  return [
    transcript.slice(0, half),
    "\n\n[Transcript trimmed for length. Middle omitted.]\n\n",
    transcript.slice(transcript.length - half)
  ].join("");
}

export function buildSkillGenerationPrompt(video: VideoContext, preferredSkillName?: string): string {
  const preferredName = preferredSkillName?.trim() || "derive a clear kebab-case name";

  return `You are generating reusable AI agent skills from a YouTube transcript.

Return only valid JSON. Do not wrap it in markdown fences.

Create one source skill concept that can be rendered into both Codex and Claude skill packages.
The generated skill must teach an AI agent how to perform the method, workflow, or domain task shown in the video. It must not merely summarize the video.

Use this exact JSON shape:
{
  "skillName": "kebab-case-name",
  "displayName": "Human readable skill name",
  "description": "One concise trigger description for when an agent should use this skill.",
  "triggerGuidance": "A concise paragraph explaining when to use this skill.",
  "workflow": ["ordered step", "ordered step"],
  "importantDetails": ["durable technique, rule, checklist item, or concept"],
  "limitations": ["when not to use this skill or what the transcript did not establish"],
  "videoSummary": "Short factual source summary.",
  "referenceNotes": ["source-derived supporting note", "source-derived supporting note"]
}

Rules:
- Keep skillName kebab-case, lowercase, under 48 characters.
- Preferred skill name: ${preferredName}
- Base the skill only on the transcript and metadata.
- If the transcript is thin, say so in limitations instead of inventing facts.
- Make workflow steps actionable for agents like Codex and Claude.
- Keep description under 180 characters.
- Avoid references to "this video" in the main workflow; the skill should stand alone.

Video metadata:
Title: ${video.title}
Channel: ${video.channel}
URL: ${video.url}
Caption language: ${video.captionLanguage || "unknown"}

Transcript:
${trimTranscript(video.transcript)}`;
}
