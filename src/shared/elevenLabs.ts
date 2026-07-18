export interface ElevenLabsSubscriptionSummary {
  tier: string;
  status: string;
  characterCount: number;
  characterLimit: number;
  nextResetAt: string | null;
}

export interface ElevenLabsCapabilities {
  textToSpeechModels: number;
  supportsVietnamese: boolean;
}

export type ElevenLabsConnectionStatus =
  | {
      state: 'connected';
      subscription: ElevenLabsSubscriptionSummary;
      capabilities: ElevenLabsCapabilities;
      verifiedAt: string;
    }
  | {
      state:
        | 'not_configured'
        | 'disconnected'
        | 'restricted'
        | 'unavailable'
        | 'error';
      message: string;
      checkedAt: string;
    };

export interface ElevenLabsVoiceSummary {
  voiceId: string;
  name: string;
  category: string | null;
  description: string | null;
  previewUrl: string | null;
  labels: Record<string, string>;
  verifiedLanguages: string[];
  highQualityBaseModelIds: string[];
  isOwner: boolean;
  requiresPaidApiOnFreeTier: boolean;
}

export interface ElevenLabsModelSummary {
  modelId: string;
  name: string;
  description: string | null;
  languages: string[];
  maximumTextLengthPerRequest: number | null;
  costMultiplier: number;
  canUseStyle: boolean;
  canUseSpeakerBoost: boolean;
}

export interface ElevenLabsUsagePreset {
  id: string;
  source: 'pad-studio' | 'elevenlabs-history';
  voiceId: string;
  voiceName: string;
  modelId: string;
  modelName: string;
  usedAt: string;
  successfulGenerations: number;
  settings: {
    stability: number;
    similarityBoost: number;
    style: number;
    useSpeakerBoost: boolean;
    speed: number;
  } | null;
  timingCalibration: {
    whitespaceTokensPerMinute: number;
    charactersPerSecond: number;
  } | null;
}

export interface ElevenLabsCatalog {
  voices: ElevenLabsVoiceSummary[];
  models: ElevenLabsModelSummary[];
  recentPresets: ElevenLabsUsagePreset[];
  history: {
    available: boolean;
    message: string | null;
  };
}

export interface ElevenLabsSharedVoiceSearch {
  available: boolean;
  message: string | null;
  voices: ElevenLabsVoiceSummary[];
}
