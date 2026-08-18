import {useState} from 'react';
import type {RuntimeDiagnostics} from '../shared/runtimeDiagnostics.ts';
import {ApiRequestError, getRuntimeDiagnostics} from './api.ts';

function providerMessage(
  provider: RuntimeDiagnostics['providers']['codex'] | RuntimeDiagnostics['providers']['elevenLabs'],
) {
  return provider.state === 'connected'
    ? 'Đã kết nối và sẵn sàng.'
    : provider.message || 'Chưa sẵn sàng.';
}

export function RuntimeDiagnosticsCard() {
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostics | null>(null);
  const [state, setState] = useState<'idle' | 'checking' | 'error'>('idle');
  const [error, setError] = useState('');

  async function inspect() {
    if (state === 'checking') return;
    setState('checking');
    setError('');
    try {
      setDiagnostics(await getRuntimeDiagnostics());
      setState('idle');
    } catch (reason) {
      setState('error');
      setError(
        reason instanceof ApiRequestError
          ? reason.message
          : 'Không thể kiểm tra môi trường lúc này.',
      );
    }
  }

  return (
    <section className="runtime-diagnostics" aria-live="polite">
      <div>
        <span>Môi trường sản xuất</span>
        <strong>Kiểm tra trước khi tạo audio hoặc render</strong>
      </div>
      <button type="button" className="secondary-button" disabled={state === 'checking'} onClick={() => void inspect()}>
        {state === 'checking' ? 'Đang kiểm tra…' : diagnostics ? 'Kiểm tra lại' : 'Kiểm tra môi trường'}
      </button>
      {diagnostics && (
        <ul>
          {Object.entries(diagnostics.tools).map(([name, tool]) => (
            <li key={name} className={tool.available ? 'is-ready' : 'is-missing'}>
              <strong>{name === 'browser' ? 'Chrome/Edge' : name.toUpperCase()}</strong>
              <span>{tool.message}</span>
            </li>
          ))}
          <li className={diagnostics.providers.codex.state === 'connected' ? 'is-ready' : 'is-missing'}>
            <strong>Codex</strong>
            <span>{providerMessage(diagnostics.providers.codex)}</span>
          </li>
          <li className={diagnostics.providers.elevenLabs.state === 'connected' ? 'is-ready' : 'is-missing'}>
            <strong>ElevenLabs</strong>
            <span>{providerMessage(diagnostics.providers.elevenLabs)}</span>
          </li>
        </ul>
      )}
      {error && <p className="submit-error" role="alert">{error}</p>}
    </section>
  );
}
