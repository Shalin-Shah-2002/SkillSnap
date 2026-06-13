const REQUEST_EVENT = "youtube-skill-maker:get-main-world-transcript";
const RESPONSE_EVENT = "youtube-skill-maker:main-world-transcript-result";
const READY_ATTR = "data-youtube-skill-maker-main-world-ready";
const POST_MESSAGE_REQUEST = "youtube-skill-maker-mw-request";
const POST_MESSAGE_RESPONSE = "youtube-skill-maker-mw-response";

type RequestDetail = {
  requestId?: string;
};

type ResponseDetail =
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

interface YouTubeCommandElement extends HTMLElement {
  data?: {
    command?: unknown;
  };
  resolveCommand?: (command: unknown) => void;
}

if (!document.documentElement.hasAttribute(READY_ATTR)) {
  document.documentElement.setAttribute(READY_ATTR, "true");
  document.addEventListener(REQUEST_EVENT, handleTranscriptRequest as unknown as EventListener);
  window.addEventListener("message", handlePostMessageRequest);
}

function handlePostMessageRequest(event: MessageEvent): void {
  if (event.source !== window) return;
  if (event.data?.type !== POST_MESSAGE_REQUEST) return;
  const requestId = event.data?.requestId;
  if (!requestId) return;
  console.log("[main-world] Received postMessage request");
  handleTranscriptRequest({ detail: { requestId } } as CustomEvent<RequestDetail>);
}

async function handleTranscriptRequest(event: CustomEvent<RequestDetail>): Promise<void> {
  const requestId = event.detail?.requestId;
  if (!requestId) {
    return;
  }

  console.log("[main-world] Handling transcript request");

  try {
    const existing = readTranscriptPanel();
    if (existing) {
      console.log(`[main-world] Found existing transcript: ${existing.split("\n").length} lines`);
      sendResponse({ requestId, ok: true, transcript: existing, source: "youtube-transcript-panel-existing" });
      return;
    }

    const fromInitialData = extractTranscriptFromInitialData();
    if (fromInitialData) {
      console.log(`[main-world] Got initial data transcript: ${fromInitialData.split("\n").length} lines`);
      sendResponse({ requestId, ok: true, transcript: fromInitialData, source: "youtube-initial-data" });
      return;
    }

    const fromInline = await openInlineDescriptionTranscript();
    if (fromInline) {
      console.log(`[main-world] Got inline transcript: ${fromInline.split("\n").length} lines`);
      sendResponse({ requestId, ok: true, transcript: fromInline, source: "youtube-transcript-inline" });
      return;
    }

    const fromCommand = await openTranscriptWithYouTubeCommand();
    if (fromCommand) {
      console.log(`[main-world] Got command transcript: ${fromCommand.split("\n").length} lines`);
      sendResponse({ requestId, ok: true, transcript: fromCommand, source: "youtube-transcript-panel-command" });
      return;
    }

    const fromPanelClick = await openTranscriptWithVisibleControls();
    if (fromPanelClick) {
      console.log(`[main-world] Got panel click transcript: ${fromPanelClick.split("\n").length} lines`);
      sendResponse({ requestId, ok: true, transcript: fromPanelClick, source: "youtube-transcript-panel-click" });
      return;
    }

    console.log("[main-world] No transcript found");
    sendResponse({ requestId, ok: false, error: "The transcript panel did not expose readable segments." });
  } catch (error) {
    console.error("[main-world] Error:", error);
    sendResponse({
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : "The page transcript fallback failed."
    });
  }
}

function extractTranscriptFromInitialData(): string {
  const scripts = Array.from(document.querySelectorAll("script"));
  for (const script of scripts) {
    const text = script.textContent || "";
    if (text.includes("ytInitialData")) {
      try {
        const match = text.match(/var ytInitialData = ({.*?});/);
        if (match) {
          const data = JSON.parse(match[1]);
          const transcript = extractTranscriptFromObject(data);
          if (transcript) {
            return transcript;
          }
        }
      } catch {}
    }
  }
  return "";
}

