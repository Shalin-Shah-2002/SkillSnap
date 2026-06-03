import type { GeneratedSkills, SkillDraft, SkillPackage, VideoContext } from "./types";

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
    `Use when an agent needs to apply the method or knowledge from "${video.title}".`
  );

  return {
    skillName,
    displayName,
    description: oneLine(description).slice(0, 220),
    triggerGuidance: firstText(raw.triggerGuidance, description),
    workflow: normalizeList(raw.workflow, FALLBACK_WORKFLOW),
    importantDetails: normalizeList(raw.importantDetails, [
      "Use the source notes as grounding material and avoid adding unsupported details."
    ]),
    limitations: normalizeList(raw.limitations, [
      "This skill is grounded in captions from a single YouTube video."
    ]),
    videoSummary: firstText(raw.videoSummary, `Source video: ${video.title} by ${video.channel}.`),
    referenceNotes: normalizeList(raw.referenceNotes, [
      "Review the source metadata and transcript-derived summary before applying the workflow."
    ])
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

## Important Details

${bulletList(draft.importantDetails)}

## Limitations

${bulletList(draft.limitations)}

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

## Source-Grounded Notes

${bulletList(draft.importantDetails)}

## Boundaries

${bulletList(draft.limitations)}

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

function titleCase(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
