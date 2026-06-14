import { describe, expect, it } from "vitest";
import {
  aggregateReviewSummary,
  createReviewSession,
  improveReviewSession,
  runReviewSession,
  type ReviewTextGenerator
} from "./skillReviewEngine";
import type { SkillLibraryEntry } from "../shared/skillLibrary";

const entry: SkillLibraryEntry = {
  id: "entry-a",
  createdAt: "2026-06-01T00:00:00.000Z",
  videoUrl: "https://www.youtube.com/watch?v=abc",
  videoTitle: "Build Better Skills",
  channelName: "Test Channel",
  skillName: "better-skills",
  displayName: "Better Skills",
  model: "gemini/gemini-2.5-flash",
  files: {
    codex: {
      skill: "---\nname: better-skills\ndescription: Use when making better skills.\n---\n# Better Skills\n",
      reference: "# Video Summary\nMake better skills.",
      transcript: "# Full Transcript\nMake better skills."
    },
    claude: {
      skill: "---\nname: better-skills\ndescription: Use when making better skills.\n---\n# Better Skills\n",
      reference: "# Video Summary\nMake better skills.",
      transcript: "# Full Transcript\nMake better skills."
    }
  },
  transcript: "Make better skills.",
  generatedVia: "extension"
};

describe("skillReviewEngine", () => {
  it("creates, runs, grades, summarizes, and improves a review session", async () => {
    const generator: ReviewTextGenerator = async (prompt, options) => {
      if (options?.json && prompt.includes("Create lightweight text/markdown evaluation cases")) {
        return {
          text: JSON.stringify({
            evals: [
              {
                name: "Checklist response",
                prompt: "Turn this method into a checklist.",
                expectedOutput: "A checklist with assumptions.",
                assertions: ["Includes a checklist.", "Mentions assumptions."]
              }
            ]
          }),
          durationMs: 10,
          totalTokens: 100
        };
      }
      if (options?.json && prompt.includes("Grade this output")) {
        const passed = prompt.includes("- [ ]") || prompt.includes("Assumption");
        return {
          text: JSON.stringify({
            expectations: [
              { text: "Includes a checklist.", passed, evidence: passed ? "Checklist found." : "No checklist." },
              { text: "Mentions assumptions.", passed, evidence: passed ? "Assumption found." : "No assumption." }
            ],
            summary: passed ? "Looks good." : "Needs work."
          }),
          durationMs: 7,
          totalTokens: 80
        };
      }
      if (options?.json && prompt.includes("Improve this SKILL.md")) {
        return {
          text: JSON.stringify({
            proposedSkillMd:
              "---\nname: better-skills\ndescription: Use when making better skills with eval-ready outputs.\n---\n# Better Skills\n\n## Expected Output\nA checklist.",
            rationale: "Clarified output expectations."
          }),
          durationMs: 12,
          totalTokens: 120
        };
      }
      return {
        text: prompt.includes("provided skill") ? "- [ ] Step one\n\nAssumption: test context." : "Here is a generic answer.",
        durationMs: 9,
        totalTokens: 60
      };
    };

    const session = await createReviewSession(entry, "codex", {
      generateText: generator,
      now: () => new Date("2026-06-01T00:00:00.000Z"),
      idFactory: () => "rev-test"
    });
    expect(session.id).toBe("rev-test");
    expect(session.cases).toHaveLength(1);

    const completed = await runReviewSession(session, entry, {
      generateText: generator,
      now: () => new Date("2026-06-01T00:00:01.000Z")
    });
    expect(completed.runs).toHaveLength(2);
    expect(completed.grades).toHaveLength(2);
    expect(completed.summary?.withSkillPassRate).toBe(1);
    expect(completed.summary?.baselinePassRate).toBe(0);

    const improved = await improveReviewSession(completed, entry, {
      generateText: generator,
      now: () => new Date("2026-06-01T00:00:02.000Z")
    });
    expect(improved.status).toBe("improved");
    expect(improved.improvement?.proposedSkillMd).toContain("## Expected Output");
  });

  it("aggregates missing grades as zero without failing", () => {
    const summary = aggregateReviewSummary([], [], []);
    expect(summary.baselinePassRate).toBe(0);
    expect(summary.withSkillPassRate).toBe(0);
    expect(summary.passRateDelta).toBe(0);
  });
});
