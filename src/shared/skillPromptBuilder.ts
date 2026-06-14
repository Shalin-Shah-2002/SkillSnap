import type { VideoContext } from "./types";

export const MAX_TRANSCRIPT_CHARS_FOR_PROMPT = 90000;

export interface SkillPromptBuilderOptions {
  maxTranscriptChars?: number;
  preferredSkillName?: string;
}

export function buildSkillPrompt(video: VideoContext, options: SkillPromptBuilderOptions = {}): string {
  const maxChars = options.maxTranscriptChars ?? MAX_TRANSCRIPT_CHARS_FOR_PROMPT;
  const transcriptResult = trimTranscriptWithMarker(video.transcript, maxChars);
  const language = video.captionLanguage?.trim() || "unknown";
  const preferredName = options.preferredSkillName?.trim() || "derive a clear kebab-case name";

  return [
    "You generate reusable AI agent skills from a YouTube video transcript.",
    "",
    "Return only valid JSON. Do not wrap it in markdown fences.",
    "",
    "Source video:",
    `- Title: ${video.title || "(unknown)"}`,
    `- Channel: ${video.channel || "(unknown)"}`,
    `- URL: ${video.url || "(unknown)"}`,
    `- Caption language: ${language}`,
    `- Preferred skill name: ${preferredName}`,
    "",
    "Full transcript:",
    transcriptResult.text,
    "",
    "Create one source skill concept that can be rendered into both Codex and Claude skill packages. The generated skill must teach an AI agent how to perform the method, workflow, or domain task shown in the video. It must not merely summarize the video.",
    "",
    "Use the skill-creator style:",
    "- Capture what the skill enables, when it should trigger, expected outputs, success criteria, and boundaries.",
    "- Make the description a little pushy so agents use the skill when relevant, even if the user does not say the exact skill name.",
    "- Use progressive disclosure: keep SKILL.md self-contained and point to bundled references only when deeper source grounding is useful.",
    "- Explain why workflow steps matter instead of relying on rigid all-caps rules.",
    "- Include realistic examples and starter text/markdown eval cases when the transcript supports them.",
    "",
    "Use this exact JSON shape:",
    "{",
    '  "skillName": "kebab-case-name",',
    '  "displayName": "Human readable skill name",',
    '  "description": "Pushy one-sentence trigger description for when an agent should use this skill.",',
    '  "triggerGuidance": "A concise paragraph explaining when to use this skill.",',
    '  "outputFormat": "What the skill should usually produce, including format and level of detail.",',
    '  "workflow": ["ordered step", "ordered step"],',
    '  "importantDetails": ["durable technique, rule, checklist item, or concept"],',
    '  "examples": [{"input": "realistic user request", "output": "short example of the ideal response shape"}],',
    '  "limitations": ["when not to use this skill or what the transcript did not establish"],',
    '  "videoSummary": "Short factual source summary.",',
    '  "referenceNotes": ["source-derived supporting note", "source-derived supporting note"],',
    '  "starterEvalCases": [{"prompt": "realistic user task", "expectedOutput": "what a good answer should include", "assertions": ["objective check"]}]',
    "}",
    "",
    "Rules:",
    "- Keep skillName kebab-case, lowercase, under 48 characters.",
    "- Base the skill only on the transcript and metadata.",
    "- If the transcript is thin, say so in limitations instead of inventing facts.",
    "- Make workflow steps actionable for agents like Codex and Claude.",
    "- Keep description under 220 characters and start it with practical trigger language such as \"Use when\" or \"Use this skill when\".",
    "- Keep examples short enough to scan, but concrete enough to teach the expected shape.",
    "- Starter eval cases must be text/markdown tasks, not file-generation or external-tool tasks.",
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
  const trimmed = trimTranscriptForPrompt(transcript, maxChars);
  return { text: trimmed, trimmed: true, originalLength: transcript.length, finalLength: trimmed.length };
}

function trimTranscriptForPrompt(transcript: string, maxChars: number): string {
  const half = Math.floor(maxChars / 2);
  return [
    transcript.slice(0, half),
    "\n\n[Transcript trimmed for length. Middle omitted.]\n\n",
    transcript.slice(transcript.length - half)
  ].join("");
}
