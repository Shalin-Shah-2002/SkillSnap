import type { ContentRequest, RuntimeResponse, VideoContext } from "../shared/types";
import {
  captionTrackLabel,
  captionUrlWithFormat,
  extractInitialDataFromText,
  extractPlayerResponseFromText,
  extractYouTubeConfigFromText,
  findTranscriptEndpointParams,
  getCaptionTracks,
  parseInnertubeTranscript,
  parseJson3Transcript,
  parseVttTranscript,
  parseXmlTranscript,
  selectCaptionTrack
} from "./youtube-parser";

const MAIN_WORLD_REQUEST_EVENT = "youtube-skill-maker:get-main-world-transcript";
const MAIN_WORLD_RESPONSE_EVENT = "youtube-skill-maker:main-world-transcript-result";
const MAIN_WORLD_READY_ATTR = "data-youtube-skill-maker-main-world-ready";

type MainWorldResponseDetail =
  | {
      requestId: string;
      ok: true;
      transcript: string;
      source: string;
    }
  | {
      requestId: string;
      ok: false;
      error: string;
    };

chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
  if (message.type !== "GET_YOUTUBE_CONTEXT") {
    return false;
  }

  captureVideoContext()
    .then((data) => sendResponse({ ok: true, data } satisfies RuntimeResponse<VideoContext>))
    .catch((error: unknown) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Could not read this YouTube video."
      } satisfies RuntimeResponse<VideoContext>)
    );

  return true;
});

async function captureVideoContext(): Promise<VideoContext> {
  const videoId = getVideoId(location.href);
  if (!videoId) {
    throw new Error("Open a YouTube video page before making a skill.");
  }

  const playerResponse = (await findPlayerResponse(videoId)) as unknown;
  const tracks = getCaptionTracks(playerResponse);
  const track = selectCaptionTrack(tracks);

  if (!track) {
    throw new Error("This video does not expose captions that the extension can read.");
  }

  const transcript =
    (await fetchTranscriptFromTracks(tracks)) ||
    (await fetchTranscriptFromMainWorld()) ||
    (await fetchTranscriptFromYouTubePanel()) ||
    (await fetchTranscriptFromInnertube());
  if (!transcript.trim()) {
    throw new Error("Captions were found, but YouTube returned empty caption files and the transcript panel could not be opened.");
  }

  return {
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title: getVideoTitle(),
    channel: getChannelName(),
    transcript,
    transcriptSource: `YouTube captions: ${captionTrackLabel(track)}`,
    captionLanguage: track.languageCode,
    capturedAt: new Date().toISOString()
  };
}

async function findPlayerResponse(videoId: string): Promise<unknown> {
  const currentOriginWatchUrl = new URL("/watch", location.origin);
  currentOriginWatchUrl.searchParams.set("v", videoId);

  try {
    const response = await fetch(currentOriginWatchUrl.toString(), {
      credentials: "include"
    });

    if (response.ok) {
      const html = await response.text();
      const parsed = extractPlayerResponseFromText(html);
      if (parsed) {
        return parsed;
      }
    }
  } catch {
    // Fall back to the current DOM below.
  }

  for (const script of Array.from(document.querySelectorAll("script"))) {
    const parsed = extractPlayerResponseFromText(script.textContent || "");
    if (parsed) {
      return parsed;
    }
  }

  throw new Error("Could not find YouTube caption metadata on this page.");
}

async function fetchTranscriptFromTracks(tracks: ReturnType<typeof getCaptionTracks>): Promise<string> {
  const orderedTracks = orderCaptionTracks(tracks);

  for (const track of orderedTracks) {
    const transcript = await fetchTranscript(track.baseUrl);
    if (transcript.trim()) {
      return transcript;
    }
  }

  return "";
}

async function fetchTranscript(baseUrl: string): Promise<string> {
  const attempts = [
    {
      url: captionUrlWithFormat(baseUrl, "json3"),
      parse: parseJson3Transcript
    },
    {
      url: captionUrlWithFormat(baseUrl, "srv3"),
      parse: parseXmlTranscript
    },
    {
      url: captionUrlWithFormat(baseUrl, "vtt"),
      parse: parseVttTranscript
    },
    {
      url: baseUrl,
      parse: parseXmlTranscript
    }
  ];

  for (const attempt of attempts) {
    try {
      const response = await fetch(attempt.url, { credentials: "include" });
      if (!response.ok) {
        continue;
      }

      const parsed = attempt.parse(await response.text());
      if (parsed.trim()) {
        return parsed;
      }
    } catch {
      // Try the next caption format.
    }
  }

  return "";
}

async function fetchTranscriptFromYouTubePanel(): Promise<string> {
  const existingTranscript = readTranscriptPanel();
  if (existingTranscript) {
    return existingTranscript;
  }

  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  try {
    await waitForTranscriptPanelPrerequisites();
    await expandDescription();
    const opened = await openTranscriptPanel();
    if (!opened) {
      return "";
    }

    await waitForTranscriptSegments();
    return readTranscriptPanel();
  } finally {
    window.scrollTo(scrollX, scrollY);
  }
}

