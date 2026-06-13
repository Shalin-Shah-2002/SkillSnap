# YouTube Skill Maker

Turn captioned YouTube videos into editable AI skill ZIPs for Codex and Claude.

This Chrome MV3 extension reads a YouTube video's transcript, asks Gemini to turn the video into a reusable skill, then lets you review and download two ZIP packages:

- a Codex-friendly skill package
- a Claude-friendly skill package

Each generated ZIP now includes:

- `SKILL.md`
- `references/video-summary.md`
- `references/full-transcript.md`

## What It Does

The extension is designed for fast skill creation from educational or workflow-heavy YouTube videos.

Typical flow:

1. Open a YouTube video with captions.
2. Capture the transcript from YouTube.
3. Send the transcript and video metadata to Gemini.
4. Generate a structured skill draft.
5. Let the user review and edit the generated files.
6. Download ready-to-use ZIP packages for Codex and Claude.

## Features

- Works on YouTube watch pages and Shorts
- Generates both Codex and Claude skill packages
- Uses Gemini Flash models for generation
- Lets users edit generated skill content before download
- Includes a brief source summary file
- Includes the full captured transcript in every ZIP
- Uses multiple transcript fallback strategies for better YouTube compatibility
- **Skill Library** — every successful generation is auto-saved in `chrome.storage.local`; revisit, re-download, regenerate, or delete from the popup History drawer or the options page (per-row actions). Configurable soft cap with FIFO eviction (default 50).
- **Copy Skill Prompt** — copy a self-contained prompt with the transcript and metadata already inlined. Paste it into Claude Code or Codex to generate the skill in your own CLI; no API key needed for this flow.

## Project Structure

High-level parts of the extension:

- `src/popup/` — popup UI for generation, editing, and downloading
- `src/options/` — settings page for Gemini key and model
- `src/background/` — runtime message handling and Gemini calls
- `src/content/` — YouTube transcript extraction logic
- `src/shared/` — shared types, prompts, and skill package formatting
- `public/manifest.json` — Chrome extension manifest
- `dist/` — built extension output for loading into Chrome

## How It Works

### 1. Transcript capture

When the user clicks `Make Skill`, the extension tries to read transcript data from the active YouTube tab.

It currently attempts several fallback paths:

- caption track files from YouTube
- transcript extraction from the page context
- transcript extraction from visible transcript UI
- YouTube internal transcript endpoint as a last fallback

If all transcript strategies fail, generation stops with an error.

### 2. Skill generation

Once a transcript is captured, the extension sends:

- video title
- channel name
- video URL
- caption language
- transcript text

to the Gemini API and asks for structured JSON that describes a reusable skill.

### 3. Package building

The returned draft is normalized into two final packages:

- Codex package
- Claude package

Each package gets:

- a platform-specific `SKILL.md`
- a short reference summary
- the complete transcript as a separate markdown file

### 4. ZIP download

The popup generates a ZIP file in-browser using `jszip` and downloads it locally.

## Output Format

Each generated ZIP is structured like this:

```text
skill-name/
  SKILL.md
  references/
    video-summary.md
    full-transcript.md
```

### `SKILL.md`

Contains the main reusable skill instructions.

### `references/video-summary.md`

Contains:

- short AI-generated summary
- source metadata
- reference notes

### `references/full-transcript.md`

Contains:

- source metadata
- the full captured transcript exactly as stored in memory

## Setup

### Requirements

- Node.js
- npm
- Google Gemini API key
- Chrome or another Chromium-based browser with extension support

### Install dependencies

```sh
npm install
```

### Build the extension

```sh
npm run build
```

### Development watch mode

```sh
npm run dev
```

### Run tests

```sh
npm test
```

### Run type checking

```sh
npm run typecheck
```

## Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the project's `dist` folder

After rebuilding, reload the extension from the extensions page before testing changes.

## Usage

1. Open the extension settings page
2. Paste a valid Gemini API key
3. Leave the model set to the recommended Flash model unless you have a specific reason to change it
4. Open a captioned YouTube video
5. Click the extension icon
6. Optionally enter a skill name hint
7. Click `Make Skill`
8. Review or edit the generated files
9. Download the Codex ZIP or Claude ZIP

## Recommended Gemini Model

Current default:

- `gemini-2.5-flash`

The extension also retries a small set of Flash-compatible fallback model names when needed.

## Security Notes

This project is currently positioned as a personal MVP.

Important notes:

- Gemini API keys are stored in Chrome local extension storage
- this is acceptable for personal use, but not ideal for a public/shared release
- users should restrict their API key if possible
- if a key is suspended, invalid, or denied, the extension now shows a safer error without exposing the full key

## Known Limitations

- Some YouTube videos do not expose usable captions
- YouTube transcript UI can change and break selectors
- Region-locked, age-restricted, or otherwise protected videos may fail
- Gemini output quality depends on transcript quality
- Very long transcripts may be trimmed for the Gemini prompt, even though the full captured transcript is still packaged in the ZIP
- This is not a server-backed product yet; everything runs locally in the extension

## Troubleshooting

### “Captions were found, but YouTube returned empty caption files...”

Possible causes:

- YouTube changed the transcript UI
- transcript endpoint rejected the request
- the video captions are present but not readable through current fallbacks

Try:

- refreshing the YouTube tab
- reloading the extension
- trying another video with normal captions

### “This Gemini API key has been suspended”

That is a Google-side issue, not a local code issue.

Fix:

1. create a new active Gemini API key
2. open extension settings
3. replace the old key
4. try again

### “Invalid API key”

Make sure:

- the key is copied correctly
- the key is active
- the key is allowed to use the Gemini API

## Best Video Types for This Tool

This extension works best on videos that teach:

- repeatable workflows
- debugging methods
- coding processes
- growth tactics
- product strategy
- operational playbooks
- design systems
- marketing frameworks

It works less well for:

- entertainment videos
- vague opinion pieces
- heavily visual tutorials with little spoken explanation

## Suggested Product Names

If you want to rename the extension, here are strong options:

### Clear and practical

- SkillTube
- YouTube Skill Maker
- Video Skill Builder
- Transcript to Skill
- Skill ZIP Generator

### More productized

- SkillForge
- SkillMint
- PromptCraft Video
- Agent Skill Studio
- WorkflowTube

### Best picks

If you want my strongest recommendations:

- `SkillForge` — strongest product name
- `SkillTube` — simple and memorable
- `Transcript to Skill` — clearest descriptive name
- `Agent Skill Studio` — best if you want a more premium tool feel

## Version

Current manifest version:

- `0.1.0`

## License / Status

This repository currently reads like a personal MVP / internal tool project.

If you plan to publish it publicly, the next good improvements would be:

- safer key handling
- clearer failure diagnostics
- richer preview for transcript and summary files
- stronger branding and onboarding
