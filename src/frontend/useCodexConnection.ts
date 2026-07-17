import {useCallback, useEffect, useRef, useState} from 'react';
import type {
  CodexConnectionStatus,
  CodexLoginStart,
} from '../shared/codex.ts';
import {
  ApiRequestError,
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

export function useCodexConnection() {
  const [status, setStatus] = useState<CodexConnectionStatus | null>(null);
  const [cachedAccount, setCachedAccount] = useState(() =>
    readCachedCodexAccount(),
  );
  const [checking, setChecking] = useState(true);
  const [login, setLogin] = useState<CodexLoginStart | null>(null);
  const [loginPending, setLoginPending] = useState(false);
  const [error, setError] = useState('');
  const requestSequence = useRef(0);
  const loginStartedAt = useRef(0);

  const verify = useCallback(async (background = false) => {
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;

    if (!background) setChecking(true);
    setError('');

    try {
      const connectionStatus = await verifyCodexConnection();
      if (requestSequence.current !== requestId) return connectionStatus;

      setStatus(connectionStatus);
      if (connectionStatus.state === 'connected') {
        setCachedAccount(
          cacheCodexAccount(
            connectionStatus.account,
            connectionStatus.verifiedAt,
          ),
        );
        setLoginPending(false);
        setLogin(null);
      } else if (connectionStatus.state === 'disconnected') {
        clearCachedCodexAccount();
        setCachedAccount(null);
      }
      return connectionStatus;
    } catch (requestError) {
      if (requestSequence.current !== requestId) return null;

      const message =
        requestError instanceof ApiRequestError
          ? requestError.message
          : 'Không thể kiểm tra kết nối Codex.';
      setStatus({
        state: 'error',
        message,
        checkedAt: new Date().toISOString(),
      });
      setError(message);
      return null;
    } finally {
      if (!background && requestSequence.current === requestId) {
        setChecking(false);
      }
    }
  }, []);

  useEffect(() => {
    void verify();
  }, [verify]);

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

  return {
    status,
    cachedAccount,
    checking,
    login,
    loginPending,
    error,
    connected: status?.state === 'connected',
    verify,
    beginLogin,
  };
}
