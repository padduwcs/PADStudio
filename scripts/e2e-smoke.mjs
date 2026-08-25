import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import os from 'node:os';
import path from 'node:path';

const baseUrl = process.env.PAD_SMOKE_BASE_URL?.trim() || 'http://127.0.0.1:4174';
const allowBillable = process.argv.includes('--allow-billable');
const keepProject = !process.argv.includes('--delete-project');

if (!allowBillable) {
  console.info(`PAD Studio end-to-end smoke

Usage:
  npm run smoke:e2e -- --allow-billable

This intentionally spends a small amount of Codex and ElevenLabs quota. It
creates a short project, generates narration, visual intent, voice and Motion
Canvas scenes, synchronizes them, commits an unchanged editor layout, and
renders the final MP4. The project is retained by default as test evidence.`);
  process.exit(0);
}

const startedAt = Date.now();
const timings = [];
let project = null;

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function elapsed(milliseconds) {
  return `${(milliseconds / 1_000).toFixed(1)}s`;
}

async function step(label, operation) {
  const stepStartedAt = Date.now();
  console.info(`[start] ${label}`);
  const result = await operation();
  const durationMs = Date.now() - stepStartedAt;
  timings.push({label, durationMs});
  console.info(`[pass]  ${label} (${elapsed(durationMs)})`);
  return result;
}

async function api(pathname, {method = 'GET', body, revision, headers = {}} = {}) {
  const url = new URL(pathname, baseUrl);
  const serializedBody = body === undefined ? null : JSON.stringify(body);
  const response = await new Promise((resolve, reject) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = send(url, {
      method,
      headers: {
        ...(serializedBody === null
          ? {}
          : {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(serializedBody),
            }),
        ...(revision === undefined ? {} : {'If-Match': `"${revision}"`}),
        ...headers,
      },
    });
    request.once('error', reject);
    request.once('response', (incoming) => {
      const chunks = [];
      incoming.on('data', (chunk) => chunks.push(chunk));
      incoming.once('error', reject);
      incoming.once('end', () =>
        resolve({
          ok:
            incoming.statusCode !== undefined &&
            incoming.statusCode >= 200 &&
            incoming.statusCode < 300,
          status: incoming.statusCode ?? 0,
          contentType: String(incoming.headers['content-type'] ?? ''),
          text: Buffer.concat(chunks).toString('utf8'),
        }),
      );
    });
    if (serializedBody !== null) request.write(serializedBody);
    request.end();
  });
  const payload = response.contentType.includes('application/json')
    ? JSON.parse(response.text)
    : response.text;
  if (!response.ok) {
    const detail =
      payload && typeof payload === 'object' && 'error' in payload
        ? `${payload.error.code}: ${payload.error.message}`
        : String(payload).slice(0, 800);
    throw new Error(`${method} ${pathname} -> ${response.status}: ${detail}`);
  }
  return payload;
}

function projectFrom(payload) {
  if (!payload?.project) throw new Error('API did not return a project.');
  return payload.project;
}

function chooseVietnameseVoice(catalog) {
  const voices = catalog.voices.filter(
    (voice) => !voice.requiresPaidApiOnFreeTier,
  );
  for (const voice of voices) {
    for (const modelId of voice.highQualityBaseModelIds) {
      const model = catalog.models.find(
        (candidate) =>
          candidate.modelId === modelId && candidate.languages.includes('vi'),
      );
      if (model) return {voice, model};
    }
  }
  throw new Error('No free-tier voice/model pair supporting Vietnamese was found.');
}

async function monitorMotion(projectId, generationId, outcomePromise) {
  let settled = false;
  let lastSummary = '';
  const outcome = outcomePromise.then(
    (value) => ({ok: true, value}),
    (error) => ({ok: false, error}),
  ).finally(() => {
      settled = true;
    });
  const timeoutAt = Date.now() + 20 * 60_000;
  while (!settled && Date.now() < timeoutAt) {
    await delay(1_000);
    const payload = await api(
      `/api/projects/${projectId}/motion-canvas/status`,
    ).catch(() => null);
    const progress = payload?.progress;
    if (!progress || progress.generationId !== generationId) continue;
    const summary = [
      progress.stage,
      `${progress.completedScenes}/${progress.totalScenes} scenes`,
      `${progress.completedSamples}/${progress.totalSamples} frames`,
      progress.cachedSamples ? `${progress.cachedSamples} cached` : '',
      progress.message,
    ]
      .filter(Boolean)
      .join(' | ');
    if (summary !== lastSummary) {
      console.info(`[info]  ${summary}`);
      lastSummary = summary;
    }
  }
  if (!settled) throw new Error('Motion Canvas smoke timed out after 20 minutes.');
  const result = await outcome;
  if (!result.ok) throw result.error;
  return result.value;
}

