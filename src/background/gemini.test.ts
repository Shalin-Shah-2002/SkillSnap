import { describe, expect, it } from "vitest";
import {
  extractGeminiText,
  GeminiProvider,
  normalizeGeminiErrorMessage,
  requestGeminiTextWithFallback,
  testGeminiApiKey
} from "./gemini";
import { parseSkillDraftJson } from "../shared/parseSkillJson";
import { getProvider } from "./providers";
import { PROVIDER_LIST } from "../shared/providers";

describe("gemini helpers", () => {
  it("extracts text from a Gemini response", () => {
    expect(
      extractGeminiText({
        candidates: [{ content: { parts: [{ text: "{\"skillName\":" }, { text: "\"demo\"}" }] } }]
      })
    ).toBe("{\"skillName\":\"demo\"}");
  });

  it("parses fenced JSON responses via shared parser", () => {
    expect(parseSkillDraftJson("```json\n{\"skillName\":\"demo-skill\"}\n```")).toEqual({
      skillName: "demo-skill"
    });
  });

  it("prefers the provided flash model before fallbacks", () => {
    expect(new GeminiProvider().getCandidateModels("gemini-2.0-flash-exp")).toEqual([
      "gemini-2.0-flash-exp",
      "gemini-2.5-flash",
      "gemini-flash-latest",
      "gemini-2.0-flash"
    ]);
  });

  it("falls back to stable flash models when the input is not flash", () => {
    expect(new GeminiProvider().getCandidateModels("gemini-2.5-pro")).toEqual([
      "gemini-2.5-flash",
      "gemini-flash-latest",
      "gemini-2.0-flash"
    ]);
  });

  it("exposes curated Gemini models", () => {
    expect(new GeminiProvider().models.length).toBeGreaterThan(0);
    expect(new GeminiProvider().defaultModel).toBe("gemini-2.5-flash");
  });

  it("redacts suspended key errors and gives a recovery message", () => {
    expect(
      normalizeGeminiErrorMessage(
        "Permission denied: Consumer 'api_key:AIzaSyCcHYSChtBfXDNgj94XDNryA6kFKzyAGGE' has been suspended.",
        403
      )
    ).toBe("This Gemini API key has been suspended. Open Settings and replace it with a new active key.");
  });

  it("maps invalid key errors to a friendlier message", () => {
    expect(normalizeGeminiErrorMessage("API key not valid. Please pass a valid API key.", 400)).toBe(
      "This Gemini API key is invalid. Open Settings and paste a valid Gemini API key."
    );
  });
});

describe("testGeminiApiKey", () => {
  it("returns ok=false when all candidate endpoints reject the key", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { message: "API key invalid" } }), {
          status: 401
        })
      )) as typeof fetch;
    try {
      const result = await testGeminiApiKey("AIza-test");
      expect(result.ok).toBe(false);
      expect(result.message).toContain("401");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("requestGeminiTextWithFallback", () => {
  it("returns generated text with usage metadata", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "review output" }] } }],
            usageMetadata: { totalTokenCount: 42 }
          }),
          { status: 200 }
        )
      )) as typeof fetch;
    try {
      const result = await requestGeminiTextWithFallback({
        apiKey: "AIza-test",
        model: "gemini-2.5-flash",
        prompt: "hello"
      });
      expect(result.text).toBe("review output");
      expect(result.totalTokens).toBe(42);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("provider registry", () => {
  it("returns the gemini provider instance", () => {
    expect(getProvider("gemini").id).toBe("gemini");
  });

  it("exposes curated model lists for every provider", () => {
    for (const provider of PROVIDER_LIST) {
      const impl = getProvider(provider.id);
      expect(impl.models.length).toBeGreaterThan(0);
      expect(impl.defaultModel).toBe(provider.defaultModel);
      expect(impl.models.some((m) => m.id === provider.defaultModel)).toBe(true);
    }
  });
});