function extractTranscriptFromObject(obj: unknown, lines: string[] = []): string {
  if (!obj || typeof obj !== "object") {
    return lines.length > 0 ? lines.join("\n") : "";
  }

  const candidate = obj as {
    transcriptCueRenderer?: {
      startOffsetMs?: string;
      cue?: { simpleText?: string; runs?: Array<{ text?: string }> };
    };
    transcriptSegmentRenderer?: {
      startOffsetMs?: string;
      snippet?: { simpleText?: string; runs?: Array<{ text?: string }> };
    };
  };

  const cue = candidate.transcriptCueRenderer || candidate.transcriptSegmentRenderer;
  if (cue) {
    const cueText = (cue as { cue?: { simpleText?: string; runs?: Array<{ text?: string }> } }).cue;
    const snippetText = (cue as { snippet?: { simpleText?: string; runs?: Array<{ text?: string }> } }).snippet;
    const text = cueText?.simpleText || cueText?.runs?.map((r: { text?: string }) => r.text).join("") ||
                 snippetText?.simpleText || snippetText?.runs?.map((r: { text?: string }) => r.text).join("") || "";
    if (text) {
      const ms = Number(cue.startOffsetMs || "0");
      const minutes = Math.floor(ms / 60000);
      const seconds = Math.floor((ms % 60000) / 1000);
      lines.push(`[${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}] ${text}`);
    }
  }

  for (const value of Object.values(obj)) {
    extractTranscriptFromObject(value, lines);
  }

  return lines.length > 0 ? lines.join("\n") : "";
}

function sendResponse(detail: ResponseDetail): void {
  document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, { detail }));
  window.postMessage({ type: POST_MESSAGE_RESPONSE, requestId: detail.requestId, detail }, "*");
  console.log(`[main-world] Sent response via both CustomEvent and postMessage: ok=${detail.ok}`);
}

async function openTranscriptWithYouTubeCommand(): Promise<string> {
  await waitForYouTubeMetadata();

  const commandElement = findTranscriptCommandElement();
  if (!commandElement) {
    return "";
  }

  commandElement.scrollIntoView?.({ block: "center" });
  runYouTubeCommand(commandElement);

  const transcript = await waitForTranscriptText(4000);
  if (transcript) {
    return transcript;
  }

  activateElement(commandElement);
  return waitForTranscriptText(4000);
}

async function openTranscriptWithVisibleControls(): Promise<string> {
  const existingTranscript = readTranscriptPanel();
  if (existingTranscript) {
    return existingTranscript;
  }

  const expander = await findOrRevealDescriptionExpander();
  if (expander) {
    expander.scrollIntoView({ block: "center" });
    activateElement(expander);
    await delay(1200);
  }

  const button = findTranscriptButtons().find(isVisibleElement);
  if (!button) {
    return "";
  }

  button.scrollIntoView({ block: "center" });
  runYouTubeCommand(button);
  activateElement(button);

  const immediate = readTranscriptPanel();
  if (immediate) {
    return immediate;
  }

  return waitForTranscriptText(4000);
}

async function openInlineDescriptionTranscript(): Promise<string> {
  const description = collectDeep(document, "ytd-video-description-transcript-section-renderer")[0];
  if (!description) {
    return "";
  }

  description.scrollIntoView({ block: "center" });
  await delay(600);

  const headerButton = collectDeep(description, "button, [role='button']")
    .map((el) => el as HTMLElement)
    .filter(isVisibleElement)
    .find((el) => /^show transcript$/i.test(normalizeText(el.textContent || "")));

  if (headerButton) {
    runYouTubeCommand(headerButton);
    activateElement(headerButton);
  }

  const immediate = readTranscriptPanel();
  if (immediate) {
    return immediate;
  }

  return waitForTranscriptText(4000);
}

async function waitForYouTubeMetadata(): Promise<void> {
  const deadline = Date.now() + 15000;

  while (Date.now() < deadline) {
    if (
      document.querySelector("ytd-watch-metadata") ||
      document.querySelector("ytd-video-description-transcript-section-renderer") ||
      findTranscriptCommandElement() ||
      findTranscriptButtons().length > 0
    ) {
      return;
    }
    await delay(300);
  }
}

function findTranscriptCommandElement(): YouTubeCommandElement | undefined {
  const renderers = Array.from(document.querySelectorAll<YouTubeCommandElement>("ytd-button-renderer"));

  return renderers.find((renderer) => {
    const text = normalizeText(renderer.textContent || "");
    return /(^show transcript$|\btranscript\b)/i.test(text) && !!renderer.data?.command && typeof renderer.resolveCommand === "function";
  });
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

async function findOrRevealDescriptionExpander(): Promise<HTMLElement | undefined> {
  let expander = findDescriptionExpander();
  if (expander) {
    return expander;
  }

  document.querySelector<HTMLElement>("ytd-watch-metadata, #below, #description")?.scrollIntoView({
    block: "center"
  });
  await delay(900);

  expander = findDescriptionExpander();
  if (expander) {
    return expander;
  }

  window.scrollBy({ top: 420, behavior: "instant" });
  await delay(900);
  return findDescriptionExpander();
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

async function waitForTranscriptText(timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const transcript = readTranscriptPanel();
    if (transcript) {
      return transcript;
    }
    await delay(500);
  }

  return "";
}

function readTranscriptPanel(): string {
  const segments = getTranscriptSegmentElements();
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

  return parsePlainTextTranscript(readPanelPlainText());
}

function findSegmentsInShadowDOM(): Element[] {
  const allElements = document.querySelectorAll("*");
  const segments: Element[] = [];

  for (const el of Array.from(allElements)) {
    const shadowRoot = (el as HTMLElement).shadowRoot;
    if (shadowRoot) {
      const found = shadowRoot.querySelectorAll("ytd-transcript-segment-renderer");
      segments.push(...Array.from(found));
    }
  }

  return segments;
}

function parsePlainTextTranscript(raw: string): string {
  if (!raw.trim()) {
    return "";
  }

  const lines = raw
    .split(/\n+/)
    .map((line) => normalizeText(line))
    .filter(Boolean);

  const timestamped = lines.map((line) => {
    const match = line.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.*)$/);
    if (match) {
      return `[${normalizeTimestamp(match[1])}] ${match[2]}`;
    }
    return line;
  });

  return dedupeAdjacent(timestamped).join("\n");
}

