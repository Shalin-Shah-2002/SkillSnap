import { GeminiProvider } from "./gemini";
import { NvidiaNimProvider } from "./nvidiaNim";
import { OpenCodeGoProvider, OpenCodeZenProvider } from "./opencode";
import type { ProviderId, SkillProvider } from "../shared/providers";

const REGISTRY: Record<ProviderId, SkillProvider> = {
  gemini: new GeminiProvider(),
  "opencode-zen": new OpenCodeZenProvider(),
  "opencode-go": new OpenCodeGoProvider(),
  "nvidia-nim": new NvidiaNimProvider()
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
