import type { ContentRequest, RuntimeResponse, VideoContext } from "../shared/types";
import {
  captionTrackLabel,
  captionUrlWithFormat,
  extractInitialDataFromText,
  extractPlayerResponseFromText,
  extractYouTubeConfigFromText,
  findTranscriptContinuationToken,
  findTranscriptEndpointParams,
  findTranscriptEndpointParamsDeep,
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
const POST_MESSAGE_REQUEST = "youtube-skill-maker-mw-request";
const POST_MESSAGE_RESPONSE = "youtube-skill-maker-mw-response";

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
    throw new Error(
      `Could not parse a YouTube video ID from the current page URL (${location.href}). Open a YouTube video page (youtube.com/watch?v=... or youtube.com/shorts/...) before making a skill.`
    );
  }

  const playerResponse = (await findPlayerResponse(videoId)) as unknown;
  const tracks = getCaptionTracks(playerResponse);
  const track = selectCaptionTrack(tracks);

  if (!track) {
    throw new Error("This video does not expose captions that the extension can read.");
  }

  const transcript =
    (await fetchTranscriptFromMainWorld()) ||
    (await fetchTranscriptFromYouTubePanel()) ||
    (await fetchTranscriptFromTracks(tracks)) ||
    (await fetchTranscriptFromInnertube()) ||
    (await fetchTranscriptFromDirectEndpoint(videoId, track.languageCode || "en")) ||
    (await fetchTranscriptFromInnertubeDirect(videoId, track.languageCode || "en"));
  if (!transcript.trim()) {
    const isMobile = location.hostname.startsWith("m.");
    const mobileHint = isMobile ? " Try using desktop YouTube (www.youtube.com) instead of mobile (m.youtube.com)." : "";
    throw new Error(
      `Captions were found (${captionTrackLabel(track)}, ${track.languageCode || "?"}, ${track.kind || "manual"}), but YouTube returned empty caption files and the transcript panel could not be opened. Try refreshing the YouTube tab and clicking Make Skill again.${mobileHint}`
    );
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
  console.log(`[tracks] Trying ${orderedTracks.length} caption tracks`);

  for (const track of orderedTracks) {
    console.log(`[tracks] Trying track: ${track.languageCode} (${track.kind || "manual"})`);
    const transcript = await fetchTranscript(track.baseUrl);
    if (transcript.trim()) {
      console.log(`[tracks] Success with track: ${track.languageCode}`);
      return transcript;
    }
  }

  console.log("[tracks] All tracks failed");
  return "";
}

async function fetchTranscript(baseUrl: string): Promise<string> {
  const cleanedBaseUrl = stripRestrictiveCaptionParams(baseUrl);
  const attempts = [
    {
      url: captionUrlWithFormat(cleanedBaseUrl, "json3"),
      parse: parseJson3Transcript
    },
    {
      url: captionUrlWithFormat(cleanedBaseUrl, "srv3"),
      parse: parseXmlTranscript
    },
    {
      url: captionUrlWithFormat(cleanedBaseUrl, "vtt"),
      parse: parseVttTranscript
    },
    {
      url: cleanedBaseUrl,
      parse: parseXmlTranscript
    },
    {
      url: captionUrlWithFormat(cleanedBaseUrl, "json3") + "&tlang=en",
      parse: parseJson3Transcript
    }
  ];

  for (const attempt of attempts) {
    try {
      const response = await fetch(attempt.url, { credentials: "include" });
      if (!response.ok) {
        console.log(`[transcript] ${attempt.url} returned ${response.status}`);
        continue;
      }

      const text = await response.text();
      if (!text.trim()) {
        console.log(`[transcript] ${attempt.url} returned empty body, trying background...`);
        const bgResult = await fetchCaptionViaBackground(attempt.url);
        if (bgResult.trim()) {
          const parsed = attempt.parse(bgResult);
          if (parsed.trim()) {
            console.log(`[transcript] success from background: ${attempt.url}`);
            return parsed;
          }
        }
        continue;
      }

      const parsed = attempt.parse(text);
      if (parsed.trim()) {
        console.log(`[transcript] success from ${attempt.url}`);
        return parsed;
      }
    } catch (err) {
      console.log(`[transcript] ${attempt.url} threw:`, err);
    }
  }

  return "";
}

