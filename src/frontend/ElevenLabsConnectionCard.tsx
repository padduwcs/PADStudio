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
  const {status, checking, verify} = connection;
  const connectedStatus =
    status?.state === 'connected' ? status : null;

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
          </>
        ) : status?.state === 'not_configured' ? (
          <>
            <strong>Chưa cấu hình ElevenLabs API key</strong>
            <p>
              Thêm <code>ELEVENLABS_API_KEY</code> vào file <code>.env</code>{' '}
              ở thư mục repo rồi khởi động lại PAD Studio.
            </p>
            <small>
              Key chỉ được đọc ở backend và không được trả về trình duyệt.
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
              {status && status.state !== 'connected'
                ? status.message
                : 'PAD Studio đang gọi subscription và model catalog thật.'}
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
        <button
          type="button"
          disabled={checking}
          onClick={() => void verify()}
        >
          {checking ? 'Đang kiểm tra…' : 'Kiểm tra lại'}
        </button>
      </div>
    </section>
  );
}