async function fetchTranscriptFromMainWorld(): Promise<string> {
  const ready = await ensureMainWorldBridge();
  if (!ready) {
    return "";
  }

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      resolve("");
    }, 12000);

    const handleResponse = (event: Event) => {
      const customEvent = event as CustomEvent<MainWorldResponseDetail>;
      if (customEvent.detail?.requestId !== requestId) {
        return;
      }

      cleanup();
      resolve(customEvent.detail.ok ? customEvent.detail.transcript : "");
    };

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener(MAIN_WORLD_RESPONSE_EVENT, handleResponse as EventListener);
    };

    document.addEventListener(MAIN_WORLD_RESPONSE_EVENT, handleResponse as EventListener);
    document.dispatchEvent(
      new CustomEvent(MAIN_WORLD_REQUEST_EVENT, {
        detail: { requestId }
      })
    );
  });
}

async function fetchTranscriptFromInnertube(): Promise<string> {
  const html = document.documentElement.innerHTML;
  const initialData = extractInitialDataFromText(html);
  const config = extractYouTubeConfigFromText(html);
  const params = findTranscriptEndpointParams(initialData);

  if (!params || !config?.INNERTUBE_API_KEY || !config.INNERTUBE_CONTEXT) {
    return "";
  }

  try {
    const response = await fetch(
      `/youtubei/v1/get_transcript?key=${encodeURIComponent(config.INNERTUBE_API_KEY)}&prettyPrint=false`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-youtube-client-name": String(config.INNERTUBE_CONTEXT_CLIENT_NAME || 1),
          "x-youtube-client-version": String(config.INNERTUBE_CONTEXT_CLIENT_VERSION || ""),
          "x-goog-visitor-id": String(config.VISITOR_DATA || "")
        },
        body: JSON.stringify({
          context: config.INNERTUBE_CONTEXT,
          params
        })
      }
    );

    if (!response.ok) {
      return "";
    }

    return parseInnertubeTranscript(await response.json());
  } catch {
    return "";
  }
}

function orderCaptionTracks(tracks: ReturnType<typeof getCaptionTracks>): ReturnType<typeof getCaptionTracks> {
  return [...tracks].sort((left, right) => scoreCaptionTrack(right) - scoreCaptionTrack(left));
}

function scoreCaptionTrack(track: ReturnType<typeof getCaptionTracks>[number]): number {
  let score = 0;
  const language = track.languageCode?.toLowerCase() || "";

  if (language === "en") score += 50;
  else if (language.startsWith("en")) score += 40;
  if (track.kind !== "asr") score += 10;

  return score;
}

async function expandDescription(): Promise<void> {
  let expander = findDescriptionExpander();

  if (!expander) {
    document.querySelector<HTMLElement>("ytd-watch-metadata, #below, #description")?.scrollIntoView({
      block: "center"
    });
    await delay(700);
    expander = findDescriptionExpander();
  }

  if (!expander) {
    return;
  }

  expander.scrollIntoView({ block: "center" });
  activateElement(expander);
  await waitForVisibleElement(() => findClickableElementsByText(/^show transcript$/i).find(isVisibleElement), 5000);
}

async function waitForTranscriptPanelPrerequisites(): Promise<void> {
  await waitForVisibleElement(
    () =>
      findDescriptionExpander() ||
      findClickableElementsByText(/^show transcript$/i).find(isVisibleElement) ||
      (document.querySelector("ytd-watch-metadata") as HTMLElement | null) ||
      undefined,
    10000
  );
}

function findDescriptionExpander(): HTMLElement | undefined {
  const expanders = [
    ...Array.from(document.querySelectorAll<HTMLElement>("#description #expand")),
    ...Array.from(document.querySelectorAll<HTMLElement>("ytd-text-inline-expander #expand")),
    ...Array.from(document.querySelectorAll<HTMLElement>("#description-inline-expander #expand")),
    ...Array.from(document.querySelectorAll<HTMLElement>("tp-yt-paper-button#expand")),
    ...findClickableElementsByText(/(^|\s)(\.\.\.|…)?more$/i)
  ];

  return expanders.find(isVisibleElement);
}

async function openTranscriptPanel(): Promise<boolean> {
  const existing = readTranscriptPanel();
  if (existing) {
    return true;
  }

  const transcriptButton = findClickableElementsByText(/^show transcript$/i).find(isVisibleElement);
  if (!transcriptButton) {
    return false;
  }

  transcriptButton.scrollIntoView({ block: "center" });
  runYouTubeCommand(transcriptButton);
  activateElement(transcriptButton);
  await delay(1600);
  return true;
}

async function waitForTranscriptSegments(): Promise<void> {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    if (document.querySelector("ytd-transcript-segment-renderer")) {
      return;
    }
    await delay(300);
  }
}

