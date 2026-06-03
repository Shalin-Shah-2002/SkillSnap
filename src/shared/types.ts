export interface VideoContext {
  videoId: string;
  url: string;
  title: string;
  channel: string;
  transcript: string;
  transcriptSource: string;
  captionLanguage?: string;
  capturedAt: string;
}

export interface SkillDraft {
  skillName: string;
  displayName: string;
  description: string;
  triggerGuidance: string;
  workflow: string[];
  importantDetails: string[];
  limitations: string[];
  videoSummary: string;
  referenceNotes: string[];
}

export interface SkillPackage {
  skillName: string;
  skillMd: string;
  referenceMd: string;
  transcriptMd: string;
}

export interface GeneratedSkills {
  sourceVideo: VideoContext;
  draft: SkillDraft;
  codex: SkillPackage;
  claude: SkillPackage;
}

export interface ExtensionSettings {
  geminiApiKey: string;
  geminiModel: string;
}

export type RuntimeRequest =
  | {
      type: "GENERATE_SKILLS";
      video: VideoContext;
      preferredSkillName?: string;
    }
  | {
      type: "GET_SETTINGS_STATUS";
    };

export type ContentRequest = {
  type: "GET_YOUTUBE_CONTEXT";
};

export type RuntimeResponse<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: string;
    };
