import {useState} from 'react';
import type {useElevenLabsConnection} from './useElevenLabsConnection.ts';
import {CheckIcon, LockIcon, SparkIcon} from './icons.tsx';

type ElevenLabsConnectionController = ReturnType<
  typeof useElevenLabsConnection
>;

const apiKeysUrl = 'https://elevenlabs.io/app/settings/api-keys';

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function planLabel(value: string) {
  if (!value) return 'Không rõ';
  return `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
}

export function ElevenLabsConnectionCard({
  connection,
}: {
  connection: ElevenLabsConnectionController;
}) {
  const {
    status,
    credential,
    error,
    checking,
    verify,
    saveApiKey,
    removeApiKey,
  } = connection;
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const connectedStatus =
    status?.state === 'connected' ? status : null;

  function toggleApiKeyForm() {
    setShowApiKey((visible) => {
      if (visible) setApiKey('');
      return !visible;
    });
  }

  return (
    <section
      className={`codex-connection-card elevenlabs-connection-card${
        connectedStatus ? ' is-connected' : ''
      }`}
      aria-live="polite"
    >
      <span className="codex-connection-icon" aria-hidden="true">
        {connectedStatus ? <CheckIcon /> : <SparkIcon />}
      </span>

      <div className="codex-connection-content">
        <span className="codex-connection-label">
          <LockIcon />
          Kết nối thực với ElevenLabs
        </span>

        {connectedStatus ? (
          <>
            <strong>Kết nối ElevenLabs đã xác thực</strong>
            <p>
              Gói {planLabel(connectedStatus.subscription.tier)} · Đã dùng{' '}
              {connectedStatus.subscription.characterCount.toLocaleString(
                'vi-VN',
              )}{' '}
              /{' '}
              {connectedStatus.subscription.characterLimit.toLocaleString(
                'vi-VN',
              )}
            </p>
            <small>
              {connectedStatus.capabilities.textToSpeechModels} model TTS
              {connectedStatus.capabilities.supportsVietnamese
                ? ' · Có hỗ trợ tiếng Việt'
                : ' · Chưa thấy tiếng Việt trong catalog'}
              {connectedStatus.subscription.nextResetAt
                ? ` · Làm mới ${formatDateTime(
                    connectedStatus.subscription.nextResetAt,
                  )}`
                : ''}
            </small>
            <small>
              {credential?.source === 'secure-store'
                ? credential.persistence === 'os-protected'
                  ? 'API key được mã hóa bằng tài khoản Windows hiện tại.'
                  : 'API key chỉ được giữ trong phiên backend hiện tại.'
                : credential?.source === 'environment'
                  ? 'Đang dùng API key từ biến môi trường.'
                  : ''}
            </small>
          </>
        ) : status?.state === 'not_configured' ? (
          <>
            <strong>Chưa cấu hình ElevenLabs API key</strong>
            <p>
              Dán API key ngay tại đây; PAD Studio sẽ xác minh bằng subscription
              và catalog thật trước khi lưu.
            </p>
            <small>
              Key không được lưu trong project hoặc trình duyệt và không bao giờ
              được API trả ngược lại.
            </small>
            <a href={apiKeysUrl} target="_blank" rel="noreferrer">
              Tạo API key trên ElevenLabs
            </a>
          </>
        ) : (
          <>
            <strong>
              {checking && !status
                ? 'Đang xác minh ElevenLabs…'
                : 'Chưa thể kết nối ElevenLabs'}
            </strong>
            <p>
              {error || (status && status.state !== 'connected'
                ? status.message
                : 'PAD Studio đang gọi subscription và model catalog thật.')}
            </p>
            <small>
              Key nên có quyền đọc subscription và dùng Text to Speech.
            </small>
            <a href={apiKeysUrl} target="_blank" rel="noreferrer">
              Mở cài đặt API key
            </a>
          </>
        )}
      </div>

      <div className="codex-connection-actions">
        <button type="button" disabled={checking} onClick={() => void verify()}>
          {checking ? 'Đang kiểm tra…' : 'Kiểm tra lại'}
        </button>
        <button
          type="button"
          disabled={checking}
          onClick={toggleApiKeyForm}
        >
          {connectedStatus ? 'Thay API key' : 'Nhập API key'}
        </button>
        {connectedStatus && credential?.source === 'secure-store' && (
          <button
            type="button"
            disabled={checking}
            onClick={() => {
              setShowApiKey(false);
              setApiKey('');
              void removeApiKey();
            }}
          >
            Xóa key đã lưu
          </button>
        )}
      </div>
      {showApiKey && (
        <form
          className="codex-api-key-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveApiKey(apiKey).then((connected) => {
              if (!connected) return;
              setApiKey('');
              setShowApiKey(false);
            });
          }}
        >
          <label>
            <span>ElevenLabs API key</span>
            <input
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Dán API key một lần"
            />
          </label>
          <button type="submit" disabled={checking || !apiKey.trim()}>
            {checking
              ? 'Đang xác minh…'
              : connectedStatus
                ? 'Xác minh và thay key'
                : 'Xác minh thật và lưu an toàn'}
          </button>
          {error && (
            <small className="credential-form-error" role="alert">
              {error} Key đang dùng vẫn được giữ nguyên.
            </small>
          )}
          <small>
            Chỉ lưu sau khi ElevenLabs chấp nhận key và trả về subscription cùng
            model TTS hợp lệ. Khi thay key thất bại, PAD Studio không ghi đè key
            hiện tại.
          </small>
        </form>
      )}
    </section>
  );
}
