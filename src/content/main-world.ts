const REQUEST_EVENT = "youtube-skill-maker:get-main-world-transcript";
const RESPONSE_EVENT = "youtube-skill-maker:main-world-transcript-result";
const READY_ATTR = "data-youtube-skill-maker-main-world-ready";

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
}

async function handleTranscriptRequest(event: CustomEvent<RequestDetail>): Promise<void> {
  const requestId = event.detail?.requestId;
  if (!requestId) {
    return;
  }

  try {
    const existing = readTranscriptPanel();
    if (existing) {
      sendResponse({ requestId, ok: true, transcript: existing, source: "youtube-transcript-panel-existing" });
      return;
    }

    const fromCommand = await openTranscriptWithYouTubeCommand();
    if (fromCommand) {
      sendResponse({ requestId, ok: true, transcript: fromCommand, source: "youtube-transcript-panel-command" });
      return;
    }

    const fromPanelClick = await openTranscriptWithVisibleControls();
    if (fromPanelClick) {
      sendResponse({ requestId, ok: true, transcript: fromPanelClick, source: "youtube-transcript-panel-click" });
      return;
    }

    sendResponse({ requestId, ok: false, error: "The transcript panel did not expose readable segments." });
  } catch (error) {
    sendResponse({
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : "The page transcript fallback failed."
    });
  }
}

function sendResponse(detail: ResponseDetail): void {
  document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, { detail }));
}

async function openTranscriptWithYouTubeCommand(): Promise<string> {
  await waitForYouTubeMetadata();

  const commandElement = findTranscriptCommandElement();
  if (!commandElement) {
    return "";
  }

  commandElement.scrollIntoView?.({ block: "center" });
  runYouTubeCommand(commandElement);

  const transcript = await waitForTranscriptText(9000);
  if (transcript) {
    return transcript;
  }

  activateElement(commandElement);
  return waitForTranscriptText(9000);
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
  return waitForTranscriptText(9000);
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
    await delay(300);
  }

  return "";
}

function readTranscriptPanel(): string {
  const segments = getTranscriptSegmentElements();
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

function getTranscriptSegmentElements(): Element[] {
  const selectors = [
    "ytd-transcript-segment-renderer",
    "ytd-engagement-panel-section-list-renderer[target-id*='transcript'] [role='button']",
    "ytd-video-description-transcript-section-renderer [role='button']",
    "ytd-transcript-search-panel-renderer [role='button']"
  ];

  return dedupeElements(selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)))).filter(
    (element) => /\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(normalizeText(element.textContent || ""))
  );
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
