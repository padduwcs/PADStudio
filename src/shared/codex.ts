export type CodexAccountSummary =
  | {
      type: 'chatgpt';
      email: string | null;
      planType: string;
    }
  | {
      type: 'apiKey';
    };

export type CodexConnectionStatus =
  | {
      state: 'connected';
      account: CodexAccountSummary;
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
