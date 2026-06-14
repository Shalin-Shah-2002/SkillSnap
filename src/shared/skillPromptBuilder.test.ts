import { describe, expect, it } from "vitest";
import { buildSkillPrompt, MAX_TRANSCRIPT_CHARS_FOR_PROMPT, trimTranscriptWithMarker } from "./skillPromptBuilder";
import type { VideoContext } from "./types";

const sampleVideo: VideoContext = {
  videoId: "abc123",
  url: "https://www.youtube.com/watch?v=abc123",
  title: "Build Better Agents",
  channel: "Example Channel",
  transcript: "Step one: define the workflow.\nStep two: turn it into reusable instructions.",
  transcriptSource: "YouTube captions",
  captionLanguage: "en",
  capturedAt: "2026-05-31T00:00:00.000Z"
};

describe("skillPromptBuilder", () => {
  it("returns a non-empty string", () => {
    const prompt = buildSkillPrompt(sampleVideo);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("contains the video title, channel, and url", () => {
    const prompt = buildSkillPrompt(sampleVideo);
    expect(prompt).toContain("Title: Build Better Agents");
    expect(prompt).toContain("Channel: Example Channel");
    expect(prompt).toContain("URL: https://www.youtube.com/watch?v=abc123");
  });

  it("contains the inlined transcript (not a marker)", () => {
    const prompt = buildSkillPrompt(sampleVideo);
    expect(prompt).toContain("Step one: define the workflow.");
    expect(prompt).not.toContain("<<<TRANSCRIPT>>>");
    expect(prompt).not.toContain("{{TRANSCRIPT}}");
  });

  it("falls back to 'unknown' when captionLanguage is missing", () => {
    const prompt = buildSkillPrompt({ ...sampleVideo, captionLanguage: undefined });
    expect(prompt).toContain("Caption language: unknown");
  });

  it("falls back to '(unknown)' when channel and url are empty", () => {
    const prompt = buildSkillPrompt({ ...sampleVideo, channel: "", url: "" });
    expect(prompt).toContain("Channel: (unknown)");
    expect(prompt).toContain("URL: (unknown)");
  });

  it("contains the JSON shape spec", () => {
    const prompt = buildSkillPrompt(sampleVideo);
    for (const field of [
      "skillName",
      "displayName",
      "description",
      "triggerGuidance",
      "outputFormat",
      "workflow",
      "importantDetails",
      "examples",
      "limitations",
      "videoSummary",
      "referenceNotes",
      "starterEvalCases"
    ]) {
      expect(prompt).toContain(`"${field}"`);
    }
  });

  it("includes skill-creator guidance and preferred skill names", () => {
    const prompt = buildSkillPrompt(sampleVideo, { preferredSkillName: "agent-review-loop" });
    expect(prompt).toContain("Use the skill-creator style");
    expect(prompt).toContain("Preferred skill name: agent-review-loop");
    expect(prompt).toContain("progressive disclosure");
    expect(prompt).toContain("Starter eval cases");
  });

  it("contains the output packaging instructions", () => {
    const prompt = buildSkillPrompt(sampleVideo);
    expect(prompt).toContain("SKILL.md");
    expect(prompt).toContain("references/video-summary.md");
    expect(prompt).toContain("references/full-transcript.md");
  });

  it("is never wrapped in markdown fences", () => {
    const prompt = buildSkillPrompt(sampleVideo);
    expect(prompt.startsWith("```")).toBe(false);
    expect(prompt.endsWith("```")).toBe(false);
  });

  it("trims very long transcripts and adds the marker", () => {
    const bigVideo: VideoContext = {
      ...sampleVideo,
      transcript: "x".repeat(200_000)
    };
    const result = trimTranscriptWithMarker(bigVideo.transcript, MAX_TRANSCRIPT_CHARS_FOR_PROMPT);
    expect(result.trimmed).toBe(true);
    expect(result.finalLength).toBeLessThan(200_000);
    expect(result.text).toContain("Transcript trimmed for length. Middle omitted.");
  });

  it("does not trim short transcripts", () => {
    const result = trimTranscriptWithMarker("short transcript", MAX_TRANSCRIPT_CHARS_FOR_PROMPT);
    expect(result.trimmed).toBe(false);
    expect(result.text).toBe("short transcript");
  });

  it("emits the trimmed marker into the final prompt for huge transcripts", () => {
    const bigVideo: VideoContext = {
      ...sampleVideo,
      transcript: "y".repeat(200_000)
    };
    const prompt = buildSkillPrompt(bigVideo);
    expect(prompt).toContain("Transcript trimmed for length. Middle omitted.");
  });

  it("respects a custom max transcript length", () => {
    const prompt = buildSkillPrompt(sampleVideo, { maxTranscriptChars: 10 });
    expect(prompt).toContain("Transcript trimmed for length. Middle omitted.");
  });
});
