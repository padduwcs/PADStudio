import {useEffect, useMemo, useState} from 'react';
import type {NarrationDocument, TopicProject} from '../shared/topic.ts';
import {
  reviewedPronunciationText,
  type PronunciationRule,
} from '../shared/pronunciation.ts';
import {
  ApiRequestError,
  approveProjectNarration,
  auditProjectNarration,
  deleteLibraryPronunciationRule,
  getProject,
  getProjectNarration,
  saveLibraryPronunciationRule,
  saveProjectNarration,
} from './api.ts';
import {CodexConnectionCard} from './CodexConnectionCard.tsx';
import {CheckIcon, PlusIcon, SparkIcon, TrashIcon} from './icons.tsx';
import {
  navigate,
  projectProductionPath,
  projectContentPath,
  registerNavigationGuard,
} from './router.ts';
import {useCodexConnection} from './useCodexConnection.ts';
import {
  clearPageDraft,
  readPageDraft,
  savePageDraft,
} from './pageDraft.ts';

type RuleDraft = {
  id: string | null;
  scope: 'project' | 'library';
  source: string;
  spoken: string;
};

const emptyRule: RuleDraft = {
  id: null,
  scope: 'project',
  source: '',
  spoken: '',
};

function isRuleDraft(value: RuleDraft | null): value is RuleDraft {
  return Boolean(
    value &&
      (value.id === null || typeof value.id === 'string') &&
      (value.scope === 'project' || value.scope === 'library') &&
      typeof value.source === 'string' &&
      typeof value.spoken === 'string',
  );
}

function hasRuleDraft(value: RuleDraft) {
  return Boolean(value.id || value.source.trim() || value.spoken.trim());
}

function sameRules(left: readonly PronunciationRule[], right: readonly PronunciationRule[]) {
  return JSON.stringify([...left].sort((a, b) => a.id.localeCompare(b.id))) ===
    JSON.stringify([...right].sort((a, b) => a.id.localeCompare(b.id)));
}

function RuleList({
  title,
  rules,
  onEdit,
  onRemove,
}: {
  title: string;
  rules: PronunciationRule[];
  onEdit: (rule: PronunciationRule) => void;
  onRemove: (rule: PronunciationRule) => void;
}) {
  return (
    <section className="pronunciation-rule-list">
      <header><strong>{title}</strong><span>{rules.length}</span></header>
      {rules.length === 0 ? <p>Chưa có quy tắc.</p> : <ul>{rules.map(rule => (
        <li key={rule.id}>
          <button type="button" className="rule-main" onClick={() => onEdit(rule)}><code>{rule.source}</code><span>→</span><strong>{rule.spoken}</strong></button>
          <button type="button" className="rule-remove" aria-label={`Xóa quy tắc ${rule.source}`} onClick={() => onRemove(rule)}><TrashIcon /></button>
        </li>
      ))}</ul>}
    </section>
  );
}

