import { describe, expect, it } from "vitest";
import {
  extractGeminiText,
  getCandidateFlashModels,
  normalizeGeminiErrorMessage,
  parseGeminiSkillJson
} from "./gemini";

describe("gemini helpers", () => {
  it("extracts text from a Gemini response", () => {
    expect(
      extractGeminiText({
        candidates: [{ content: { parts: [{ text: "{\"skillName\":" }, { text: "\"demo\"}" }] } }]
      })
    ).toBe("{\"skillName\":\"demo\"}");
  });

  it("parses fenced JSON responses", () => {
    expect(parseGeminiSkillJson("```json\n{\"skillName\":\"demo-skill\"}\n```")).toEqual({
      skillName: "demo-skill"
    });
  });

  it("prefers the provided flash model before fallbacks", () => {
    expect(getCandidateFlashModels("gemini-2.0-flash-exp")).toEqual([
      "gemini-2.0-flash-exp",
      "gemini-2.5-flash",
      "gemini-flash-latest",
      "gemini-2.0-flash"
    ]);
  });

  it("falls back to stable flash models when the input is not flash", () => {
    expect(getCandidateFlashModels("gemini-2.5-pro")).toEqual([
      "gemini-2.5-flash",
      "gemini-flash-latest",
      "gemini-2.0-flash"
    ]);
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
