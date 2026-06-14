import type { VideoContext } from "./types";
import { buildSkillPrompt } from "./skillPromptBuilder";

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
  return buildSkillPrompt(video, { preferredSkillName });
}
