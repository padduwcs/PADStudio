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