function readTranscriptPanel(): string {
  const segments = Array.from(document.querySelectorAll("ytd-transcript-segment-renderer"));
  const lines = segments
    .map((segment) => {
      const timestamp = getSegmentTimestamp(segment);
      const text = getSegmentText(segment);
      if (!text) {
        return "";
      }

      return `[${normalizeTimestamp(timestamp)}] ${text}`;
    })
    .filter(Boolean);

  return lines.join("\n");
}

function getSegmentTimestamp(segment: Element): string {
  return (
    segment.querySelector("#timestamp")?.textContent ||
    segment.querySelector(".segment-timestamp")?.textContent ||
    segment.textContent?.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/)?.[0] ||
    "00:00"
  ).trim();
}

function getSegmentText(segment: Element): string {
  const directText =
    segment.querySelector(".segment-text")?.textContent ||
    segment.querySelector("yt-formatted-string.segment-text")?.textContent ||
    "";

  const text =
    directText ||
    (segment.textContent || "").replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/, "");

  return text.replace(/\s+/g, " ").trim();
}

function normalizeTimestamp(timestamp: string): string {
  const parts = timestamp.split(":").map((part) => Number.parseInt(part, 10));
  if (parts.length === 3) {
    return `${String(parts[0] * 60 + parts[1]).padStart(2, "0")}:${String(parts[2]).padStart(2, "0")}`;
  }

  if (parts.length === 2) {
    return `${String(parts[0]).padStart(2, "0")}:${String(parts[1]).padStart(2, "0")}`;
  }

  return "00:00";
}

function findClickableElementsByText(pattern: RegExp): HTMLElement[] {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>("button, ytd-button-renderer, yt-button-shape button, tp-yt-paper-button, a, [role='button']")
  );

  return candidates.filter((element) =>
    pattern.test((element.textContent || "").replace(/\s+/g, " ").trim())
  );
}

function activateElement(element: HTMLElement): void {
  const rect = element.getBoundingClientRect();
  const eventInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2
  };

  element.dispatchEvent(new PointerEvent("pointerdown", eventInit));
  element.dispatchEvent(new MouseEvent("mousedown", eventInit));
  element.dispatchEvent(new PointerEvent("pointerup", eventInit));
  element.dispatchEvent(new MouseEvent("mouseup", eventInit));
  element.dispatchEvent(new MouseEvent("click", eventInit));
  element.click();
}

function runYouTubeCommand(element: HTMLElement): boolean {
  const renderer = element.closest("ytd-button-renderer") as YouTubeCommandElement | null;
  const command = renderer?.data?.command;

  if (!renderer || !command || typeof renderer.resolveCommand !== "function") {
    return false;
  }

  try {
    renderer.resolveCommand(command);
    return true;
  } catch {
    return false;
  }
}

async function waitForVisibleElement(
  findElement: () => HTMLElement | undefined,
  timeoutMs: number
): Promise<HTMLElement | undefined> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const element = findElement();
    if (element) {
      return element;
    }
    await delay(250);
  }

  return undefined;
}

function isVisibleElement(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function ensureMainWorldBridge(): Promise<boolean> {
  if (document.documentElement.hasAttribute(MAIN_WORLD_READY_ATTR)) {
    return true;
  }

  const existingScript = document.getElementById("youtube-skill-maker-main-world-script");
  if (!existingScript) {
    const script = document.createElement("script");
    script.id = "youtube-skill-maker-main-world-script";
    script.src = chrome.runtime.getURL("youtube-main-world.js");
    script.async = false;
    (document.head || document.documentElement).appendChild(script);
  }

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (document.documentElement.hasAttribute(MAIN_WORLD_READY_ATTR)) {
      return true;
    }

    await delay(100);
  }

  return false;
}

interface YouTubeCommandElement extends HTMLElement {
  data?: {
    command?: unknown;
  };
  resolveCommand?: (command: unknown) => void;
}

function getVideoId(url: string): string | null {
  const parsed = new URL(url);
  if (parsed.pathname.startsWith("/shorts/")) {
    return parsed.pathname.split("/").filter(Boolean)[1] || null;
  }

  return parsed.searchParams.get("v");
}

function getVideoTitle(): string {
  const candidates = [
    "h1.ytd-watch-metadata yt-formatted-string",
    "h1.title yt-formatted-string",
    "h1"
  ];

  for (const selector of candidates) {
    const value = document.querySelector(selector)?.textContent?.trim();
    if (value) {
      return value;
    }
  }

  return document.title.replace(/\s+-\s+YouTube$/, "").trim() || "Untitled YouTube Video";
}

function getChannelName(): string {
  const candidates = [
    "ytd-video-owner-renderer #channel-name a",
    "#owner #channel-name a",
    "ytd-channel-name a",
    "#text-container yt-formatted-string"
  ];

  for (const selector of candidates) {
    const value = document.querySelector(selector)?.textContent?.trim();
    if (value) {
      return value;
    }
  }

  return "Unknown channel";
}
