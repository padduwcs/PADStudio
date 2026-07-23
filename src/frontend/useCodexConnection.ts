import {useCallback, useEffect, useRef, useState} from 'react';
import type {
  CodexConnectionStatus,
  CodexLoginStart,
  CodexModelSummary,
} from '../shared/codex.ts';
import {
  ApiRequestError,
  getCodexModels,
  loginCodexWithApiKey,
  logoutCodex,
  startCodexLogin,
  verifyCodexConnection,
} from './api.ts';
import {
  cacheCodexAccount,
  clearCachedCodexAccount,
  readCachedCodexAccount,
} from './codexConnectionCache.ts';

const LOGIN_POLL_INTERVAL_MS = 2_000;
const LOGIN_TIMEOUT_MS = 5 * 60 * 1_000;
const QUOTA_REFRESH_INTERVAL_MS = 60_000;
const MODEL_STORAGE_KEY = 'pad-studio:codex-model';
const REASONING_STORAGE_KEY = 'pad-studio:codex-reasoning-by-model';

function storedModel() {
  try {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(MODEL_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function storedReasoning(model: string) {
  if (!model) return '';
  try {
    if (typeof window === 'undefined') return '';
    const parsed = JSON.parse(
      window.localStorage.getItem(REASONING_STORAGE_KEY) ?? '{}',
    );
    return parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      typeof parsed[model] === 'string'
      ? parsed[model]
      : '';
  } catch {
    return '';
  }
}

function saveReasoning(model: string, reasoningEffort: string) {
  if (!model || !reasoningEffort) return;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(REASONING_STORAGE_KEY) ?? '{}',
    );
    const selections =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : {};
    window.localStorage.setItem(
      REASONING_STORAGE_KEY,
      JSON.stringify({...selections, [model]: reasoningEffort}),
    );
  } catch {
    // Keep the selection for this session.
  }
}

function preferredReasoning(model: CodexModelSummary) {
  const remembered = storedReasoning(model.model);
  if (model.supportedReasoningEfforts.includes(remembered)) return remembered;
  if (
    model.defaultReasoningEffort &&
    model.supportedReasoningEfforts.includes(model.defaultReasoningEffort)
  ) return model.defaultReasoningEffort;
  return model.supportedReasoningEfforts[0] ?? '';
}

export function useCodexConnection() {
  const [status, setStatus] = useState<CodexConnectionStatus | null>(null);
  const [cachedAccount, setCachedAccount] = useState(() =>
    readCachedCodexAccount(),
  );
  const [checking, setChecking] = useState(true);
  const [login, setLogin] = useState<CodexLoginStart | null>(null);
  const [loginPending, setLoginPending] = useState(false);
  const [error, setError] = useState('');
  const [models, setModels] = useState<CodexModelSummary[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [selectedModel, setSelectedModelState] = useState(storedModel);
  const [selectedReasoningEffort, setSelectedReasoningEffortState] =
    useState('');
  const requestSequence = useRef(0);
  const loginStartedAt = useRef(0);
  const selectedModelRef = useRef(selectedModel);
  const selectedReasoningEffortRef = useRef('');
  const generationReadyRef = useRef(false);
  const modelsRef = useRef<CodexModelSummary[]>([]);
  const connectedRef = useRef(false);

  const refreshModels = useCallback(async () => {
    generationReadyRef.current = false;
    setModelsLoading(true);
    try {
      const available = await getCodexModels();
      modelsRef.current = available;
      setModels(available);
      const selected = available.find(
        (item) => item.model === selectedModelRef.current,
      );
      const nextModel =
        selected ??
        available.find((item) => item.isDefault) ??
        available[0];
      const next = nextModel?.model ?? '';
      selectedModelRef.current = next;
      setSelectedModelState(next);
      const nextReasoning = nextModel ? preferredReasoning(nextModel) : '';
      selectedReasoningEffortRef.current = nextReasoning;
      generationReadyRef.current = Boolean(
        nextModel &&
          (nextModel.supportedReasoningEfforts.length === 0 || nextReasoning),
      );
      setSelectedReasoningEffortState(nextReasoning);
      if (nextReasoning) saveReasoning(next, nextReasoning);
      try {
        if (next) window.localStorage.setItem(MODEL_STORAGE_KEY, next);
      } catch {
        // Model selection can remain session-only if storage is unavailable.
      }
      return available;
    } catch (requestError) {
      setModels([]);
      modelsRef.current = [];
      generationReadyRef.current = false;
      selectedReasoningEffortRef.current = '';
      setSelectedReasoningEffortState('');
      setError(
        requestError instanceof ApiRequestError
          ? requestError.message
          : 'Không thể tải danh sách model Codex.',
      );
      return [];
    } finally {
      setModelsLoading(false);
    }
  }, []);

  const verify = useCallback(async (background = false) => {
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;

    if (!background) setChecking(true);
    setError('');

    try {
      const connectionStatus = await verifyCodexConnection();
      if (requestSequence.current !== requestId) return connectionStatus;

      if (
        background &&
        connectedRef.current &&
        connectionStatus.state !== 'connected'
      ) {
        setError(`Chưa thể làm mới quota: ${connectionStatus.message}`);
        return connectionStatus;
      }

      setStatus(connectionStatus);
      if (connectionStatus.state === 'connected') {
        connectedRef.current = true;
        setCachedAccount(
          cacheCodexAccount(
            connectionStatus.account,
            connectionStatus.verifiedAt,
          ),
        );
        setLoginPending(false);
        setLogin(null);
        if (!background || modelsRef.current.length === 0) {
          await refreshModels();
        }
      } else if (connectionStatus.state === 'disconnected') {
        connectedRef.current = false;
        generationReadyRef.current = false;
        clearCachedCodexAccount();
        setCachedAccount(null);
      } else {
        connectedRef.current = false;
        generationReadyRef.current = false;
      }
      return connectionStatus;
    } catch (requestError) {
      if (requestSequence.current !== requestId) return null;

      const message =
        requestError instanceof ApiRequestError
          ? requestError.message
          : 'Không thể kiểm tra kết nối Codex.';
      if (background && connectedRef.current) {
        setError(`Chưa thể làm mới quota: ${message}`);
        return null;
      }
      connectedRef.current = false;
      setStatus({
        state: 'error',
        message,
        checkedAt: new Date().toISOString(),
      });
      setError(message);
      generationReadyRef.current = false;
      return null;
    } finally {
      if (!background && requestSequence.current === requestId) {
        setChecking(false);
      }
    }
  }, [refreshModels]);

  useEffect(() => {
    void verify();
  }, [verify]);

  useEffect(() => {
    if (status?.state !== 'connected' || loginPending) return;
    const interval = window.setInterval(() => {
      void verify(true);
    }, QUOTA_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [loginPending, status?.state, verify]);

  useEffect(() => {
    if (!loginPending) return;

    let active = true;
    let timeout = 0;
    const poll = async () => {
      if (Date.now() - loginStartedAt.current > LOGIN_TIMEOUT_MS) {
        setLoginPending(false);
        setError(
          'Đã hết thời gian chờ đăng nhập. Bạn có thể bắt đầu lại khi sẵn sàng.',
        );
        return;
      }

      await verify(true);
      if (active) {
        timeout = window.setTimeout(poll, LOGIN_POLL_INTERVAL_MS);
      }
    };

    void poll();
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [loginPending, verify]);

  async function beginLogin() {
    setChecking(true);
    setError('');

    try {
      const loginSession = await startCodexLogin();
      setLogin(loginSession);
      loginStartedAt.current = Date.now();
      setLoginPending(true);

      const loginWindow = window.open(
        loginSession.authUrl,
        '_blank',
        'noopener,noreferrer',
      );
      loginWindow?.focus();
    } catch (requestError) {
      setError(
        requestError instanceof ApiRequestError
          ? requestError.message
          : 'Không thể bắt đầu đăng nhập Codex.',
      );
    } finally {
      setChecking(false);
    }
  }

  async function useApiKey(apiKey: string) {
    setChecking(true);
    setError('');
    try {
      const connectionStatus = await loginCodexWithApiKey(apiKey);
      setStatus(connectionStatus);
      if (connectionStatus.state === 'connected') {
        connectedRef.current = true;
        setCachedAccount(
          cacheCodexAccount(
            connectionStatus.account,
            connectionStatus.verifiedAt,
          ),
        );
        await refreshModels();
        return true;
      }
      connectedRef.current = false;
      setError(connectionStatus.message);
      return false;
    } catch (requestError) {
      connectedRef.current = false;
      setError(
        requestError instanceof ApiRequestError
          ? requestError.message
          : 'Không thể đăng nhập Codex bằng API key.',
      );
      return false;
    } finally {
      setChecking(false);
    }
  }

  async function logout() {
    setChecking(true);
    setError('');
    try {
      await logoutCodex();
      clearCachedCodexAccount();
      setCachedAccount(null);
      setStatus({
        state: 'disconnected',
        message: 'Phiên Codex đã đăng xuất.',
        checkedAt: new Date().toISOString(),
      });
      connectedRef.current = false;
      setModels([]);
      modelsRef.current = [];
      selectedModelRef.current = '';
      selectedReasoningEffortRef.current = '';
      generationReadyRef.current = false;
      setSelectedModelState('');
      setSelectedReasoningEffortState('');
      setLogin(null);
      setLoginPending(false);
    } catch (requestError) {
      setError(
        requestError instanceof ApiRequestError
          ? requestError.message
          : 'Không thể đăng xuất Codex.',
      );
    } finally {
      setChecking(false);
    }
  }

  function selectModel(model: string) {
    const selected = models.find((item) => item.model === model);
    if (!selected) return;
    selectedModelRef.current = model;
    setSelectedModelState(model);
    const nextReasoning = preferredReasoning(selected);
    selectedReasoningEffortRef.current = nextReasoning;
    generationReadyRef.current = Boolean(
      selected.supportedReasoningEfforts.length === 0 || nextReasoning,
    );
    setSelectedReasoningEffortState(nextReasoning);
    if (nextReasoning) saveReasoning(model, nextReasoning);
    try {
      window.localStorage.setItem(MODEL_STORAGE_KEY, model);
    } catch {
      // Keep the selection for this session.
    }
  }

  function selectReasoningEffort(reasoningEffort: string) {
    const selected = models.find((item) => item.model === selectedModel);
    if (!selected?.supportedReasoningEfforts.includes(reasoningEffort)) return;
    selectedReasoningEffortRef.current = reasoningEffort;
    generationReadyRef.current = true;
    setSelectedReasoningEffortState(reasoningEffort);
    saveReasoning(selected.model, reasoningEffort);
  }

  const selectedModelSummary =
    models.find((item) => item.model === selectedModel) ?? null;
  const generationReady = Boolean(
    status?.state === 'connected' &&
      !modelsLoading &&
      selectedModelSummary &&
      (selectedModelSummary.supportedReasoningEfforts.length === 0 ||
        selectedReasoningEffort),
  );

  function getGenerationSelection() {
    if (!generationReadyRef.current) return null;
    return {
      model: selectedModelRef.current || undefined,
      reasoningEffort: selectedReasoningEffortRef.current || undefined,
    };
  }

  return {
    status,
    cachedAccount,
    checking,
    login,
    loginPending,
    error,
    models,
    modelsLoading,
    selectedModel,
    selectedModelSummary,
    selectedReasoningEffort,
    generationReady,
    connected: status?.state === 'connected',
    verify,
    beginLogin,
    useApiKey,
    logout,
    selectModel,
    selectReasoningEffort,
    getGenerationSelection,
  };
}
