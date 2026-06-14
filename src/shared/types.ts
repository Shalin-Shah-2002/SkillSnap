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
  outputFormat: string;
  workflow: string[];
  importantDetails: string[];
  examples: SkillExample[];
  limitations: string[];
  videoSummary: string;
  referenceNotes: string[];
  starterEvalCases: SkillDraftEvalCase[];
}

export interface SkillExample {
  input: string;
  output: string;
}

export interface SkillDraftEvalCase {
  prompt: string;
  expectedOutput: string;
  assertions: string[];
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

import type { ProviderId } from "./providers";
import type { SkillLibraryConfig, SkillLibraryEntry } from "./skillLibraryTypes";
import type { SkillReviewSession } from "./skillReviewTypes";

export interface ProviderSettings {
  apiKey: string;
  model: string;
}

export interface ExtensionSettings {
  activeProvider: ProviderId;
  providers: Record<ProviderId, ProviderSettings>;
}

export type RuntimeRequest =
  | {
      type: "GENERATE_SKILLS";
      video: VideoContext;
      preferredSkillName?: string;
    }
  | {
      type: "GET_SETTINGS_STATUS";
    }
  | {
      type: "OPEN_EXTENSION_UI";
    }
  | {
      type: "FETCH_CAPTION_URL";
      url: string;
    }
  | {
      type: "TEST_API_KEY";
      apiKey: string;
    }
  | {
      type: "LIBRARY_LIST";
    }
  | {
      type: "LIBRARY_GET";
      id: string;
    }
  | {
      type: "LIBRARY_DELETE";
      id: string;
    }
  | {
      type: "LIBRARY_REBUILD_ZIP";
      id: string;
      kind: "codex" | "claude";
    }
  | {
      type: "LIBRARY_SET_ZIP";
      id: string;
      kind: "codex" | "claude";
      base64: string;
    }
  | {
      type: "LIBRARY_GET_CONFIG";
    }
  | {
      type: "LIBRARY_SET_SOFT_CAP";
      softCap: number;
    }
  | {
      type: "LIBRARY_RESAVE";
      id: string;
      files: {
        codex: { skill: string; reference: string; transcript: string };
        claude: { skill: string; reference: string; transcript: string };
      };
      skillName: string;
      displayName: string;
      skillNameHint?: string;
    }
  | {
      type: "SKILL_REVIEW_CREATE";
      entryId: string;
      kind?: "codex" | "claude";
    }
  | {
      type: "SKILL_REVIEW_STEP";
      sessionId: string;
    }
  | {
      type: "SKILL_REVIEW_SAVE_FEEDBACK";
      sessionId: string;
      evalCaseId: string;
      feedback: string;
    }
  | {
      type: "SKILL_REVIEW_IMPROVE";
      sessionId: string;
    }
  | {
      type: "SKILL_REVIEW_APPLY_IMPROVEMENT";
      sessionId: string;
    }
  | {
      type: "SKILL_REVIEW_LIST";
      entryId?: string;
    };

export type ContentRequest = {
  type: "GET_YOUTUBE_CONTEXT";
};

export type LibraryListResult = {
  entries: SkillLibraryEntry[];
  config: SkillLibraryConfig;
};

export type LibraryRebuildZipResult = {
  base64: string;
  fileName: string;
  cached: boolean;
};

export type SkillReviewListResult = {
  sessions: SkillReviewSession[];
};

export type SkillReviewApplyResult = {
  entry: SkillLibraryEntry;
  session: SkillReviewSession;
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
