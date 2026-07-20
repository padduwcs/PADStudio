import {useState} from 'react';
import type {useCodexConnection} from './useCodexConnection.ts';
import {CheckIcon, LockIcon, SparkIcon} from './icons.tsx';
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
    second: '2-digit',
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
    !['none', 'minimal', 'low', 'medium'].includes(
      selectedReasoningEffort,
    );

  function toggleApiKeyForm() {
    setShowApiKey((visible) => {
      if (visible) setApiKey('');
      return !visible;
    });
  }

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
            <label className="codex-model-picker">
              <span>Model dùng để sinh nội dung</span>
              <select
                value={selectedModel}
                disabled={modelsLoading || models.length === 0}
                onChange={(event) => selectModel(event.target.value)}
              >
                {models.map((model) => (
                  <option value={model.model} key={model.id}>
                    {model.displayName}{model.isDefault ? ' · mặc định' : ''}
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
            {modelsLoading && (
              <small>Đang cập nhật model và capability reasoning từ Codex…</small>
            )}
            {error && (
              <small className="connection-inline-error" role="alert">
                {error} Việc sinh nội dung được khóa cho tới khi catalog sẵn sàng.
              </small>
            )}
            {waitEstimate && (
              <div className={`codex-wait-estimate${slowReasoning ? ' is-slow' : ''}`}>
                <ClockEstimateIcon />
                <span>
                  Ước tính tạo {taskLabels[task]}:{' '}
                  <strong>{formatCodexWaitEstimate(waitEstimate)}</strong>
                  <small>
                    {waitEstimate.basis === 'observed'
                      ? `Dựa trên ${waitEstimate.sampleCount} lần thành công gần nhất trên máy này.`
                      : 'Khoảng tham khảo ban đầu; sẽ tự hiệu chỉnh sau các lần sinh thành công.'}
                    {slowReasoning
                      ? ' Mức suy luận cao có thể chờ lâu và dùng nhiều token hơn.'
                      : ''}
                  </small>
                </span>
              </div>
            )}
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
          <>
            <button
              type="button"
              disabled={checking}
              onClick={() => void verify()}
            >
              {checking ? 'Đang kiểm tra…' : 'Kiểm tra lại'}
            </button>
            <button type="button" disabled={checking} onClick={() => void logout()}>
              Đăng xuất
            </button>
          </>
        ) : loginPending ? (
          <span className="codex-polling">
            <span className="spinner dark" />
            Đang xác minh…
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
            <button type="button" disabled={checking} onClick={toggleApiKeyForm}>
              Dùng API key
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
      {showApiKey && !connectedStatus && !loginPending && (
        <form
          className="codex-api-key-form"
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
              placeholder="Dán API key một lần"
            />
          </label>
          <button type="submit" disabled={checking || !apiKey.trim()}>
            Xác minh và lưu bằng Codex
          </button>
          <small>PAD Studio chuyển key một lần cho Codex app-server và không lưu key trong project hay trình duyệt.</small>
        </form>
      )}
    </section>
  );
}

function ClockEstimateIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5l3.25 2" />
    </svg>
  );
}
