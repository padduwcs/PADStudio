import {useState} from 'react';
import type {useCodexConnection} from './useCodexConnection.ts';
import {CheckIcon, ClockIcon, LockIcon, SparkIcon} from './icons.tsx';
import {
  estimateCodexWait,
  formatCodexWaitEstimate,
  type CodexGenerationTask,
} from './codexWaitEstimate.ts';

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

const reasoningLabels: Record<string, string> = {
  none: 'Không suy luận',
  minimal: 'Tối thiểu',
  low: 'Thấp',
  medium: 'Trung bình',
  high: 'Cao',
  xhigh: 'Rất cao',
  max: 'Tối đa',
  ultra: 'Siêu cao',
};

const taskLabels: Record<CodexGenerationTask, string> = {
  outline: 'mạch giảng',
  voiceVisual: 'kế hoạch voice–visual',
  motionCanvas: 'bộ scene Motion Canvas',
};

function formatVerifiedAt(value: string) {
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function CodexConnectionCard({
  connection,
  task = 'outline',
  workUnits = 1,
}: {
  connection: CodexConnectionController;
  task?: CodexGenerationTask;
  workUnits?: number;
}) {
  const {
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
    verify,
    beginLogin,
    useApiKey,
    logout,
    selectModel,
    selectReasoningEffort,
  } = connection;
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const connectedStatus = status?.state === 'connected' ? status : null;
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
  const connectedAccountLabel = connectedStatus
    ? connectedStatus.account.type === 'chatgpt'
      ? `${connectedStatus.account.email || 'Tài khoản ChatGPT'} · ${
          planLabels[connectedStatus.account.planType] ??
          connectedStatus.account.planType
        }`
      : 'Đang dùng OpenAI API key'
    : '';
  const waitEstimate =
    selectedModel && selectedReasoningEffort
      ? estimateCodexWait({
          model: selectedModel,
          reasoningEffort: selectedReasoningEffort,
          task,
          workUnits,
        })
      : null;
  const slowReasoning =
    Boolean(selectedReasoningEffort) &&
    !['none', 'minimal', 'low', 'medium'].includes(selectedReasoningEffort);

  const headline = connectedStatus
    ? 'Codex đã sẵn sàng'
    : loginPending
      ? 'Đang chờ đăng nhập'
      : cachedAccount
        ? checking
          ? 'Đang khôi phục phiên'
          : 'Phiên Codex đã được lưu'
        : checking && !status
          ? 'Đang kiểm tra Codex'
          : status?.state === 'disconnected'
            ? 'Kết nối Codex'
            : 'Cần kiểm tra lại kết nối';
  const statusLabel = connectedStatus
    ? 'Đã kết nối'
    : loginPending || checking
      ? 'Đang xử lý'
      : status?.state === 'disconnected'
        ? 'Chưa kết nối'
        : 'Gián đoạn';
  const description = connectedStatus
    ? connectedAccountLabel
    : loginPending
      ? 'Hoàn tất xác thực trong trang Codex vừa mở. PAD Studio sẽ tự nhận kết nối.'
      : cachedAccount
        ? `${cachedAccountLabel}${
            error || statusMessage ? ` · ${error || statusMessage}` : ''
          }`
        : error ||
          statusMessage ||
          'Đăng nhập bằng ChatGPT hoặc dùng API key để bắt đầu.';

  function toggleApiKeyForm() {
    setShowApiKey((visible) => {
      if (visible) setApiKey('');
      return !visible;
    });
  }

  return (
    <section
      className={`codex-connection-card codex-service-card${
        connectedStatus ? ' is-connected' : ''
      }${loginPending || checking ? ' is-busy' : ''}`}
      aria-live="polite"
    >
      <div className="codex-service-summary">
        <span className="codex-connection-icon" aria-hidden="true">
          {connectedStatus ? <CheckIcon /> : <SparkIcon />}
        </span>

        <div className="codex-service-identity">
          <span className="codex-connection-label">
            <LockIcon />
            OpenAI Codex
          </span>
          <div className="codex-service-title">
            <strong>{headline}</strong>
            <span
              className={`codex-status-pill${
                connectedStatus
                  ? ' is-positive'
                  : loginPending || checking
                    ? ' is-progress'
                    : ' is-neutral'
              }`}
            >
              <span aria-hidden="true" />
              {statusLabel}
            </span>
          </div>
          <p>
            {description}
            {loginPending && login && (
              <>
                {' '}
                <a href={login.authUrl} target="_blank" rel="noreferrer">
                  Mở lại trang đăng nhập
                </a>
              </>
            )}
          </p>
        </div>

        <div className="codex-connection-actions">
          {connectedStatus ? (
            <>
              <button
                type="button"
                disabled={checking}
                onClick={() => void verify()}
              >
                {checking ? 'Đang kiểm tra…' : 'Kiểm tra'}
              </button>
              <button
                className="codex-logout-button"
                type="button"
                disabled={checking}
                onClick={() => void logout()}
              >
                Đăng xuất
              </button>
            </>
          ) : loginPending ? (
            <span className="codex-polling">
              <span className="spinner dark" />
              Đang xác minh
            </span>
          ) : status?.state === 'disconnected' ? (
            <>
              <button
                className="codex-login-button"
                type="button"
                disabled={checking}
                onClick={() => {
                  setShowApiKey(false);
                  setApiKey('');
                  void beginLogin();
                }}
              >
                {checking ? 'Đang chuẩn bị…' : 'Đăng nhập ChatGPT'}
              </button>
              <button
                type="button"
                disabled={checking}
                aria-expanded={showApiKey}
                onClick={toggleApiKeyForm}
              >
                {showApiKey ? 'Đóng' : 'Dùng API key'}
              </button>
            </>
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
      </div>

      {connectedStatus && (
        <div className="codex-config-panel">
          <div className="codex-config-controls">
            <label className="codex-model-picker">
              <span>Model</span>
              <select
                value={selectedModel}
                disabled={modelsLoading || models.length === 0}
                onChange={(event) => selectModel(event.target.value)}
              >
                {models.map((model) => (
                  <option value={model.model} key={model.id}>
                    {model.displayName}
                    {model.isDefault ? ' · mặc định' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="codex-model-picker">
              <span>Mức suy luận</span>
              <select
                value={selectedReasoningEffort}
                disabled={
                  modelsLoading ||
                  !selectedModelSummary ||
                  selectedModelSummary.supportedReasoningEfforts.length === 0
                }
                onChange={(event) =>
                  selectReasoningEffort(event.target.value)
                }
              >
                {selectedModelSummary?.supportedReasoningEfforts.map(
                  (reasoningEffort) => (
                    <option value={reasoningEffort} key={reasoningEffort}>
                      {reasoningLabels[reasoningEffort] ?? reasoningEffort}
                      {reasoningEffort ===
                      selectedModelSummary.defaultReasoningEffort
                        ? ' · mặc định'
                        : ''}
                    </option>
                  ),
                )}
              </select>
            </label>

            {waitEstimate && (
              <div
                className={`codex-wait-estimate${
                  slowReasoning ? ' is-slow' : ''
                }`}
              >
                <ClockIcon />
                <span>
                  <small>Ước tính tạo {taskLabels[task]}</small>
                  <strong>{formatCodexWaitEstimate(waitEstimate)}</strong>
                  <small>
                    {waitEstimate.basis === 'observed'
                      ? `Từ ${waitEstimate.sampleCount} lần gần nhất`
                      : 'Ước tính ban đầu'}
                    {slowReasoning ? ' · dùng nhiều token hơn' : ''}
                  </small>
                </span>
              </div>
            )}
          </div>

          <div className="codex-config-meta">
            <span>
              Xác minh lúc {formatVerifiedAt(connectedStatus.verifiedAt)}
            </span>
            {modelsLoading && <span>Đang cập nhật model…</span>}
            {error && (
              <span className="connection-inline-error" role="alert">
                {error} Việc sinh nội dung tạm khóa đến khi model sẵn sàng.
              </span>
            )}
          </div>
        </div>
      )}

      {showApiKey && !connectedStatus && !loginPending && (
        <form
          className="codex-api-key-form codex-api-key-panel"
          onSubmit={(event) => {
            event.preventDefault();
            void useApiKey(apiKey).then((connected) => {
              if (!connected) return;
              setApiKey('');
              setShowApiKey(false);
            });
          }}
        >
          <label>
            <span>OpenAI API key</span>
            <input
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Dán API key"
              autoFocus
            />
          </label>
          <button type="submit" disabled={checking || !apiKey.trim()}>
            {checking ? 'Đang xác minh…' : 'Xác minh và kết nối'}
          </button>
          <small>
            Key chỉ được chuyển tới Codex app-server, không lưu trong project
            hoặc trình duyệt.
          </small>
        </form>
      )}
    </section>
  );
}
