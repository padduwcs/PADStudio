import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {ElevenLabsCatalog} from '../shared/elevenLabs.ts';
import type {
  ElevenLabsVoiceSettings,
  GenerateVoice,
  TopicProject,
} from '../shared/topic.ts';
import {
  voiceIsStale,
  voicePrerequisitesAreReady,
} from '../shared/projectPipeline.ts';
import {
  ApiRequestError,
  approveVoice,
  generateVoice,
  getElevenLabsCatalog,
  getProject,
  searchElevenLabsSharedVoices,
} from './api.ts';

const defaultSettings: ElevenLabsVoiceSettings = {
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0,
  useSpeakerBoost: true,
  speed: 1,
};

interface PendingVoiceGeneration {
  fingerprint: string;
  generationId: string;
}

function pendingGenerationKey(projectId: string) {
  return `pad-studio:voice-generation:${projectId}`;
}

function readPendingGeneration(projectId: string): PendingVoiceGeneration | null {
  try {
    const source = window.sessionStorage.getItem(
      pendingGenerationKey(projectId),
    );
    if (!source) return null;
    const value = JSON.parse(source) as Partial<PendingVoiceGeneration>;
    if (
      typeof value.fingerprint !== 'string' ||
      typeof value.generationId !== 'string' ||
      !/^[0-9a-f-]{36}$/iu.test(value.generationId)
    ) {
      window.sessionStorage.removeItem(pendingGenerationKey(projectId));
      return null;
    }
    return {
      fingerprint: value.fingerprint,
      generationId: value.generationId,
    };
  } catch {
    return null;
  }
}

function writePendingGeneration(
  projectId: string,
  pending: PendingVoiceGeneration,
) {
  try {
    window.sessionStorage.setItem(
      pendingGenerationKey(projectId),
      JSON.stringify(pending),
    );
  } catch {
    // The backend checkpoint still prevents paid chunks from being lost.
  }
}

function clearPendingGeneration(projectId: string) {
  try {
    window.sessionStorage.removeItem(pendingGenerationKey(projectId));
  } catch {
    // sessionStorage may be unavailable in a restricted browser context.
  }
}

export interface VoiceDraftConfiguration {
  voiceId: string;
  modelId: string;
  outputFormat: string;
  settings: ElevenLabsVoiceSettings;
  seed: number | null;
}

