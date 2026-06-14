import { describe, expect, it } from "vitest";
import { buildSkillPackages, getPackageFiles, slugifySkillName } from "./skillFormat";
import type { VideoContext } from "./types";

const video: VideoContext = {
  videoId: "abc123",
  url: "https://www.youtube.com/watch?v=abc123",
  title: "Build Better Agents!",
  channel: "Example Channel",
  transcript: "[00:01] Start by defining the workflow.\n[00:05] Then turn it into reusable instructions.",
  transcriptSource: "YouTube captions",
  captionLanguage: "en",
  capturedAt: "2026-05-31T00:00:00.000Z"
};

describe("skillFormat", () => {
  it("creates stable kebab-case skill names", () => {
    expect(slugifySkillName("Build Better Agents!")).toBe("build-better-agents");
    expect(slugifySkillName("")).toBe("youtube-video-skill");
  });

  it("renders Codex and Claude skill packages with reference files", () => {
    const generated = buildSkillPackages(
      {
        skillName: "agent-workflow",
        displayName: "Agent Workflow",
        description: "Use when designing a repeatable agent workflow.",
        triggerGuidance: "Use this for repeatable agent workflows.",
        outputFormat: "Return a short Markdown plan with assumptions and next steps.",
        workflow: ["Define the outcome.", "Write the reusable procedure."],
        importantDetails: ["Keep the skill grounded."],
        examples: [{ input: "Make this repeatable.", output: "A concise reusable procedure." }],
        limitations: ["Do not invent missing source details."],
        videoSummary: "A short lesson about reusable workflows.",
        referenceNotes: ["The video emphasizes clear steps."],
        starterEvalCases: [
          {
            prompt: "Turn this messy process into a reusable agent workflow.",
            expectedOutput: "A workflow with assumptions and concrete steps.",
            assertions: ["Mentions assumptions.", "Includes ordered steps."]
          }
        ]
      },
      video
    );

    expect(generated.codex.skillMd).toContain("name: \"agent-workflow\"");
    expect(generated.codex.skillMd).toContain("## Expected Output");
    expect(generated.codex.skillMd).toContain("## Examples");
    expect(generated.codex.skillMd).toContain("## Progressive Disclosure");
    expect(generated.codex.skillMd).toContain("## Starter Eval Cases");
    expect(generated.claude.skillMd).toContain("## Process");
    expect(generated.codex.referenceMd).toContain("Build Better Agents!");
    expect(generated.codex.referenceMd).not.toContain(video.transcript);
    expect(generated.codex.transcriptMd).toContain("# Full Transcript");
    expect(generated.codex.transcriptMd).toContain(video.transcript);
    expect(generated.codex.skillMd).toContain("references/full-transcript.md");
    expect(generated.claude.skillMd).toContain("references/full-transcript.md");
    expect(Object.keys(getPackageFiles(generated.codex))).toEqual([
      "agent-workflow/SKILL.md",
      "agent-workflow/references/video-summary.md",
      "agent-workflow/references/full-transcript.md"
    ]);
  });
});
