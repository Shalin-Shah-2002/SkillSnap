export interface CaptionTrack {
  baseUrl: string;
  name?: {
    simpleText?: string;
    runs?: Array<{ text?: string }>;
  };
  languageCode?: string;
  kind?: string;
  vssId?: string;
}

export interface YouTubeConfig {
  INNERTUBE_API_KEY?: string;
  INNERTUBE_CONTEXT?: unknown;
  INNERTUBE_CONTEXT_CLIENT_NAME?: string | number;
  INNERTUBE_CONTEXT_CLIENT_VERSION?: string;
  VISITOR_DATA?: string;
}

export interface TranscriptResult {
  transcript: string;
  language?: string;
}

interface CaptionEvent {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: Array<{ utf8?: string }>;
}

export function extractPlayerResponseFromText(text: string): unknown | null {
  const markers = [
    "ytInitialPlayerResponse =",
    "ytInitialPlayerResponse=",
    "\"ytInitialPlayerResponse\":"
  ];

  for (const marker of markers) {
    const parsed = extractJsonAfterMarker(text, marker);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

export function extractJsonAfterMarker(text: string, marker: string): unknown | null {
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  const objectStart = text.indexOf("{", markerIndex + marker.length);
  if (objectStart === -1) {
    return null;
  }

  const objectText = readBalancedJsonObject(text, objectStart);
  if (!objectText) {
    return null;
  }

  try {
    return JSON.parse(objectText);
  } catch {
    return null;
  }
}

export function getCaptionTracks(playerResponse: unknown): CaptionTrack[] {
  const response = playerResponse as {
    captions?: {
      playerCaptionsTracklistRenderer?: {
        captionTracks?: CaptionTrack[];
      };
    };
  };

  return response.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
}

export function extractInitialDataFromText(text: string): unknown | null {
  const markers = ["ytInitialData =", "ytInitialData=", "var ytInitialData ="];

  for (const marker of markers) {
    const parsed = extractJsonAfterMarker(text, marker);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

export function extractYouTubeConfigFromText(text: string): YouTubeConfig | null {
  let position = 0;

  while ((position = text.indexOf("ytcfg.set", position)) !== -1) {
    const objectStart = text.indexOf("{", position);
    const objectText = objectStart >= 0 ? readBalancedJsonObject(text, objectStart) : null;
    position += "ytcfg.set".length;

    if (!objectText) {
      continue;
    }

    try {
      const parsed = JSON.parse(objectText) as YouTubeConfig;
      if (parsed.INNERTUBE_API_KEY && parsed.INNERTUBE_CONTEXT) {
        return parsed;
      }
    } catch {
      // Keep scanning; ytcfg.set can appear in non-config snippets.
    }
  }

  return null;
}

export function findTranscriptEndpointParams(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as { getTranscriptEndpoint?: { params?: string } };
  if (candidate.getTranscriptEndpoint?.params) {
    return candidate.getTranscriptEndpoint.params;
  }

  for (const child of Object.values(value)) {
    const found = findTranscriptEndpointParams(child);
    if (found) {
      return found;
    }
  }

  return null;
}

export function selectCaptionTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  if (tracks.length === 0) {
    return null;
  }

  return (
    tracks.find((track) => track.languageCode?.toLowerCase().startsWith("en") && track.kind !== "asr") ||
    tracks.find((track) => track.languageCode?.toLowerCase().startsWith("en")) ||
    tracks.find((track) => track.kind !== "asr") ||
    tracks[0]
  );
}

export function captionUrlWithFormat(baseUrl: string, format: "json3" | "srv3" | "vtt"): string {
  const url = new URL(baseUrl);
  url.searchParams.set("fmt", format);
  return url.toString();
}

export function parseJson3Transcript(payload: string): string {
  const parsed = JSON.parse(payload) as { events?: CaptionEvent[] };
  const lines = (parsed.events || [])
    .map((event) => {
      const text = (event.segs || [])
        .map((seg) => seg.utf8 || "")
        .join("")
        .replace(/\s+/g, " ")
        .trim();

      if (!text) {
        return "";
      }

      return `[${formatTimestamp(event.tStartMs || 0)}] ${text}`;
    })
    .filter(Boolean);

  return dedupeAdjacent(lines).join("\n");
}

export function parseXmlTranscript(payload: string): string {
  const legacyTextLines = parseLegacyTextTranscript(payload);
  if (legacyTextLines.length > 0) {
    return dedupeAdjacent(legacyTextLines).join("\n");
  }

  const srv3Lines = parseSrv3Transcript(payload);
  return dedupeAdjacent(srv3Lines).join("\n");
}

export function parseVttTranscript(payload: string): string {
  const blocks = payload
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const lines = blocks
    .map((block) => {
      const blockLines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      const timingIndex = blockLines.findIndex((line) => line.includes("-->"));
      if (timingIndex === -1) {
        return "";
      }

      const start = blockLines[timingIndex].split("-->")[0]?.trim() || "00:00";
      const text = blockLines
        .slice(timingIndex + 1)
        .join(" ")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();

      if (!text) {
        return "";
      }

      return `[${formatVttTimestamp(start)}] ${decodeXmlEntities(text)}`;
    })
    .filter(Boolean);

  return dedupeAdjacent(lines).join("\n");
}

export function parseInnertubeTranscript(payload: unknown): string {
  const cueRenderers = collectTranscriptCueRenderers(payload);
  const lines = cueRenderers
    .map((cue) => {
      const timestamp = Number(cue.startOffsetMs || "0");
      const text = getRunsText(cue.cue).replace(/\s+/g, " ").trim();
      if (!text) {
        return "";
      }

      return `[${formatTimestamp(timestamp)}] ${text}`;
    })
    .filter(Boolean);

  return dedupeAdjacent(lines).join("\n");
}

export function captionTrackLabel(track: CaptionTrack): string {
  const runText = track.name?.runs?.map((run) => run.text).filter(Boolean).join("");
  return track.name?.simpleText || runText || track.languageCode || "captions";
}

interface TranscriptCueRenderer {
  startOffsetMs?: string;
  cue?: {
    simpleText?: string;
    runs?: Array<{ text?: string }>;
  };
}

function collectTranscriptCueRenderers(value: unknown, out: TranscriptCueRenderer[] = []): TranscriptCueRenderer[] {
  if (!value || typeof value !== "object") {
    return out;
  }

  const candidate = value as { transcriptCueRenderer?: TranscriptCueRenderer };
  if (candidate.transcriptCueRenderer) {
    out.push(candidate.transcriptCueRenderer);
  }

  for (const child of Object.values(value)) {
    collectTranscriptCueRenderers(child, out);
  }

  return out;
}

function getRunsText(value: { simpleText?: string; runs?: Array<{ text?: string }> } | undefined): string {
  return value?.simpleText || value?.runs?.map((run) => run.text || "").join("") || "";
}

function readBalancedJsonObject(text: string, startIndex: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function parseLegacyTextTranscript(payload: string): string[] {
  return Array.from(payload.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi))
    .map((match) => {
      const startSeconds = Number(getXmlAttribute(match[1], "start") || "0");
      const text = cleanCaptionText(match[2]);
      if (!text) {
        return "";
      }

      return `[${formatTimestamp(startSeconds * 1000)}] ${text}`;
    })
    .filter(Boolean);
}

function parseSrv3Transcript(payload: string): string[] {
  return Array.from(payload.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi))
    .map((match) => {
      const startMs = Number(getXmlAttribute(match[1], "t") || "0");
      const body = match[2];
      const segmentMatches = Array.from(body.matchAll(/<s\b[^>]*>([\s\S]*?)<\/s>/gi));
      const rawText =
        segmentMatches.length > 0
          ? segmentMatches.map((segmentMatch) => segmentMatch[1]).join("")
          : body;
      const text = cleanCaptionText(rawText);

      if (!text) {
        return "";
      }

      return `[${formatTimestamp(startMs)}] ${text}`;
    })
    .filter(Boolean);
}

function getXmlAttribute(attributes: string, name: string): string | null {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
  const match = attributes.match(pattern);
  return match?.[2] || match?.[3] || null;
}

function cleanCaptionText(text: string): string {
  return decodeXmlEntities(
    text
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_match, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10))
    );
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatVttTimestamp(value: string): string {
  const parts = value.split(":");
  const secondsPart = parts.at(-1) || "0";
  const minutesPart = parts.at(-2) || "0";
  const hoursPart = parts.at(-3) || "0";
  const totalMs =
    Number(hoursPart) * 60 * 60 * 1000 +
    Number(minutesPart) * 60 * 1000 +
    Number(secondsPart.replace(",", ".")) * 1000;

  return formatTimestamp(totalMs);
}

function dedupeAdjacent(lines: string[]): string[] {
  const result: string[] = [];
  let previousText = "";

  for (const line of lines) {
    const textOnly = line.replace(/^\[[^\]]+\]\s*/, "");
    if (textOnly !== previousText) {
      result.push(line);
      previousText = textOnly;
    }
  }

  return result;
}