async function fetchCaptionViaBackground(url: string): Promise<string> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "FETCH_CAPTION_URL", url } as unknown as Message,
      (response: unknown) => {
        const res = response as { ok: boolean; data?: { transcript: string } };
        if (res?.ok && res.data?.transcript) {
          resolve(res.data.transcript);
        } else {
          resolve("");
        }
      }
    );
  });
}

interface Message {
  type: string;
  url?: string;
}

function stripRestrictiveCaptionParams(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    url.searchParams.delete("lact");
    return url.toString();
  } catch {
    return baseUrl;
  }
}

async function fetchTranscriptFromYouTubePanel(): Promise<string> {
  console.log("[panel] Starting transcript panel approach");

  const existingTranscript = readTranscriptPanel();
  if (existingTranscript) {
    console.log("[panel] Found existing transcript");
    return existingTranscript;
  }

  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  try {
    console.log("[panel] Waiting for transcript panel prerequisites...");
    await waitForTranscriptPanelPrerequisites();
    console.log("[panel] Expanding description...");
    await expandDescription();
    console.log("[panel] Opening transcript panel...");
    const opened = await openTranscriptPanel();
    if (!opened) {
      console.log("[panel] Could not open transcript panel");
      return "";
    }

    await waitForTranscriptSegments();
    const result = readTranscriptPanel();
    console.log(`[panel] Read ${result ? result.split("\n").length : 0} transcript lines`);
    return result;
  } finally {
    window.scrollTo(scrollX, scrollY);
  }
}

async function fetchTranscriptFromMainWorld(): Promise<string> {
  console.log("[main-world] Starting main world transcript approach");
  const ready = await ensureMainWorldBridge();
  if (!ready) {
    console.log("[main-world] Main world bridge not ready");
    return "";
  }

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      console.log("[main-world] Timed out after 5s");
      resolve("");
    }, 5000);

    let resolved = false;

    const handleResponse = (event: Event) => {
      if (resolved) return;
      const customEvent = event as CustomEvent<MainWorldResponseDetail>;
      if (customEvent.detail?.requestId !== requestId) {
        return;
      }
      resolved = true;
      cleanup();
      const result = customEvent.detail.ok ? customEvent.detail.transcript : "";
      console.log(`[main-world] Got CustomEvent response: ok=${customEvent.detail.ok}, source=${customEvent.detail.ok ? customEvent.detail.source : customEvent.detail.error}, lines=${result ? result.split("\n").length : 0}`);
      resolve(result);
    };

    const handleMessage = (event: MessageEvent) => {
      if (resolved) return;
      if (event.source !== window) return;
      if (event.data?.type !== POST_MESSAGE_RESPONSE) return;
      if (event.data?.requestId !== requestId) return;
      resolved = true;
      cleanup();
      const detail = event.data.detail as MainWorldResponseDetail;
      const result = detail.ok ? detail.transcript : "";
      console.log(`[main-world] Got postMessage response: ok=${detail.ok}, source=${detail.ok ? detail.source : detail.error}, lines=${result ? result.split("\n").length : 0}`);
      resolve(result);
    };

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener(MAIN_WORLD_RESPONSE_EVENT, handleResponse as EventListener);
      window.removeEventListener("message", handleMessage);
    };

    document.addEventListener(MAIN_WORLD_RESPONSE_EVENT, handleResponse as EventListener);
    window.addEventListener("message", handleMessage);

    document.dispatchEvent(
      new CustomEvent(MAIN_WORLD_REQUEST_EVENT, {
        detail: { requestId }
      })
    );

    window.postMessage({ type: POST_MESSAGE_REQUEST, requestId }, "*");
    console.log("[main-world] Dispatched request via both CustomEvent and postMessage");
  });
}