export function NarrationPage({projectId}: {projectId: string}) {
  const [project, setProject] = useState<TopicProject | null>(null);
  const [narration, setNarration] = useState<NarrationDocument | null>(null);
  const [libraryRules, setLibraryRules] = useState<PronunciationRule[]>([]);
  const [projectRules, setProjectRules] = useState<PronunciationRule[]>([]);
  const [draft, setDraft] = useState<RuleDraft>(emptyRule);
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'auditing' | 'approving' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [snapshotDirty, setSnapshotDirty] = useState(false);
  const [ruleSaving, setRuleSaving] = useState(false);
  const codex = useCodexConnection();

  useEffect(() => {
    let active = true;
    setState('loading');
    void Promise.all([getProject(projectId), getProjectNarration(projectId)])
      .then(([loadedProject, payload]) => {
        if (!active) return;
        const storedDraft = readPageDraft<RuleDraft>('narration', projectId);
        setProject(loadedProject);
        setNarration(payload.narration);
        setProjectRules(payload.narration?.projectRules ?? []);
        setLibraryRules(payload.libraryRules);
        setSnapshotDirty(false);
        setDraft(isRuleDraft(storedDraft) ? storedDraft : emptyRule);
        setState('ready');
      })
      .catch(reason => {
        if (!active) return;
        setState('error');
        setMessage(reason instanceof ApiRequestError ? reason.message : 'Không thể mở bước cách đọc.');
      });
    return () => { active = false; };
  }, [projectId]);

  const allRules = useMemo(
    () => [...libraryRules, ...projectRules],
    [libraryRules, projectRules],
  );
  const preview = useMemo(() => narration
    ? reviewedPronunciationText(
        narration.sourceText,
        allRules,
        snapshotDirty ? [] : narration.review?.aiPatches ?? [],
      )
    : '', [allRules, narration, snapshotDirty]);
  const projectRulesDirty = Boolean(narration && !sameRules(projectRules, narration.projectRules));
  const rulesChangedSinceReview = Boolean(
    narration?.review && !sameRules(allRules, narration.review.rules),
  );
  const needsSave = !narration?.review || snapshotDirty || projectRulesDirty || rulesChangedSinceReview;
  const hasPendingChanges =
    snapshotDirty ||
    projectRulesDirty ||
    rulesChangedSinceReview ||
    hasRuleDraft(draft);
  const approved = Boolean(
    !needsSave && narration?.review && narration.approvedSourceHash === narration.review.sourceHash,
  );

  useEffect(() => {
    if (!hasRuleDraft(draft)) {
      clearPageDraft('narration', projectId);
      return;
    }
    savePageDraft('narration', draft, projectId);
  }, [draft, projectId]);

  useEffect(() => {
    if (!hasPendingChanges) return;
    return registerNavigationGuard(() => {
      if (ruleSaving || state === 'saving' || state === 'auditing' || state === 'approving') {
        return false;
      }
      return window.confirm(
        'Cách đọc đang có thay đổi chưa được chốt. Bản nháp quy tắc đã được giữ trong tab này. Bạn có muốn rời trang?',
      );
    });
  }, [hasPendingChanges, ruleSaving, state]);

  useEffect(() => {
    if (!hasPendingChanges) return;
    const preventUnsavedUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', preventUnsavedUnload);
    return () => window.removeEventListener('beforeunload', preventUnsavedUnload);
  }, [hasPendingChanges]);

  function installProject(nextProject: TopicProject) {
    setProject(nextProject);
    setNarration(nextProject.narration ?? null);
    setProjectRules(nextProject.narration?.projectRules ?? []);
    setSnapshotDirty(false);
  }

  async function persistProjectRules(nextRules: PronunciationRule[]) {
    if (!project || !narration) throw new Error('Không tìm thấy bản đọc của project.');
    const saved = await saveProjectNarration(
      project.id,
      {sourceText: narration.sourceText, projectRules: nextRules},
      project.revision,
    );
    installProject(saved);
    return saved;
  }

  async function saveSnapshot() {
    if (!project || !narration) return null;
    setState('saving');
    setMessage('');
    try {
      const saved = await saveProjectNarration(
        project.id,
        {sourceText: narration.sourceText, projectRules},
        project.revision,
      );
      installProject(saved);
      setState('ready');
      setMessage('Bản đọc đã được cập nhật theo từ điển hiện tại.');
      return saved;
    } catch (reason) {
      setState('error');
      setMessage(reason instanceof ApiRequestError ? reason.message : 'Không thể lưu bản đọc.');
      return null;
    }
  }

  async function runAudit() {
    let current = project;
    if (!current || !narration) return;
    if (needsSave) {
      current = await saveSnapshot();
      if (!current) return;
    }
    setState('auditing');
    setMessage('');
    try {
      const status = await codex.verify();
      const selection = codex.getGenerationSelection('pronunciation');
      if (status?.state !== 'connected' || !selection) {
        setState('ready');
        setMessage('Hãy kết nối Codex và chọn model/reasoning trước khi rà soát.');
        return;
      }
      const audited = await auditProjectNarration(current.id, {
        generationId: crypto.randomUUID(),
        ...selection,
      }, current.revision);
      installProject(audited);
      setState('ready');
      setMessage(audited.narration?.review?.aiPatches.length
        ? 'AI đã bổ sung các cách đọc cần chú ý. Hãy kiểm tra preview trước khi duyệt.'
        : 'AI không thấy ký hiệu kỹ thuật nào cần bổ sung.');
    } catch (reason) {
      setState('error');
      setMessage(reason instanceof ApiRequestError ? reason.message : 'AI chưa thể rà soát cách đọc lúc này.');
    }
  }

  async function approve() {
    if (!project || !narration?.review) return;
    if (needsSave) {
      setMessage('Hãy lưu bản đọc đang xem trước khi duyệt.');
      return;
    }
    setState('approving');
    setMessage('');
    try {
      const approvedProject = await approveProjectNarration(project.id, {
        sourceHash: narration.review.sourceHash,
        rulesHash: narration.review.rulesHash,
      }, project.revision);
      installProject(approvedProject);
      setState('ready');
      setMessage('Đã duyệt bản đọc. Đây là snapshot sẽ được dùng để tạo audio.');
    } catch (reason) {
      setState('error');
      setMessage(reason instanceof ApiRequestError ? reason.message : 'Không thể duyệt bản đọc.');
    }
  }

  async function saveRule() {
    const source = draft.source.trim();
    const spoken = draft.spoken.trim();
    if (!source || !spoken) {
      setMessage('Mỗi quy tắc cần có phần gốc và cách đọc.');
      return;
    }
    const ruleDraft = {...draft, source, spoken};
    const input = {source, spoken, origin: 'user' as const, caseSensitive: false};
    setRuleSaving(true);
    setMessage('');
    try {
      if (ruleDraft.scope === 'library') {
        const saved = await saveLibraryPronunciationRule(input, ruleDraft.id ?? undefined);
        setLibraryRules(current => [...current.filter(rule => rule.id !== saved.id), saved]);
        setSnapshotDirty(true);
      } else {
        const saved: PronunciationRule = {
          ...input,
          id: ruleDraft.id ?? crypto.randomUUID(),
          scope: 'project',
        };
        const nextRules = [...projectRules.filter(rule => rule.id !== saved.id), saved];
        await persistProjectRules(nextRules);
      }
      setDraft(emptyRule);
      setMessage(ruleDraft.scope === 'project'
        ? 'Đã lưu quy tắc vào project và cập nhật bản đọc.'
        : 'Đã lưu quy tắc dùng chung. Preview được cập nhật ngay.');
    } catch (reason) {
      setMessage(reason instanceof ApiRequestError ? reason.message : 'Không thể lưu quy tắc từ điển.');
    } finally {
      setRuleSaving(false);
    }
  }

  async function removeRule(rule: PronunciationRule) {
    setRuleSaving(true);
    setMessage('');
    try {
      if (rule.scope === 'library') {
        await deleteLibraryPronunciationRule(rule.id);
        setLibraryRules(current => current.filter(item => item.id !== rule.id));
        setSnapshotDirty(true);
      } else {
        await persistProjectRules(projectRules.filter(item => item.id !== rule.id));
      }
      if (draft.id === rule.id) setDraft(emptyRule);
    } catch (reason) {
      setMessage(reason instanceof ApiRequestError ? reason.message : 'Không thể xóa quy tắc.');
    } finally {
      setRuleSaving(false);
    }
  }

  if (state === 'loading') return <div className="page-state" role="status"><span className="spinner dark" /><strong>Đang mở cách đọc…</strong></div>;
  if (!narration) return <div className="page-state is-error" role="alert"><strong>Project chưa có lời thoại</strong><p>Hãy quay lại bước nội dung để nhập lời thoại gốc.</p><button type="button" onClick={() => navigate(projectContentPath(projectId))}>Quay lại nội dung</button></div>;

  return (
    <main className="pronunciation-workspace">
      <div className="page-heading">
        <div className="eyebrow">
          <span>Bước 02 · Cách đọc</span>
          <div className="eyebrow-line" />
        </div>
        <h1>Duyệt bản đọc cho ElevenLabs</h1>
        <p>Quy tắc được áp dụng trước; AI chỉ rà soát ký hiệu dễ đọc sai, không viết lại lời thoại.</p>
      </div>
      <details className="pronunciation-codex"><summary>Thiết lập AI rà soát</summary><CodexConnectionCard connection={codex} task="pronunciation" /></details>
      <div className="pronunciation-layout">
        <section className="pronunciation-preview-card">
          <header><div><span className="preview-kicker">Bản gửi ElevenLabs</span><h2>{approved ? 'Đã duyệt' : needsSave ? 'Có thay đổi chưa lưu' : 'Sẵn sàng kiểm tra'}</h2></div>{approved && <span className="approved-badge"><CheckIcon /> Đã duyệt</span>}</header>
          <article className="pronunciation-preview" aria-live="polite">{preview}</article>
          <div className="pronunciation-actions">
            <button className="secondary-button" type="button" disabled={!needsSave || state === 'saving' || state === 'auditing'} onClick={() => void saveSnapshot()}>{state === 'saving' ? 'Đang cập nhật…' : 'Cập nhật bản đọc'}</button>
            <button className="secondary-button" type="button" disabled={state === 'auditing' || state === 'saving'} onClick={() => void runAudit()}>{state === 'auditing' ? 'AI đang rà soát…' : <><SparkIcon /> Rà soát bằng AI</>}</button>
            <button className="submit-button" type="button" disabled={needsSave || state === 'approving'} onClick={() => void approve()}>{state === 'approving' ? 'Đang duyệt…' : 'Duyệt voice'}</button>
            {approved && <button className="secondary-button" type="button" onClick={() => navigate(projectProductionPath(projectId))}>Tạo audio & scene</button>}
          </div>
          {message && <p className={state === 'error' ? 'submit-error' : 'pronunciation-message'} role={state === 'error' ? 'alert' : 'status'}>{message}</p>}
          {narration.review?.aiPatches.length ? <section className="ai-patches"><strong>AI vừa lưu ý</strong><ul>{narration.review.aiPatches.map(patch => <li key={`${patch.start}-${patch.end}`}><code>{patch.source}</code><span>→ {patch.spoken}</span><small>{patch.reason}</small>{patch.suggestedRule && <button type="button" onClick={() => setDraft({id: null, scope: 'project', source: patch.suggestedRule!.source, spoken: patch.suggestedRule!.spoken})}>Dùng làm quy tắc</button>}</li>)}</ul></section> : null}
        </section>
        <aside className="pronunciation-dictionary">
          <header><span className="preview-kicker">Từ điển cách đọc</span><p>Sửa ở đây, preview thay đổi ngay. “Dùng chung” sẽ xuất hiện ở các project sau.</p></header>
          <div className="rule-editor">
            <label><span>Văn bản gốc</span><input value={draft.source} maxLength={300} disabled={ruleSaving} placeholder="Ví dụ: logarithm, O(n), a[i]" onChange={event => { const source = event.currentTarget.value; setDraft(current => ({...current, source})); }} /></label>
            <label><span>Cách ElevenLabs đọc</span><input value={draft.spoken} maxLength={600} disabled={ruleSaving} placeholder="Ví dụ: lô-ga-rít" onChange={event => { const spoken = event.currentTarget.value; setDraft(current => ({...current, spoken})); }} /></label>
            <div className="rule-editor-actions"><label><span>Phạm vi</span><select value={draft.scope} disabled={Boolean(draft.id) || ruleSaving} onChange={event => { const scope = event.currentTarget.value as RuleDraft['scope']; setDraft(current => ({...current, scope})); }}><option value="project">Project này</option><option value="library">Dùng chung</option></select></label><button type="button" className="secondary-button" disabled={ruleSaving || !draft.source.trim() || !draft.spoken.trim()} onClick={() => void saveRule()}><PlusIcon /> {ruleSaving ? 'Đang lưu…' : draft.id ? 'Lưu quy tắc' : 'Thêm quy tắc'}</button></div>
            {draft.id && <button type="button" className="text-button" onClick={() => setDraft(emptyRule)}>Hủy chỉnh sửa</button>}
          </div>
          <RuleList title="Project này" rules={projectRules} onEdit={rule => setDraft({id: rule.id, scope: 'project', source: rule.source, spoken: rule.spoken})} onRemove={rule => void removeRule(rule)} />
          <RuleList title="Dùng chung" rules={libraryRules} onEdit={rule => setDraft({id: rule.id, scope: 'library', source: rule.source, spoken: rule.spoken})} onRemove={rule => void removeRule(rule)} />
        </aside>
      </div>
    </main>
  );
}