export function useVoiceDraft(projectId: string) {
  const [project, setProject] = useState<TopicProject | null>(null);
  const [catalog, setCatalog] = useState<ElevenLabsCatalog | null>(null);
  const [configuration, setConfiguration] =
    useState<VoiceDraftConfiguration | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [catalogError, setCatalogError] = useState('');
  const [actionError, setActionError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [libraryMessage, setLibraryMessage] = useState('');
  const generationRequestRef = useRef<PendingVoiceGeneration | null>(
    readPendingGeneration(projectId),
  );
  const generatingRef = useRef(false);
  const approvingRef = useRef(false);

  const applyCatalogDefaults = useCallback(
    (nextCatalog: ElevenLabsCatalog, currentProject: TopicProject) => {
      setConfiguration((current) => {
        if (current) return current;
        const stored = currentProject.voiceBundle?.configuration;
        if (stored) {
          return {
            voiceId: stored.voiceId,
            modelId: stored.modelId,
            outputFormat: stored.outputFormat,
            settings: stored.settings,
            seed: stored.seed,
          };
        }
        const recent = nextCatalog.recentPresets[0];
        const voice =
          nextCatalog.voices.find(
            (item) =>
              item.voiceId === recent?.voiceId &&
              !item.requiresPaidApiOnFreeTier,
          ) ??
          nextCatalog.voices.find(
            (item) =>
              !item.requiresPaidApiOnFreeTier &&
              item.labels.use_case === 'informative_educational',
          ) ??
          nextCatalog.voices.find(
            (item) => !item.requiresPaidApiOnFreeTier,
          ) ??
          nextCatalog.voices[0];
        const preferredModel =
          nextCatalog.models.find(
            (model) =>
              model.modelId === recent?.modelId &&
              model.languages.includes('vi'),
          ) ??
          nextCatalog.models.find(
            (model) =>
              model.modelId === 'eleven_v3' &&
              model.languages.includes('vi'),
          ) ??
          voice?.highQualityBaseModelIds
            .map((modelId) =>
              nextCatalog.models.find(
                (model) =>
                  model.modelId === modelId &&
                  model.languages.includes('vi'),
              ),
            )
            .find((model) => model !== undefined) ??
          nextCatalog.models.find((model) =>
            model.languages.includes('vi'),
          ) ??
          nextCatalog.models[0];
        if (!voice || !preferredModel) return null;
        return {
          voiceId: voice.voiceId,
          modelId: preferredModel.modelId,
          outputFormat: 'mp3_44100_128',
          settings: {
            ...(recent?.settings ?? defaultSettings),
            style: preferredModel.canUseStyle
              ? (recent?.settings?.style ?? defaultSettings.style)
              : 0,
            useSpeakerBoost: preferredModel.canUseSpeakerBoost
              ? (recent?.settings?.useSpeakerBoost ??
                defaultSettings.useSpeakerBoost)
              : false,
          },
          seed: null,
        };
      });
    },
    [],
  );

  const load = useCallback(async () => {
    setLoadState('loading');
    setLoadError('');
    try {
      const nextProject = await getProject(projectId);
      if (
        generationRequestRef.current &&
        nextProject.voiceBundle?.generation.generationId ===
          generationRequestRef.current.generationId
      ) {
        generationRequestRef.current = null;
        clearPendingGeneration(projectId);
      }
      setProject(nextProject);
      setLoadState('ready');
      setCatalogLoading(true);
      try {
        const nextCatalog = await getElevenLabsCatalog();
        setCatalog(nextCatalog);
        applyCatalogDefaults(nextCatalog, nextProject);
      } catch (error) {
        setCatalogError(
          error instanceof Error
            ? error.message
            : 'Không thể tải danh mục ElevenLabs.',
        );
      } finally {
        setCatalogLoading(false);
      }
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : 'Không thể mở project.',
      );
      setLoadState('error');
    }
  }, [applyCatalogDefaults, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const searchVoices = useCallback(
    async (search: string, shared = false) => {
      setCatalogLoading(true);
      setCatalogError('');
      try {
        if (shared) {
          const result = await searchElevenLabsSharedVoices(search);
          setLibraryMessage(result.message ?? '');
          setCatalog((current) =>
            current ? {...current, voices: result.voices} : current,
          );
          return;
        }
        const nextCatalog = await getElevenLabsCatalog(search);
        setCatalog(nextCatalog);
        setLibraryMessage('');
        if (project) applyCatalogDefaults(nextCatalog, project);
      } catch (error) {
        setCatalogError(
          error instanceof Error
            ? error.message
            : 'Không thể tìm voice ElevenLabs.',
        );
      } finally {
        setCatalogLoading(false);
      }
    },
    [applyCatalogDefaults, project],
  );

  function updateConfiguration(
    update:
      | Partial<VoiceDraftConfiguration>
      | ((
          current: VoiceDraftConfiguration,
        ) => VoiceDraftConfiguration),
  ) {
    setConfiguration((current) => {
      if (!current) return current;
      return typeof update === 'function'
        ? update(current)
        : {...current, ...update};
    });
    setActionError('');
  }

  function applyPreset(presetId: string) {
    const preset = catalog?.recentPresets.find(
      (item) => item.id === presetId,
    );
    if (!preset) return;
    updateConfiguration((current) => {
      const presetVoice = catalog?.voices.find(
        (item) => item.voiceId === preset.voiceId,
      );
      const presetModel = catalog?.models.find(
        (item) =>
          item.modelId === preset.modelId &&
          item.languages.includes('vi'),
      );
      const recommendedModel =
        presetModel ??
        catalog?.models.find(
          (model) =>
            model.modelId === 'eleven_v3' &&
            model.languages.includes('vi'),
        ) ??
        presetVoice?.highQualityBaseModelIds
          .map((modelId) =>
            catalog?.models.find(
              (model) =>
                model.modelId === modelId &&
                model.languages.includes('vi'),
            ),
          )
          .find((model) => model !== undefined) ??
        catalog?.models.find(
          (model) =>
            model.modelId === current.modelId &&
            model.languages.includes('vi'),
        );
      const nextSettings = preset.settings ?? current.settings;
      return {
        ...current,
        voiceId: preset.voiceId,
        modelId: recommendedModel?.modelId ?? current.modelId,
        settings: {
          ...nextSettings,
          style: recommendedModel?.canUseStyle
            ? nextSettings.style
            : 0,
          useSpeakerBoost:
            Boolean(recommendedModel?.canUseSpeakerBoost) &&
            nextSettings.useSpeakerBoost,
        },
      };
    });
  }

  const ready = project ? voicePrerequisitesAreReady(project) : false;
  const stale = project ? voiceIsStale(project) : false;

  async function generate() {
    if (!project || !configuration || generatingRef.current || conflict) return null;
    generatingRef.current = true;
    setGenerating(true);
    setActionError('');
    try {
      const requestConfiguration = {
        ...configuration,
      };
      const fingerprint = JSON.stringify({
        projectId: project.id,
        revision: project.revision,
        configuration: requestConfiguration,
      });
      const previousRequest = generationRequestRef.current;
      const generationId =
        previousRequest?.fingerprint === fingerprint
          ? previousRequest.generationId
          : crypto.randomUUID();
      generationRequestRef.current = {fingerprint, generationId};
      writePendingGeneration(project.id, {fingerprint, generationId});
      const request: GenerateVoice = {
        generationId,
        ...requestConfiguration,
      };
      const updated = await generateVoice(
        project.id,
        request,
        project.revision,
      );
      setProject(updated);
      generationRequestRef.current = null;
      clearPendingGeneration(project.id);
      return updated;
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'PROJECT_CONFLICT') {
        setConflict(true);
        if (error.currentProject) setProject(error.currentProject);
      }
      setActionError(
        error instanceof Error ? error.message : 'Không thể tạo voice.',
      );
      return null;
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  }

  async function approve() {
    if (!project || approvingRef.current || conflict) return null;
    approvingRef.current = true;
    setApproving(true);
    setActionError('');
    try {
      const updated = await approveVoice(project.id, project.revision);
      setProject(updated);
      return updated;
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'PROJECT_CONFLICT') {
        setConflict(true);
        if (error.currentProject) setProject(error.currentProject);
      }
      setActionError(
        error instanceof Error ? error.message : 'Không thể chốt voice.',
      );
      return null;
    } finally {
      approvingRef.current = false;
      setApproving(false);
    }
  }

  const selectedVoice = useMemo(
    () =>
      catalog?.voices.find(
        (voice) => voice.voiceId === configuration?.voiceId,
      ) ?? null,
    [catalog, configuration?.voiceId],
  );
  const selectedModel = useMemo(
    () =>
      catalog?.models.find(
        (model) => model.modelId === configuration?.modelId,
      ) ?? null,
    [catalog, configuration?.modelId],
  );

  return {
    project,
    catalog,
    configuration,
    selectedVoice,
    selectedModel,
    loadState,
    loadError,
    catalogLoading,
    catalogError,
    actionError,
    generating,
    approving,
    conflict,
    libraryMessage,
    ready,
    stale,
    reload: load,
    searchVoices,
    updateConfiguration,
    applyPreset,
    generate,
    approve,
  };
}