async function fetchTranscriptFromInnertube(): Promise<string> {
  const html = document.documentElement.innerHTML;
  const initialData = extractInitialDataFromText(html);
  const config = extractYouTubeConfigFromText(html);

  if (!config?.INNERTUBE_API_KEY || !config.INNERTUBE_CONTEXT) {
    return "";
  }

  const continuation = findTranscriptContinuationToken(initialData);
  const params = continuation ? null : (findTranscriptEndpointParams(initialData) || findTranscriptEndpointParamsDeep(initialData));

  if (!continuation && !params) {
    return "";
  }

  const body = continuation
    ? { context: config.INNERTUBE_CONTEXT, continuation }
    : { context: config.INNERTUBE_CONTEXT, params };

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
        body: JSON.stringify(body)
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

async function fetchTranscriptFromDirectEndpoint(videoId: string, lang: string): Promise<string> {
  const formats = ["json3", "srv3", "vtt"];
  const langs = [lang, "en", "en-US"];

  for (const tryLang of langs) {
    for (const fmt of formats) {
      const url = `/api/timedtext?v=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(tryLang)}&fmt=${fmt}`;
      try {
        const response = await fetch(url, { credentials: "include" });
        if (!response.ok) {
          console.log(`[transcript-direct] ${url} returned ${response.status}`);
          continue;
        }
        const text = await response.text();
        if (!text.trim()) {
          console.log(`[transcript-direct] ${url} returned empty body`);
          continue;
        }
        const parsed = fmt === "json3" ? parseJson3Transcript(text) : parseXmlTranscript(text);
        if (parsed.trim()) {
          console.log(`[transcript-direct] success from ${url}`);
          return parsed;
        }
      } catch (err) {
        console.log(`[transcript-direct] ${url} threw:`, err);
      }
    }
  }
  return "";
}

async function fetchTranscriptFromInnertubeDirect(videoId: string, lang: string): Promise<string> {
  const html = document.documentElement.innerHTML;
  const config = extractYouTubeConfigFromText(html);

  if (!config?.INNERTUBE_API_KEY || !config.INNERTUBE_CONTEXT) {
    return "";
  }

  const body = {
    context: config.INNERTUBE_CONTEXT,
    videoId,
    params: btoa(JSON.stringify({ videoId, language: lang }))
  };

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
        body: JSON.stringify(body)
      }
    );

    if (!response.ok) {
      console.log(`[innertube-direct] returned ${response.status}`);
      return "";
    }

    const result = parseInnertubeTranscript(await response.json());
    if (result.trim()) {
      console.log(`[innertube-direct] success`);
    }
    return result;
  } catch (err) {
    console.log(`[innertube-direct] threw:`, err);
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
    console.log("[panel] No description expander found, scrolling to description area...");
    document.querySelector<HTMLElement>("ytd-watch-metadata, #below, #description")?.scrollIntoView({
      block: "center"
    });
    await delay(1000);
    expander = findDescriptionExpander();
  }

  if (!expander) {
    console.log("[panel] Still no expander, trying to scroll more...");
    window.scrollBy({ top: 400, behavior: "instant" });
    await delay(1000);
    expander = findDescriptionExpander();
  }

  const isMobile = location.hostname.startsWith("m.");
  if (!expander && isMobile) {
    console.log("[panel] On mobile, looking for mobile description elements...");
    const mobileDescription = document.querySelector("#description, ytd-video-description-header-renderer, #contentContainer");
    if (mobileDescription) {
      mobileDescription.scrollIntoView({ block: "center" });
      await delay(1000);

      const mobileExpander = Array.from(
        document.querySelectorAll<HTMLElement>("button, [role='button'], #expand, tp-yt-paper-button")
      ).find((el) => {
        const text = normalizeText(el.textContent || "");
        return /(^|\s)(\.\.\.|…)?more$/i.test(text) || /description/i.test(text);
      });

      if (mobileExpander) {
        expander = mobileExpander;
      }
    }
  }

  if (!expander) {
    console.log("[panel] No expander found at all");
    return;
  }

  console.log("[panel] Found description expander, clicking...");
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

  console.log("[panel] Looking for transcript button...");

  const transcriptButton = findTranscriptButton();
  if (!transcriptButton) {
    console.log("[panel] Could not find transcript button, trying to scroll and find...");

    await scrollToDescription();
    await delay(1000);

    const buttonAfterScroll = findTranscriptButton();
    if (!buttonAfterScroll) {
      console.log("[panel] Still no button after scroll, trying 'More' expander...");

      const moreButton = findClickableElementsByText(/(^|\s)(\.\.\.|…)?more$/i).find(isVisibleElement);
      if (moreButton) {
        moreButton.scrollIntoView({ block: "center" });
        activateElement(moreButton);
        await delay(1500);

        const buttonAfterExpand = findTranscriptButton();
        if (buttonAfterExpand) {
          return clickTranscriptButton(buttonAfterExpand);
        }
      }

      console.log("[panel] No transcript button found anywhere");
      return false;
    }

    return clickTranscriptButton(buttonAfterScroll);
  }

  return clickTranscriptButton(transcriptButton);
}

