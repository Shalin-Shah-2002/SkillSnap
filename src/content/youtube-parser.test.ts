import { describe, expect, it } from "vitest";
import {
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

describe("youtube-parser", () => {
  it("extracts ytInitialPlayerResponse JSON from script text", () => {
    const script = `var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":"https://example.com/cap","languageCode":"en"}]}}}; window.x = 1;`;
    const response = extractPlayerResponseFromText(script);
    expect(getCaptionTracks(response)).toHaveLength(1);
  });

  it("extracts YouTube initial data and config from page HTML", () => {
    const html = `
      <script>ytcfg.set({"INNERTUBE_API_KEY":"key","INNERTUBE_CONTEXT":{"client":{"clientName":"WEB"}},"INNERTUBE_CONTEXT_CLIENT_NAME":1});</script>
      <script>var ytInitialData = {"engagementPanels":[{"content":{"continuationItemRenderer":{"continuationEndpoint":{"getTranscriptEndpoint":{"params":"abc123"}}}}}]};</script>
    `;

    expect(extractYouTubeConfigFromText(html)?.INNERTUBE_API_KEY).toBe("key");
    expect(findTranscriptEndpointParams(extractInitialDataFromText(html))).toBe("abc123");
  });

  it("prefers manual English captions", () => {
    const selected = selectCaptionTrack([
      { baseUrl: "https://example.com/asr", languageCode: "en", kind: "asr" },
      { baseUrl: "https://example.com/es", languageCode: "es" },
      { baseUrl: "https://example.com/en", languageCode: "en" }
    ]);

    expect(selected?.baseUrl).toBe("https://example.com/en");
  });

  it("parses json3 captions into timestamped lines", () => {
    const transcript = parseJson3Transcript(
      JSON.stringify({
        events: [
          { tStartMs: 1000, segs: [{ utf8: "Hello " }, { utf8: "there" }] },
          { tStartMs: 2000, segs: [{ utf8: "\n" }] },
          { tStartMs: 61000, segs: [{ utf8: "Next step" }] }
        ]
      })
    );

    expect(transcript).toBe("[00:01] Hello there\n[01:01] Next step");
  });

  it("parses legacy XML captions into timestamped lines", () => {
    const transcript = parseXmlTranscript(
      `<transcript><text start="1.2">Hello &amp; welcome</text><text start="61">Next step</text></transcript>`
    );

    expect(transcript).toBe("[00:01] Hello & welcome\n[01:01] Next step");
  });

  it("parses srv3 XML captions into timestamped lines", () => {
    const transcript = parseXmlTranscript(
      `<timedtext><body><p t="1234" d="2000"><s>Hello </s><s>there</s></p><p t="61000"><s>Next &quot;step&quot;</s></p></body></timedtext>`
    );

    expect(transcript).toBe("[00:01] Hello there\n[01:01] Next \"step\"");
  });

  it("parses vtt captions into timestamped lines", () => {
    const transcript = parseVttTranscript(`WEBVTT

00:00:01.200 --> 00:00:03.000
Hello <c>there</c>

00:01:01.000 --> 00:01:02.000
Next &amp; final step`);

    expect(transcript).toBe("[00:01] Hello there\n[01:01] Next & final step");
  });

  it("parses Innertube transcript cue renderers", () => {
    const transcript = parseInnertubeTranscript({
      actions: [
        {
          updateEngagementPanelAction: {
            content: {
              transcriptRenderer: {
                body: {
                  transcriptBodyRenderer: {
                    cueGroups: [
                      {
                        transcriptCueGroupRenderer: {
                          cues: [
                            {
                              transcriptCueRenderer: {
                                startOffsetMs: "1200",
                                cue: { runs: [{ text: "Hello " }, { text: "there" }] }
                              }
                            },
                            {
                              transcriptCueRenderer: {
                                startOffsetMs: "61000",
                                cue: { simpleText: "Next step" }
                              }
                            }
                          ]
                        }
                      }
                    ]
                  }
                }
              }
            }
          }
        }
      ]
    });

    expect(transcript).toBe("[00:01] Hello there\n[01:01] Next step");
  });

  it("sets the caption format query parameter", () => {
    expect(captionUrlWithFormat("https://example.com/caption?lang=en&fmt=srv3", "json3")).toBe(
      "https://example.com/caption?lang=en&fmt=json3"
    );
  });
});