async function waitForRender(projectId, generationId) {
  const timeoutAt = Date.now() + 20 * 60_000;
  let lastSummary = '';
  while (Date.now() < timeoutAt) {
    const payload = await api(
      `/api/projects/${projectId}/render/status?generationId=${generationId}`,
    );
    const status = payload.status;
    const summary = `${status.state} | ${status.renderedFrames}/${status.totalFrames} frames`;
    if (summary !== lastSummary) {
      console.info(`[info]  ${summary}`);
      lastSummary = summary;
    }
    if (status.state === 'completed') return status;
    if (status.state === 'failed') {
      throw new Error(`Final render failed: ${status.error ?? 'unknown error'}`);
    }
    await delay(1_000);
  }
  throw new Error('Final render smoke timed out after 20 minutes.');
}

// Render progress becomes `completed` as soon as the encoder has finalized the
// MP4. Persisting the immutable project revision follows immediately after, so
// wait for that record instead of racing the final GET and reporting a false
// smoke-test failure.
async function waitForFinalRenderBundle(projectId, generationId) {
  const timeoutAt = Date.now() + 30_000;
  while (Date.now() < timeoutAt) {
    const project = projectFrom(await api(`/api/projects/${projectId}`));
    if (
      project.renderBundle?.status === 'completed' &&
      project.renderBundle.generation.generationId === generationId
    ) {
      return project;
    }
    await delay(250);
  }
  throw new Error('Final render completed but its immutable project record was not persisted in time.');
}

async function loadLayoutPreview(url, browserExecutable) {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'pad-e2e-browser-'));
  try {
    await new Promise((resolve, reject) => {
      const browser = spawn(browserExecutable, [
        '--headless=new',
        '--disable-background-networking',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--no-sandbox',
        // The Motion Canvas layout runtime has to mount every scene and walk
        // its full node tree before it can POST the manifest back; 8s of
        // virtual time was enough for a single toy scene but cut the browser
        // off mid-handshake for a real project, surfacing as a spurious
        // LAYOUT_PREVIEW_MANIFEST_UNAVAILABLE 409 unrelated to any real bug.
        '--virtual-time-budget=20000',
        `--user-data-dir=${profile}`,
        '--dump-dom',
        url,
      ], {stdio: 'ignore', windowsHide: true});
      const timeout = setTimeout(() => {
        browser.kill();
        reject(new Error('Layout preview browser handshake timed out.'));
      }, 45_000);
      browser.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      browser.once('exit', (code) => {
        clearTimeout(timeout);
        if (code === 0) resolve();
        else reject(new Error(`Layout preview browser exited with code ${code}.`));
      });
    });
  } finally {
    await rm(profile, {recursive: true, force: true});
  }
}

const topicInput = {
  topic: 'Vì sao lá cây đổi màu vào mùa thu?',
  learningGoal: 'Nhìn thấy trực quan chất diệp lục rút đi và màu ẩn bên dưới lộ ra.',
  videoDirection:
    'Một cảnh ngắn, ưu tiên chiếc lá thật và biến đổi màu sắc; rất ít chữ, không dùng sơ đồ node-card chung chung.',
  background: {mode: 'dark', color: '#10231D'},
  videoFrame: {aspectRatio: 'landscape', width: 854, height: 480, fps: 24},
  audience: 'beginner',
  duration: 'custom',
  targetDurationMinutes: 0.5,
};