function findTranscriptButton(): HTMLElement | undefined {
  const patterns = [
    /^show transcript$/i,
    /^transcript$/i,
    /transcript/i
  ];

  for (const pattern of patterns) {
    const button = findClickableElementsByText(pattern).find(isVisibleElement);
    if (button) {
      console.log(`[panel] Found transcript button with pattern: ${pattern}`);
      return button;
    }
  }

  const ariaButtons = Array.from(
    document.querySelectorAll<HTMLElement>("[aria-label*='transcript' i], [title*='transcript' i]")
  ).find(isVisibleElement);

  if (ariaButtons) {
    console.log("[panel] Found transcript button via aria-label/title");
    return ariaButtons;
  }

  const isMobile = location.hostname.startsWith("m.");
  if (isMobile) {
    console.log("[panel] On mobile YouTube, looking for mobile-specific elements...");

    const mobileButtons = Array.from(
      document.querySelectorAll<HTMLElement>("button, [role='button'], a")
    ).filter((el) => {
      const text = normalizeText(el.textContent || "");
      return /transcript/i.test(text) || /captions?/i.test(text);
    });

    if (mobileButtons.length > 0) {
      console.log(`[panel] Found ${mobileButtons.length} mobile transcript-related buttons`);
      return mobileButtons[0];
    }
  }

  return undefined;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

async function clickTranscriptButton(button: HTMLElement): Promise<boolean> {
  button.scrollIntoView({ block: "center" });
  await delay(500);
  runYouTubeCommand(button);
  activateElement(button);
  await delay(2500);
  return true;
}

async function scrollToDescription(): Promise<void> {
  const descriptionArea = document.querySelector("ytd-watch-metadata, #below, #description, ytd-video-description-transcript-section-renderer");
  if (descriptionArea) {
    descriptionArea.scrollIntoView({ block: "center" });
  } else {
    window.scrollBy({ top: 600, behavior: "smooth" });
  }
}

async function waitForTranscriptSegments(): Promise<void> {
  console.log("[panel] Waiting for transcript segments...");
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const direct = document.querySelectorAll("ytd-transcript-segment-renderer").length;
    const shadow = findSegmentsInShadowDOM().length;
    if (direct > 0 || shadow > 0) {
      console.log(`[panel] Found segments: direct=${direct}, shadow=${shadow}`);
      return;
    }
    const text = findAllTranscriptText();
    if (text) {
      console.log(`[panel] Found transcript text: ${text.length} chars`);
      return;
    }
    await delay(500);
  }
  console.log("[panel] Timed out waiting for segments");
}

