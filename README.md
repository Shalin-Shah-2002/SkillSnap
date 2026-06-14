# SkillSnap

<p align="left">
  <img src="public/logo-128.png" alt="SkillSnap logo" width="128" />
</p>

SkillSnap is a Chrome extension that turns captioned YouTube videos into editable Codex and Claude skill ZIPs using the Google Gemini API.

It captures the transcript from the active YouTube tab, asks Gemini to turn the video into a reusable skill, and gives you a clean review step before download.

## What It Does

SkillSnap is built for educational videos, tutorials, and repeatable workflows.

Typical flow:

1. Open a YouTube video with captions.
2. Click the extension icon.
3. Capture the transcript from the active tab.
4. Send the transcript and video metadata to Google Gemini.
5. Generate a structured skill draft.
6. Review or edit the generated files.
7. Download ready-to-use ZIP packages for Codex and Claude.

## Key Features

- Works on YouTube watch pages and Shorts
- Uses the Google Gemini API for skill generation
- Generates both Codex and Claude skill packages
- Lets you edit the generated content before download
- Includes a source summary file and the full captured transcript in every ZIP
- Uses multiple transcript fallback strategies for better YouTube compatibility
- Saves every successful generation to a local Skill Library
- Lets you reopen, regenerate, re-download, copy the source URL, or delete past entries
- Includes a Copy Skill Prompt flow that works without an API key

## What Gets Generated

Each ZIP contains:

```text
skill-name/
  SKILL.md
  references/
    video-summary.md
    full-transcript.md
```

### `SKILL.md`

The main reusable skill instructions.

### `references/video-summary.md`

Contains:

- a short AI-generated summary
- source metadata
- reference notes

### `references/full-transcript.md`

Contains:

- source metadata
- the complete captured transcript

## Requirements

- Node.js
- npm
- Google Gemini API key
- Chrome or another Chromium-based browser with extension support

## Setup

### Install dependencies

```bash
npm install
```

### Build the extension

```bash
npm run build
```

### Development watch mode

```bash
npm run dev
```

### Run tests

```bash
npm test
```

### Run type checking

```bash
npm run typecheck
```

## Load in Chrome

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click Load unpacked
4. Select the project's `dist` folder

After rebuilding, reload the extension from the extensions page before testing changes.

## Usage

1. Open the extension settings page
2. Paste a valid Google Gemini API key
3. Leave the Gemini model on the recommended default unless you want to change it
4. Open a captioned YouTube video
5. Click the extension icon
6. Optionally enter a skill name hint
7. Click Make Skill
8. Review or edit the generated files
9. Download the Codex ZIP or the Claude ZIP

## Recommended Gemini Model

The extension defaults to:

- `gemini-2.5-flash`

This is the recommended fast model for most videos.

## Project Structure

- `src/popup/` - popup UI for generation, editing, and downloading
- `src/options/` - settings page for the Gemini key and model
- `src/background/` - runtime message handling and Gemini calls
- `src/content/` - YouTube transcript extraction logic
- `src/shared/` - shared types, prompts, and package formatting
- `public/manifest.json` - Chrome extension manifest
- `public/logo-*.png` - logo assets used by the extension UI and browser icon
- `dist/` - built extension output for loading into Chrome

## How It Works

### 1. Transcript capture

When you click Make Skill, SkillSnap tries to read transcript data from the active YouTube tab.

It uses several fallback paths:

- caption track files from YouTube
- transcript extraction from the page context
- transcript extraction from the visible transcript UI
- YouTube internal transcript endpoints as backups

If all transcript strategies fail, generation stops with an error.

### 2. Skill generation

Once a transcript is captured, the extension sends:

- video title
- channel name
- video URL
- caption language
- transcript text

to the Google Gemini API and asks for structured JSON that describes a reusable skill.

### 3. Package building

The returned draft is normalized into two final packages:

- a Codex package
- a Claude package

Each package gets:

- a platform-specific `SKILL.md`
- a short reference summary
- the complete transcript as a separate markdown file

### 4. ZIP download

The popup generates a ZIP file in the browser using `jszip` and downloads it locally.

## Skill Library

Successful generations are saved locally in Chrome storage.

From the popup or options page, you can:

- review previous generations
- re-download Codex or Claude ZIPs
- view the generated files
- copy the source video URL
- regenerate from the stored transcript
- delete entries you no longer need

The library uses a soft cap so older entries are evicted automatically when needed.

## Security and Privacy

SkillSnap is currently designed as a local-first personal extension.

Important notes:

- Google Gemini API keys are stored in Chrome local extension storage
- transcripts are processed locally in the extension before being sent to Gemini
- the extension does not use a backend server
- if a key is suspended, invalid, or denied, the extension shows a friendly error message

## Known Limitations

- Some YouTube videos do not expose usable captions
- YouTube transcript UI can change and break selectors
- Region-locked, age-restricted, or otherwise protected videos may fail
- Gemini output quality depends on transcript quality
- Very long transcripts may be trimmed for the Gemini prompt, even though the full transcript is still packaged in the ZIP
- This is not a server-backed product yet, so everything runs locally in the extension

## Troubleshooting

### Captions were found, but YouTube returned empty caption files

Possible causes:

- YouTube changed the transcript UI
- the transcript endpoint rejected the request
- the video captions are present but not readable through the current fallbacks

Try:

1. Refresh the YouTube tab
2. Reload the extension
3. Try another video with normal captions

### Invalid Google Gemini API key

Make sure:

- the key is copied correctly
- the key is active
- the key is allowed to use the Gemini API

### Gemini key suspended

That is a Google-side issue, not a local code issue.

Fix:

1. Create a new active Google Gemini API key
2. Open extension settings
3. Replace the old key
4. Try again

## Best Video Types For This Tool

SkillSnap works best on videos that teach:

- repeatable workflows
- debugging methods
- coding processes
- growth tactics
- product strategy
- operational playbooks

## Branding

The logo used throughout the extension is stored in `public/logo-*.png` and is also used in the popup, settings page, and extension icon.
