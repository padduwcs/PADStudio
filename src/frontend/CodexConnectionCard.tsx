import type {useCodexConnection} from './useCodexConnection.ts';
import {CheckIcon, LockIcon, SparkIcon} from './icons.tsx';

type CodexConnectionController = ReturnType<typeof useCodexConnection>;

const planLabels: Record<string, string> = {
  free: 'Free',
  go: 'Go',
  plus: 'Plus',
  pro: 'Pro',
  prolite: 'Pro Lite',
  team: 'Team',
  business: 'Business',
  enterprise: 'Enterprise',
  edu: 'Edu',
};

function formatVerifiedAt(value: string) {
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

export function CodexConnectionCard({
  connection,
}: {
  connection: CodexConnectionController;
}) {
  const {
    status,
    cachedAccount,
    checking,
    login,
    loginPending,
    error,
    verify,
    beginLogin,
  } = connection;
  const connectedStatus =
    status?.state === 'connected' ? status : null;
  const statusMessage =
    status && status.state !== 'connected' ? status.message : '';
  const cachedAccountLabel =
    cachedAccount?.account.type === 'chatgpt'
      ? `Tài khoản ChatGPT · ${
          planLabels[cachedAccount.account.planType] ??
          cachedAccount.account.planType
        }`
      : cachedAccount
        ? 'OpenAI API key'
        : '';

  return (
    <section
      className={`codex-connection-card${
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
          Kết nối thực với Codex
        </span>

        {connectedStatus ? (
          <>
            <strong>Codex đã sẵn sàng</strong>
            <p>
              {connectedStatus.account.type === 'chatgpt'
                ? connectedStatus.account.email || 'Tài khoản ChatGPT'
                : 'OpenAI API key'}
              {connectedStatus.account.type === 'chatgpt' &&
                ` · ${
                  planLabels[connectedStatus.account.planType] ??
                  connectedStatus.account.planType
                }`}
            </p>
            <small>
              Đã làm mới phiên và kiểm tra dịch vụ lúc{' '}
              {formatVerifiedAt(connectedStatus.verifiedAt)}
            </small>
          </>
        ) : loginPending ? (
          <>
            <strong>Đang chờ bạn hoàn tất đăng nhập</strong>
            <p>
              Hoàn thành bước xác thực trong trang Codex vừa mở. PAD Studio
              đang kiểm tra kết nối tự động.
            </p>
            {login && (
              <a href={login.authUrl} target="_blank" rel="noreferrer">
                Mở lại trang đăng nhập
              </a>
            )}
          </>
        ) : cachedAccount ? (
          <>
            <strong>
              {checking
                ? 'Đang khôi phục phiên Codex đã lưu…'
                : 'Phiên Codex vẫn được giữ'}
            </strong>
            <p>
              {cachedAccountLabel}
              {(error || statusMessage) && ` · ${error || statusMessage}`}
            </p>
            <small>
              PAD Studio chỉ yêu cầu đăng nhập lại khi Codex xác nhận phiên đã
              đăng xuất.
            </small>
          </>
        ) : (
          <>
            <strong>
              {checking && !status
                ? 'Đang kiểm tra Codex…'
                : status?.state === 'disconnected'
                  ? 'Phiên Codex đã đăng xuất'
                  : 'Chưa thể xác minh kết nối Codex'}
            </strong>
            <p>
              {error ||
                statusMessage ||
                'PAD Studio sẽ xác minh phiên bằng một request thực tới dịch vụ OpenAI.'}
            </p>
          </>
        )}
      </div>

      <div className="codex-connection-actions">
        {connectedStatus ? (
          <button
            type="button"
            disabled={checking}
            onClick={() => void verify()}
          >
            {checking ? 'Đang kiểm tra…' : 'Kiểm tra lại'}
          </button>
        ) : loginPending ? (
          <span className="codex-polling">
            <span className="spinner dark" />
            Đang xác minh…
          </span>
        ) : status?.state === 'disconnected' ? (
          <button
            className="codex-login-button"
            type="button"
            disabled={checking}
            onClick={() => void beginLogin()}
          >
            {checking ? 'Đang chuẩn bị…' : 'Đăng nhập Codex'}
          </button>
        ) : (
          <button
            type="button"
            disabled={checking}
            onClick={() => void verify()}
          >
            {checking ? 'Đang kiểm tra…' : 'Kiểm tra lại'}
          </button>
        )}
      </div>
    </section>
  );
}
