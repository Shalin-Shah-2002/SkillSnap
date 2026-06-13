export interface SkillPackageFiles {
  skill: string;
  reference: string;
  transcript: string;
}

export interface SkillLibraryEntryFiles {
  codex: SkillPackageFiles;
  claude: SkillPackageFiles;
}

export type SkillLibraryGeneratedVia = "extension" | "external";

export interface SkillLibraryEntry {
  id: string;
  createdAt: string;
  videoUrl: string;
  videoTitle: string;
  channelName: string;
  skillNameHint?: string;
  skillName: string;
  displayName: string;
  model: string;
  templateId?: string;
  files: SkillLibraryEntryFiles;
  transcript: string;
  codexZip?: string;
  claudeZip?: string;
  generatedVia: SkillLibraryGeneratedVia;
}

export interface SkillLibraryConfig {
  softCap: number;
}

export interface SkillLibraryData {
  entries: SkillLibraryEntry[];
}

export const SKILL_LIBRARY_STORAGE_KEY = "skillLibrary.v1";
export const SKILL_LIBRARY_CONFIG_KEY = "skillLibrary.config";

export const DEFAULT_SKILL_LIBRARY_SOFT_CAP = 50;
export const MIN_SKILL_LIBRARY_SOFT_CAP = 1;
export const MAX_SKILL_LIBRARY_SOFT_CAP = 500;
