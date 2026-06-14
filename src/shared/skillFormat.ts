import type { GeneratedSkills, SkillDraft, SkillDraftEvalCase, SkillExample, SkillPackage, VideoContext } from "./types";

const FALLBACK_WORKFLOW = [
  "Identify the user's task and confirm it matches the skill description.",
  "Apply the source-derived workflow and adapt it to the user's concrete context.",
  "Call out assumptions, limitations, and missing information before giving final output."
];

export function slugifySkillName(input: string, fallback = "youtube-video-skill"): string {
  const slug = input
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 48)
    .replace(/^-+|-+$/g, "");

  return slug || fallback;
}

export function normalizeDraft(raw: Partial<SkillDraft>, video: VideoContext): SkillDraft {
  const skillName = slugifySkillName(raw.skillName || video.title);
  const displayName = firstText(raw.displayName, titleCase(skillName));
  const description = firstText(
    raw.description,
    `Use when an agent needs to apply the method, workflow, or knowledge from "${video.title}".`
  );

  return {
    skillName,
    displayName,
    description: oneLine(description).slice(0, 220),
    triggerGuidance: firstText(raw.triggerGuidance, description),
    outputFormat: firstText(
      raw.outputFormat,
      "Produce concise Markdown that follows the user's requested format and makes the next action clear."
    ),
    workflow: normalizeList(raw.workflow, FALLBACK_WORKFLOW),
    importantDetails: normalizeList(raw.importantDetails, [
      "Use the source notes as grounding material and avoid adding unsupported details."
    ]),
    examples: normalizeExamples(raw.examples, [
      {
        input: "Apply this workflow to my current task.",
        output: "A concise Markdown response that follows the workflow, names assumptions, and gives concrete next steps."
      }
    ]),
    limitations: normalizeList(raw.limitations, [
      "This skill is grounded in captions from a single YouTube video."
    ]),
    videoSummary: firstText(raw.videoSummary, `Source video: ${video.title} by ${video.channel}.`),
    referenceNotes: normalizeList(raw.referenceNotes, [
      "Review the source metadata and transcript-derived summary before applying the workflow."
    ]),
    starterEvalCases: normalizeEvalCases(raw.starterEvalCases)
  };
}

export function buildSkillPackages(raw: Partial<SkillDraft>, video: VideoContext): GeneratedSkills {
  const draft = normalizeDraft(raw, video);
  const referenceMd = buildReferenceMarkdown(draft, video);
  const transcriptMd = buildTranscriptMarkdown(video);

  return {
    sourceVideo: video,
    draft,
    codex: {
      skillName: draft.skillName,
      skillMd: buildCodexSkillMarkdown(draft),
      referenceMd,
      transcriptMd
    },
    claude: {
      skillName: draft.skillName,
      skillMd: buildClaudeSkillMarkdown(draft),
      referenceMd,
      transcriptMd
    }
  };
}

export function buildCodexSkillMarkdown(draft: SkillDraft): string {
  return `---
name: ${yamlString(draft.skillName)}
description: ${yamlString(draft.description)}
metadata:
  short-description: ${yamlString(draft.displayName)}
---

# ${draft.displayName}

## When To Use

${draft.triggerGuidance}

## Workflow

${numberedList(draft.workflow)}

## Expected Output

${draft.outputFormat}

## Important Details

${bulletList(draft.importantDetails)}

## Examples

${exampleList(draft.examples)}

## Progressive Disclosure

Start with this \`SKILL.md\`. Read \`references/video-summary.md\` when you need source-derived context, and read \`references/full-transcript.md\` only when the summary is not enough or the user asks for deeper grounding.

## Limitations

${bulletList(draft.limitations)}

${starterEvalSection(draft.starterEvalCases)}

## Source Reference

When source grounding matters, read \`references/video-summary.md\` for the brief summary and \`references/full-transcript.md\` for the full transcript.
`;
}

