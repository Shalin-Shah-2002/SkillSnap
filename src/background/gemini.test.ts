import { describe, expect, it } from "vitest";
import { extractGeminiText, GeminiProvider, normalizeGeminiErrorMessage } from "./gemini";
import { parseSkillDraftJson } from "../shared/parseSkillJson";
import { NvidiaNimProvider } from "./nvidiaNim";
import { OpenCodeGoProvider, OpenCodeZenProvider } from "./opencode";
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

describe("provider registry", () => {
  it("returns a provider instance for each id", () => {
    expect(getProvider("gemini").id).toBe("gemini");
    expect(getProvider("opencode-zen").id).toBe("opencode-zen");
    expect(getProvider("opencode-go").id).toBe("opencode-go");
    expect(getProvider("nvidia-nim").id).toBe("nvidia-nim");
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

describe("OpenCode Zen provider", () => {
  it("uses the user model first in its candidate list", () => {
    const provider = new OpenCodeZenProvider();
    const list = provider.getCandidateModels("claude-sonnet-4-5");
    expect(list[0]).toBe("claude-sonnet-4-5");
  });

  it("includes Claude, GPT, and open models in its curated list", () => {
    const provider = new OpenCodeZenProvider();
    const ids = provider.models.map((m) => m.id);
    expect(ids).toContain("gpt-5-nano");
    expect(ids).toContain("claude-haiku-4-5");
    expect(ids).toContain("kimi-k2.6");
  });
});

describe("OpenCode Go provider", () => {
  it("uses a smaller curated list suited for the Go tier", () => {
    const provider = new OpenCodeGoProvider();
    const ids = provider.models.map((m) => m.id);
    expect(ids).toContain("gpt-5-nano");
    expect(ids).toContain("claude-haiku-4-5");
    expect(ids).toContain("deepseek-v4-flash");
  });

  it("exposes the new Go-tier model ids", () => {
    const provider = new OpenCodeGoProvider();
    const ids = provider.models.map((m) => m.id);
    expect(ids).toContain("minimax-m2.5");
    expect(ids).toContain("minimax-m2.7");
    expect(ids).toContain("minimax-m3");
    expect(ids).toContain("qwen3-6-plus");
    expect(ids).toContain("qwen3-7-max");
    expect(ids).toContain("qwen3-7-plus");
    expect(ids).toContain("glm-5");
    expect(ids).toContain("glm-5.1");
    expect(ids).toContain("kimi-k2.5");
    expect(ids).toContain("kimi-k2.6");
    expect(ids).toContain("mimo-v2.5");
    expect(ids).toContain("mimo-v2.5-pro");
    expect(ids).toContain("deepseek-v4-pro");
  });
});

describe("NVIDIA NIM provider", () => {
  it("includes the user model and the fallback list", () => {
    const provider = new NvidiaNimProvider();
    const list = provider.getCandidateModels("meta/llama-3.3-70b-instruct");
    expect(list[0]).toBe("meta/llama-3.3-70b-instruct");
    expect(list).toContain("nvidia/llama-3.1-nemotron-ultra-253b-v1");
  });

  it("exposes curated NIM models", () => {
    const provider = new NvidiaNimProvider();
    const ids = provider.models.map((m) => m.id);
    expect(ids).toContain("meta/llama-3.3-70b-instruct");
    expect(ids).toContain("nvidia/llama-3.1-nemotron-ultra-253b-v1");
    expect(ids).toContain("qwen/qwen3-coder-480b-a35b-instruct");
  });
});
