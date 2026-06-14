import { GeminiProvider } from "./gemini";
import type { ProviderId, SkillProvider } from "../shared/providers";

const REGISTRY: Record<ProviderId, SkillProvider> = {
  gemini: new GeminiProvider()
};

export function getProvider(id: ProviderId): SkillProvider {
  const provider = REGISTRY[id];
  if (!provider) {
    throw new Error(`Unknown provider: ${id}`);
  }
  return provider;
}

export function listProviders(): SkillProvider[] {
  return Object.values(REGISTRY);
}