export function buildClaudeSkillMarkdown(draft: SkillDraft): string {
  return `---
name: ${yamlString(draft.skillName)}
description: ${yamlString(draft.description)}
---

# ${draft.displayName}

## When To Use

${draft.triggerGuidance}

## Process

${numberedList(draft.workflow)}

## Expected Output

${draft.outputFormat}

## Source-Grounded Notes

${bulletList(draft.importantDetails)}

## Examples

${exampleList(draft.examples)}

## Progressive Disclosure

Start with this \`SKILL.md\`. Use \`references/video-summary.md\` for source-derived context, and open \`references/full-transcript.md\` only when the summary is not enough or the user asks for deeper grounding.

## Boundaries

${bulletList(draft.limitations)}

${starterEvalSection(draft.starterEvalCases)}

## Reference

Use \`references/video-summary.md\` for the brief summary and \`references/full-transcript.md\` for the full transcript.
`;
}

export function buildReferenceMarkdown(draft: SkillDraft, video: VideoContext): string {
  return `# Video Summary

${draft.videoSummary}

## Source

- Title: ${video.title}
- Channel: ${video.channel}
- URL: ${video.url}
- Video ID: ${video.videoId}
- Caption source: ${video.transcriptSource}
- Caption language: ${video.captionLanguage || "unknown"}
- Captured at: ${video.capturedAt}

## Reference Notes

${bulletList(draft.referenceNotes)}
`;
}

export function buildTranscriptMarkdown(video: VideoContext): string {
  return `# Full Transcript

## Source

- Title: ${video.title}
- Channel: ${video.channel}
- URL: ${video.url}
- Video ID: ${video.videoId}
- Caption source: ${video.transcriptSource}
- Caption language: ${video.captionLanguage || "unknown"}
- Captured at: ${video.capturedAt}

## Transcript

${video.transcript}
`;
}

export function getPackageFiles(pkg: SkillPackage): Record<string, string> {
  return {
    [`${pkg.skillName}/SKILL.md`]: pkg.skillMd,
    [`${pkg.skillName}/references/video-summary.md`]: pkg.referenceMd,
    [`${pkg.skillName}/references/full-transcript.md`]: pkg.transcriptMd
  };
}

function normalizeList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const cleaned = value.map((item) => oneLine(String(item))).filter(Boolean);
  return cleaned.length > 0 ? cleaned : fallback;
}

function normalizeExamples(value: unknown, fallback: SkillExample[]): SkillExample[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const examples = value
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }
      const input = firstText(item.input, "");
      const output = firstText(item.output, "");
      if (!input || !output) {
        return null;
      }
      return { input, output };
    })
    .filter((item): item is SkillExample => Boolean(item));
  return examples.length > 0 ? examples.slice(0, 4) : fallback;
}

function normalizeEvalCases(value: unknown): SkillDraftEvalCase[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }
      const prompt = firstText(item.prompt, "");
      const expectedOutput = firstText(item.expectedOutput, "");
      const assertions = normalizeList(item.assertions, []);
      if (!prompt || !expectedOutput || assertions.length === 0) {
        return null;
      }
      return { prompt, expectedOutput, assertions: assertions.slice(0, 5) };
    })
    .filter((item): item is SkillDraftEvalCase => Boolean(item))
    .slice(0, 4);
}

function firstText(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const cleaned = value.trim();
  return cleaned || fallback;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function yamlString(value: string): string {
  return JSON.stringify(oneLine(value));
}

function bulletList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function numberedList(items: string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

function exampleList(items: SkillExample[]): string {
  return items
    .map(
      (item, index) => `**Example ${index + 1}:**\nInput: ${item.input}\nOutput: ${item.output}`
    )
    .join("\n\n");
}

function starterEvalSection(items: SkillDraftEvalCase[]): string {
  if (items.length === 0) {
    return "";
  }
  const body = items
    .map((item, index) => {
      return [
        `**Eval ${index + 1}:** ${item.prompt}`,
        `Expected: ${item.expectedOutput}`,
        "Checks:",
        bulletList(item.assertions)
      ].join("\n");
    })
    .join("\n\n");
  return `## Starter Eval Cases\n\n${body}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function titleCase(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