try {
  const diagnostics = await step('Runtime and provider preflight', async () => {
    const payload = await api('/api/runtime/diagnostics');
    const toolsReady = Object.values(payload.diagnostics.tools).every(
      (tool) => tool.available,
    );
    const providersReady = Object.values(payload.diagnostics.providers).every(
      (provider) => provider.state === 'connected',
    );
    if (!toolsReady || !providersReady) {
      throw new Error('Runtime or provider preflight is not ready.');
    }
    return payload.diagnostics;
  });

  const narrationResult = await step('Generate concise narration with Codex', () =>
    api('/api/narration-drafts/generate', {
      method: 'POST',
      body: {
        generationId: randomUUID(),
        topicInput,
        userGuidance:
          'Viết đúng một đoạn tiếng Việt khoảng 55 đến 75 từ, giải thích bằng hình ảnh một chiếc lá duy nhất, không chào hỏi và không kết luận dài.',
        reasoningEffort: 'low',
      },
    }),
  );

  project = await step('Create project and save narration', async () => {
    let current = projectFrom(
      await api('/api/projects', {
        method: 'POST',
        body: {
          creationId: randomUUID(),
          topicInput,
          narrationSourceText: narrationResult.draft.text,
        },
      }),
    );
    current = projectFrom(
      await api(`/api/projects/${current.id}/narration`, {
        method: 'PUT',
        revision: current.revision,
        body: {sourceText: narrationResult.draft.text, projectRules: []},
      }),
    );
    return current;
  });

  project = await step('Approve narration', async () => {
    const review = project.narration?.review;
    if (!review) throw new Error('Narration review was not created.');
    return projectFrom(
      await api(`/api/projects/${project.id}/narration/approve`, {
        method: 'POST',
        revision: project.revision,
        body: {sourceHash: review.sourceHash, rulesHash: review.rulesHash},
      }),
    );
  });

  project = await step('Generate visual intent with Codex', async () =>
    projectFrom(
      await api(`/api/projects/${project.id}/production/prepare`, {
        method: 'POST',
        revision: project.revision,
        body: {
          generationId: randomUUID(),
          plannerReasoningEffort: 'low',
        },
      }),
    ),
  );

  const catalogPayload = await step('Load ElevenLabs voice catalog', () =>
    api('/api/integrations/elevenlabs/catalog'),
  );
  const {voice, model} = chooseVietnameseVoice(catalogPayload.catalog);
  project = await step('Generate timestamped voice with ElevenLabs', async () =>
    projectFrom(
      await api(`/api/projects/${project.id}/voice/generate`, {
        method: 'POST',
        revision: project.revision,
        body: {
          generationId: randomUUID(),
          voiceId: voice.voiceId,
          modelId: model.modelId,
          outputFormat: 'mp3_44100_128',
          settings: {
            stability: 0.5,
            similarityBoost: 0.75,
            style: 0,
            useSpeakerBoost: model.canUseSpeakerBoost,
            speed: 1,
          },
          seed: 1,
        },
      }),
    ),
  );

  project = await step('Generate, compile, and quality-check Motion Canvas', async () => {
    const generationId = randomUUID();
    const outcome = api(`/api/projects/${project.id}/motion-canvas/generate`, {
      method: 'POST',
      revision: project.revision,
      body: {generationId, reasoningEffort: 'low'},
    }).then(projectFrom);
    return monitorMotion(project.id, generationId, outcome);
  });
  if (project.motionCanvasBundle?.visualValidation?.status !== 'passed') {
    throw new Error('Motion Canvas did not pass rendered-frame validation.');
  }
  if (project.motionCanvasBundle?.semanticValidation?.status !== 'passed') {
    throw new Error(
      `Motion Canvas semantic validation is ${project.motionCanvasBundle?.semanticValidation?.status ?? 'missing'}.`,
    );
  }

  project = await step('Approve scene', async () =>
    projectFrom(
      await api(`/api/projects/${project.id}/motion-canvas/approve`, {
        method: 'POST',
        revision: project.revision,
        body: {},
      }),
    ),
  );

  project = await step('Generate and approve audio-animation sync', async () => {
    let current = projectFrom(
      await api(`/api/projects/${project.id}/sync/generate`, {
        method: 'POST',
        revision: project.revision,
        body: {generationId: randomUUID()},
      }),
    );
    current = projectFrom(
      await api(`/api/projects/${current.id}/sync/approve`, {
        method: 'POST',
        revision: current.revision,
      }),
    );
    return current;
  });

  project = await step('Open editor contract and commit unchanged layout', async () => {
    // The headless handshake races a real Vite compile/dev-server round trip
    // against Chrome's --virtual-time-budget page-timer clock, so no fixed
    // budget can be 100% reliable — a cold module transform can occasionally
    // outrun even a generous budget. Retrying with a fresh preview session is
    // the robust fix (no extra Codex/ElevenLabs quota, since this stage is
    // pure browser automation) rather than chasing a larger magic number.
    const attempts = 3;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const preview = (
        await api(`/api/projects/${project.id}/layout/preview`, {
          headers: {'X-Pad-Parent-Origin': baseUrl},
        })
      ).preview;
      await loadLayoutPreview(
        preview.url,
        diagnostics.tools.browser.executablePath,
      );
      try {
        return projectFrom(
          await api(`/api/projects/${project.id}/layout/design`, {
            method: 'PUT',
            revision: project.revision,
            body: {
              generationId: randomUUID(),
              baseGenerationId: null,
              sourceAnimationSyncGenerationId: preview.sourceSyncGenerationId,
              sessionNonce: preview.sessionNonce,
              overrides: [],
              renderSettings: {watermark: {type: 'none'}},
            },
          }),
        );
      } catch (error) {
        const isManifestRace = error instanceof Error && error.message.includes('LAYOUT_PREVIEW_MANIFEST_UNAVAILABLE');
        if (!isManifestRace || attempt === attempts) throw error;
        console.info(`[info]  Layout preview handshake lost the race on attempt ${attempt}/${attempts}; reloading a fresh preview session.`);
      }
    }
    throw new Error('unreachable');
  });

  project = await step('Approve layout', async () =>
    projectFrom(
      await api(`/api/projects/${project.id}/layout/approve`, {
        method: 'POST',
        revision: project.revision,
        body: {generationId: project.layoutBundle.generation.generationId},
      }),
    ),
  );

  const renderGenerationId = randomUUID();
  await step('Render final MP4', async () => {
    await api(`/api/projects/${project.id}/render/generate`, {
      method: 'POST',
      revision: project.revision,
      body: {generationId: renderGenerationId},
    });
    return waitForRender(project.id, renderGenerationId);
  });
  project = await waitForFinalRenderBundle(project.id, renderGenerationId);
  const videoResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/render/video`,
  );
  if (!videoResponse.ok || Number(videoResponse.headers.get('content-length')) < 1_000) {
    throw new Error('Final video endpoint did not return a non-empty MP4.');
  }
  await videoResponse.body?.cancel();

  const totalMs = Date.now() - startedAt;
  const generationDiagnostics = project.motionCanvasBundle.generationDiagnostics ?? [];
  const qualityRetryRounds = new Set(
    generationDiagnostics.filter((entry) => entry.stage === 'quality-retry').map((entry) => entry.attempt),
  ).size;
  const fallbackScenesUsed = generationDiagnostics.filter(
    (entry) => entry.stage === 'fallback' && entry.outcome === 'used_fallback',
  ).length;
  console.info('\nPAD_STUDIO_E2E_SMOKE=PASS');
  console.info(`projectId=${project.id}`);
  console.info(`narrationCharacters=${narrationResult.draft.text.length}`);
  console.info(`voice=${voice.name}`);
  console.info(`voiceModel=${model.name}`);
  console.info(`scenes=${project.motionCanvasBundle.scenes.length}`);
  console.info(`semantic=${project.motionCanvasBundle.semanticValidation.status}`);
  console.info(`visual=${project.motionCanvasBundle.visualValidation.status}`);
  // Retry-circuit-breaker visibility: how many content-repair rounds this
  // generation needed, and how many scenes were force-fallbacked (stalled or
  // budget-exhausted) rather than exhausting Codex quota on a non-converging
  // scene. See motionCanvasRoutes.ts's quality-retry loop.
  console.info(`qualityRetryRounds=${qualityRetryRounds}`);
  console.info(`fallbackScenesUsed=${fallbackScenesUsed}`);
  console.info(`qualityWaivedScenes=${project.motionCanvasBundle.qualityWaivedScenes?.length ?? 0}`);
  console.info(`compositionSlotWarnings=${project.motionCanvasBundle.visualValidation.warnings?.length ?? 0}`);
  console.info(`durationSeconds=${project.renderBundle.durationSeconds}`);
  console.info(`videoBytes=${project.renderBundle.fileSizeBytes}`);
  console.info(`total=${elapsed(totalMs)}`);
  console.info(`codexQuotaRemainingBefore=${diagnostics.providers.codex.quota?.primary?.remainingPercent ?? 'unknown'}%`);

  if (!keepProject) {
    await api(`/api/projects/${project.id}`, {
      method: 'DELETE',
      revision: project.revision,
    });
    console.info('projectDeleted=true');
  }
} catch (error) {
  console.error('\nPAD_STUDIO_E2E_SMOKE=FAIL');
  if (project?.id) console.error(`projectId=${project.id}`);
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
}
