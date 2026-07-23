export type CodexAccountSummary =
  | {
      type: 'chatgpt';
      email: string | null;
      planType: string;
    }
  | {
      type: 'apiKey';
    };

export interface CodexQuotaWindow {
  usedPercent: number;
  remainingPercent: number;
  windowDurationMinutes: number | null;
  resetsAt: string | null;
}

export interface CodexCreditsSummary {
  hasCredits: boolean;
  unlimited: boolean;
  balance: string | null;
}

export interface CodexIndividualLimitSummary {
  limit: string;
  used: string;
  remainingPercent: number;
  resetsAt: string | null;
}

export interface CodexQuotaSummary {
  limitId: string | null;
  limitName: string | null;
  primary: CodexQuotaWindow | null;
  secondary: CodexQuotaWindow | null;
  credits: CodexCreditsSummary | null;
  individualLimit: CodexIndividualLimitSummary | null;
  rateLimitReachedType: string | null;
  refreshedAt: string;
}

export type CodexConnectionStatus =
  | {
      state: 'connected';
      account: CodexAccountSummary;
      quota: CodexQuotaSummary | null;
      verifiedAt: string;
    }
  | {
      state: 'disconnected' | 'unavailable' | 'error';
      message: string;
      checkedAt: string;
    };

export interface CodexLoginStart {
  loginId: string;
  authUrl: string;
}

export interface CodexModelSummary {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  supportedReasoningEfforts: string[];
  defaultReasoningEffort: string | null;
}