function dedupeAdjacent(lines: string[]): string[] {
  const result: string[] = [];
  let previous = "";
  for (const line of lines) {
    const textOnly = line.replace(/^\[[^\]]+\]\s*/, "");
    if (textOnly && textOnly !== previous) {
      result.push(line);
      previous = textOnly;
    }
  }
  return result;
}

function getTranscriptSegmentElements(): Element[] {
  const selectors = [
    "ytd-transcript-segment-renderer",
    "ytd-transcript-segment-list-renderer > *",
    "ytd-transcript-search-panel-renderer ytd-transcript-segment-renderer",
    "ytd-engagement-panel-section-list-renderer[target-id*='transcript'] [role='button']",
    "ytd-video-description-transcript-section-renderer [role='button']",
    "ytd-transcript-search-panel-renderer [role='button']",
    "#transcript ytd-transcript-segment-renderer",
    "ytd-transcript-renderer ytd-transcript-segment-renderer",
    "[id*='transcript'] ytd-transcript-segment-renderer"
  ];

  const found = dedupeElements(
    selectors.flatMap((selector) => collectDeep(document, selector))
  ).filter((element) => /\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(normalizeText(element.textContent || "")));

  if (found.length > 0) {
    return found;
  }

  const shadowSegments = findSegmentsInShadowDOM();
  if (shadowSegments.length > 0) {
    return shadowSegments;
  }

  const panelText = readPanelPlainText();
  if (panelText.trim()) {
    return [];
  }

  return [];
}

function readPanelPlainText(): string {
  const panels = collectDeep(document, "ytd-transcript-renderer, ytd-transcript-search-panel-renderer");
  if (panels.length === 0) {
    return "";
  }
  return normalizeText(panels[0].textContent || "");
}

function collectDeep(root: ParentNode, selector: string): Element[] {
  const direct = Array.from(root.querySelectorAll(selector));
  const shadow = Array.from(root.querySelectorAll("*"))
    .filter((el): el is HTMLElement => !!el.shadowRoot)
    .flatMap((el) => collectDeep(el.shadowRoot as ParentNode, selector));
  return [...direct, ...shadow];
}

function getSegmentTimestamp(segment: Element): string {
  return (
    segment.querySelector("#timestamp")?.textContent ||
    segment.querySelector(".segment-timestamp")?.textContent ||
    segment.querySelector("[class*='timestamp']")?.textContent ||
    segment.textContent?.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/)?.[0] ||
    "00:00"
  ).trim();
}

function getSegmentText(segment: Element): string {
  const directText =
    segment.querySelector(".segment-text")?.textContent ||
    segment.querySelector("yt-formatted-string.segment-text")?.textContent ||
    segment.querySelector("[class*='segment-text']")?.textContent ||
    segment.querySelector("[class*='cue']")?.textContent ||
    "";

  return (directText || (segment.textContent || "").replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/, ""))
    .replace(/\s+/g, " ")
    .trim();
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
  return Array.from(
    document.querySelectorAll<HTMLElement>("button, ytd-button-renderer, yt-button-shape button, tp-yt-paper-button, a, [role='button']")
  ).filter((element) => pattern.test(normalizeText(element.textContent || "")));
}

function findTranscriptButtons(): HTMLElement[] {
  const byText = findClickableElementsByText(/(^show transcript$|\btranscript\b)/i);
  const byLabel = Array.from(
    document.querySelectorAll<HTMLElement>("[aria-label*='transcript' i], [title*='transcript' i]")
  );

  return dedupeElements([...byText, ...byLabel]).filter(isVisibleElement);
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

function isVisibleElement(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function dedupeElements<T extends Element>(elements: T[]): T[] {
  return Array.from(new Set(elements));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
