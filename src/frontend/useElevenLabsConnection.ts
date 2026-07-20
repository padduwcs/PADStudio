import {useCallback, useEffect, useRef, useState} from 'react';
import type {
  ElevenLabsConnectionStatus,
  ElevenLabsCredentialStatus,
} from '../shared/elevenLabs.ts';
import {
  ApiRequestError,
  getElevenLabsCredentialStatus,
  removeElevenLabsApiKey,
  saveElevenLabsApiKey,
  verifyElevenLabsConnection,
} from './api.ts';

export function useElevenLabsConnection() {
  const [status, setStatus] =
    useState<ElevenLabsConnectionStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [credential, setCredential] =
    useState<ElevenLabsCredentialStatus | null>(null);
  const [error, setError] = useState('');
  const requestSequence = useRef(0);

  const verify = useCallback(async () => {
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    setChecking(true);
    setError('');

    try {
      const [connectionStatus, credentialStatus] = await Promise.all([
        verifyElevenLabsConnection(),
        getElevenLabsCredentialStatus(),
      ]);
      if (requestSequence.current === requestId) {
        setStatus(connectionStatus);
        setCredential(credentialStatus);
      }
      return connectionStatus;
    } catch (error) {
      const failedStatus: ElevenLabsConnectionStatus = {
        state: 'error',
        message:
          error instanceof ApiRequestError
            ? error.message
            : 'Không thể kiểm tra kết nối ElevenLabs.',
        checkedAt: new Date().toISOString(),
      };
      if (requestSequence.current === requestId) {
        setStatus(failedStatus);
      }
      return failedStatus;
    } finally {
      if (requestSequence.current === requestId) {
        setChecking(false);
      }
    }
  }, []);

  useEffect(() => {
    void verify();
  }, [verify]);

  const saveApiKey = useCallback(async (apiKey: string) => {
    setChecking(true);
    setError('');
    try {
      const result = await saveElevenLabsApiKey(apiKey);
      setStatus(result.status);
      setCredential(result.credential);
      return true;
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError
          ? caught.message
          : 'Không thể xác minh và lưu ElevenLabs API key.',
      );
      return false;
    } finally {
      setChecking(false);
    }
  }, []);

  const removeApiKey = useCallback(async () => {
    setChecking(true);
    setError('');
    try {
      setCredential(await removeElevenLabsApiKey());
      setStatus(await verifyElevenLabsConnection());
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError
          ? caught.message
          : 'Không thể xóa ElevenLabs API key đã lưu.',
      );
    } finally {
      setChecking(false);
    }
  }, []);

  return {
    status,
    credential,
    error,
    checking,
    connected: status?.state === 'connected',
    verify,
    saveApiKey,
    removeApiKey,
  };
}
