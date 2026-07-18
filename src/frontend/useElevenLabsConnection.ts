import {useCallback, useEffect, useRef, useState} from 'react';
import type {ElevenLabsConnectionStatus} from '../shared/elevenLabs.ts';
import {
  ApiRequestError,
  verifyElevenLabsConnection,
} from './api.ts';

export function useElevenLabsConnection() {
  const [status, setStatus] =
    useState<ElevenLabsConnectionStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const requestSequence = useRef(0);

  const verify = useCallback(async () => {
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    setChecking(true);

    try {
      const connectionStatus = await verifyElevenLabsConnection();
      if (requestSequence.current === requestId) {
        setStatus(connectionStatus);
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

  return {
    status,
    checking,
    connected: status?.state === 'connected',
    verify,
  };
}