function readTranscriptPanel(): string {
  console.log("[panel] Reading transcript panel...");

  const segments = Array.from(document.querySelectorAll("ytd-transcript-segment-renderer"));
  console.log(`[panel] Found ${segments.length} segments via querySelectorAll`);
  if (segments.length > 0) {
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

  const shadowSegments = findSegmentsInShadowDOM();
  console.log(`[panel] Found ${shadowSegments.length} segments via shadow DOM`);
  if (shadowSegments.length > 0) {
    const lines = shadowSegments
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

  const transcriptText = findAllTranscriptText();
  if (transcriptText) {
    console.log(`[panel] Found transcript text via deep search: ${transcriptText.length} chars`);
    return parseMobileTranscriptText(transcriptText);
  }

  const isMobile = location.hostname.startsWith("m.");
  if (isMobile) {
    const mobileTranscript = readMobileTranscript();
    if (mobileTranscript) {
      console.log(`[panel] Found mobile transcript: ${mobileTranscript.length} chars`);
      return mobileTranscript;
    }
  }

  console.log("[panel] No transcript found in panel");
  return "";
}

function readMobileTranscript(): string {
  const transcriptContainer = document.querySelector("#transcript, [id*='transcript'], ytd-transcript-renderer");
  if (!transcriptContainer) {
    return "";
  }

  const segments = transcriptContainer.querySelectorAll("[class*='segment'], [class*='cue'], ytd-transcript-segment-renderer");
  if (segments.length === 0) {
    const text = transcriptContainer.textContent || "";
    if (text.trim().length > 50) {
      return parseMobileTranscriptText(text);
    }
    return "";
  }

  const lines = Array.from(segments)
    .map((seg) => {
      const text = seg.textContent || "";
      const timestamp = text.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/)?.[0] || "00:00";
      const cleanText = text.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/, "").replace(/\s+/g, " ").trim();
      if (!cleanText) return "";
      return `[${normalizeTimestamp(timestamp)}] ${cleanText}`;
    })
    .filter(Boolean);

  return lines.join("\n");
}

function parseMobileTranscriptText(text: string): string {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const timestamped = lines.map((line) => {
    const match = line.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.*)$/);
    if (match) {
      return `[${normalizeTimestamp(match[1])}] ${match[2]}`;
    }
    return line;
  });
  return timestamped.join("\n");
}

function findSegmentsInShadowDOM(): Element[] {
  return collectFromShadowDOM(document, "ytd-transcript-segment-renderer");
}

function collectFromShadowDOM(root: ParentNode, selector: string): Element[] {
  const direct = Array.from(root.querySelectorAll(selector));
  if (direct.length > 0) {
    return direct;
  }

  const allElements = root.querySelectorAll("*");
  for (const el of Array.from(allElements)) {
    const shadowRoot = (el as HTMLElement).shadowRoot;
    if (shadowRoot) {
      const found = collectFromShadowDOM(shadowRoot, selector);
      if (found.length > 0) {
        return found;
      }
    }
  }

  return [];
}

function findAllTranscriptText(): string {
  const selectors = [
    "ytd-transcript-segment-renderer",
    "ytd-transcript-renderer",
    "ytd-transcript-search-panel-renderer",
    "ytd-engagement-panel-section-list-renderer[target-id*='transcript']",
    "ytd-video-description-transcript-section-renderer",
    "#transcript"
  ];

  for (const selector of selectors) {
    const elements = collectFromShadowDOM(document, selector);
    for (const el of elements) {
      const text = (el.textContent || "").trim();
      if (text.length > 100 && /\d{1,2}:\d{2}/.test(text)) {
        console.log(`[panel] Found transcript text via ${selector}: ${text.length} chars`);
        return text;
      }
    }
  }

  const panels = collectFromShadowDOM(document, "ytd-transcript-renderer, ytd-transcript-search-panel-renderer");
  for (const panel of panels) {
    const text = (panel.textContent || "").trim();
    if (text.length > 100 && /\d{1,2}:\d{2}/.test(text)) {
      console.log(`[panel] Found transcript text via panel: ${text.length} chars`);
      return text;
    }
  }

  return "";
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
  try {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith("/shorts/")) {
      return parsed.pathname.split("/").filter(Boolean)[1] || null;
    }

    return parsed.searchParams.get("v");
  } catch {
    return null;
  }
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
