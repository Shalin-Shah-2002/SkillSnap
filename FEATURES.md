# Planned Features

## 1. Skill History & Library

Store every generated skill in `chrome.storage` with a timestamp, source video URL, and the generated files. Add a "Past Skills" view inside the popup or options page that lets the user re-download or delete previously generated skills.

### Goals

- Stop losing generated skills after the browser session ends.
- Make it easy to revisit, re-download, or clean up past generations.
- Turn the extension from a one-shot generator into a reusable library.

### Data Model

Each stored skill entry should contain:

- `id` — unique identifier (timestamp + random suffix)
- `createdAt` — ISO timestamp of when the skill was generated
- `videoUrl` — source YouTube URL
- `videoTitle` — source video title
- `channelName` — source channel name
- `skillNameHint` — user-provided hint, if any
- `model` — Gemini model used for generation
- `files` — generated package files (`SKILL.md`, `references/video-summary.md`, `references/full-transcript.md`)
- `transcript` — the full captured transcript text
- `codexZip` — optional cached Codex ZIP blob
- `claudeZip` — optional cached Claude ZIP blob

### Storage Strategy

- Use `chrome.storage.local` to avoid sync quota limits.
- Store the full transcript and generated markdown files as text.
- Optionally store pre-built ZIP blobs as base64 or `Uint8Array` to allow one-click re-download without rebuilding.
- Enforce a soft cap (for example 50 entries) with FIFO eviction and a warning UI.

### UI Surfaces

- **Popup**: add a "History" tab or button that lists recent skills.
- **Options page**: add a dedicated "Skill Library" section showing all stored skills in a table or card list.
- **Entry actions**:
  - Re-download Codex ZIP
  - Re-download Claude ZIP
  - View generated files in a read-only modal
  - Copy skill name or video URL
  - Delete entry
  - Optional: "Regenerate" using the same transcript

### Edge Cases

- Storage quota exceeded → show a friendly error and suggest deleting old entries.
- Corrupted entry → skip and log, do not crash the library view.
- ZIP blob missing → rebuild on demand from stored `files`.

### Why This Matters

This solves the most common real-world frustration: a user generates a skill, closes the popup, and can no longer find the ZIP. The library makes the tool feel like a persistent workspace instead of a one-click utility.

---

## 3. Custom Prompt / Template System

Let users save, edit, and select prompt templates in the options page. Each template controls how Gemini is asked to turn a transcript into a skill. This is a major quality win for power users and differentiates the extension from a single-purpose Gemini call.

### Goals

- Allow users to specialize generation for different video types.
- Make prompt iteration fast without editing source code.
- Provide sensible defaults so new users still get good results.

### Template Shape

A template should contain:

- `id` — unique identifier
- `name` — short user-facing label (e.g. "Coding Workflows")
- `description` — one-line summary of when to use it
- `systemPrompt` — instructions for the model
- `userPromptTemplate` — template string with placeholders for transcript and metadata
- `isBuiltIn` — boolean, true for default templates shipped with the extension
- `createdAt` — ISO timestamp
- `updatedAt` — ISO timestamp

### Built-In Templates (Suggested Defaults)

- **General Skill** — current default behavior, balanced for most educational videos.
- **Coding Workflows** — emphasizes repeatable steps, tooling, and code patterns.
- **Marketing & Growth** — focuses on frameworks, tactics, and measurable plays.
- **Design Systems** — focuses on tokens, components, and decision rationale.
- **Product Strategy** — focuses on decisions, tradeoffs, and stakeholder context.

### Placeholders

The `userPromptTemplate` should support these placeholders:

- `{{videoTitle}}`
- `{{channelName}}`
- `{{videoUrl}}`
- `{{captionLanguage}}`
- `{{transcript}}`
- `{{skillNameHint}}` (optional)

### UI Surfaces

- **Options page**: new "Prompt Templates" section.
  - List of saved templates with edit, duplicate, delete, and set-as-default actions.
  - Built-in templates are read-only by default but can be duplicated.
  - Simple editor with a monospace textarea for prompts and a live placeholder reference.
- **Popup**: dropdown to pick the active template before clicking "Make Skill".
  - Persist last-used template per user.

### Storage Strategy

- Store all templates in `chrome.storage.local` under a single key.
- Merge built-in templates with user templates on read so updates ship cleanly.
- Validate templates before save (non-empty name, non-empty prompts).

### Migration

- On first run after this feature ships, create built-in templates if none exist.
- Existing users keep the current default behavior until they pick a different template.

### Why This Matters

A generic prompt works for most videos, but a coding tutorial and a marketing talk want very different output. Letting users tune the prompt turns Gemini from a one-size-fits-all call into a tool that adapts to the kind of content the user is learning from.
