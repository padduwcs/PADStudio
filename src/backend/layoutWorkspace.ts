import {createHash, randomUUID} from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import {
  LayoutBundleSchema,
  LayoutEditorManifestSchema,
  LayoutOverridesDocumentSchema,
  LayoutSceneSummarySchema,
  type LayoutBundle,
  type LayoutEditorManifest,
  type LayoutNodeOverride,
  type LayoutOverridesDocument,
} from '../shared/layout.ts';
import type {AnimationSyncBundle} from '../shared/topic.ts';
import {layoutMatchesAnimationSync} from '../shared/projectPipeline.ts';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const PROJECT_FILE = 'src/project.ts' as const;
const AUDIO_FILE = 'audio/narration.wav' as const;
const OVERRIDES_FILE = 'overrides.json' as const;
const EDITOR_MANIFEST_FILE = 'editor-manifest.json' as const;
const WORKSPACE_MANIFEST_FILE = 'pad-studio.manifest.json' as const;
const WORKSPACE_MANIFEST_VERSION = 2 as const;
const OVERRIDE_CONTRACT_VERSION = 1 as const;

const StoredLayoutWorkspaceManifestSchema = z
  .object({
    version: z.literal(WORKSPACE_MANIFEST_VERSION),
    generationId: z.string().uuid(),
    baseGenerationId: z.string().uuid().nullable(),
    requestHash: z.string().regex(sha256Pattern),
    sourceHash: z.string().regex(sha256Pattern),
    overridesHash: z.string().regex(sha256Pattern),
    manifestHash: z.string().regex(sha256Pattern),
    sourceAnimationSyncGenerationId: z.string().uuid(),
    sourceAnimationSyncContentRevision: z.number().int().positive(),
    sourceAnimationSyncSourceHash: z.string().regex(sha256Pattern),
    sourceWorkspaceHash: z.string().regex(sha256Pattern),
    sourceWorkspacePath: z
      .string()
      .regex(
        /^sync\/generations\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
    projectFile: z.literal(PROJECT_FILE),
    audioFile: z.literal(AUDIO_FILE),
    overridesFile: z.literal(OVERRIDES_FILE),
    manifestFile: z.literal(EDITOR_MANIFEST_FILE),
    overrideContractVersion: z.literal(OVERRIDE_CONTRACT_VERSION),
    totalDurationSeconds: z.number().positive(),
    motionCanvasVersion: z.string().trim().min(1).max(40),
    audioDurationSeconds: z.number().positive(),
    scenes: z.array(LayoutSceneSummarySchema).min(2).max(10),
    validatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (
      manifest.sourceWorkspacePath !==
      `sync/generations/${manifest.sourceAnimationSyncGenerationId}`
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Workspace Sync nguồn không khớp generation.',
        path: ['sourceWorkspacePath'],
      });
    }
    if (
      Math.abs(
        manifest.audioDurationSeconds - manifest.totalDurationSeconds,
      ) >= 0.05
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Thời lượng audio của Layout manifest không khớp.',
        path: ['audioDurationSeconds'],
      });
    }
  });

type StoredLayoutWorkspaceManifest = z.infer<
  typeof StoredLayoutWorkspaceManifestSchema
>;

const StoredAnimationSyncManifestSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    generationId: z.string().uuid(),
    motionCanvasVersion: z.string().trim().min(1).max(40),
    sourceHash: z.string().regex(sha256Pattern),
    audioDurationSeconds: z.number().finite().positive(),
    sourceMotionCanvasGenerationId: z.string().uuid(),
    sourceVoiceGenerationId: z.string().uuid(),
  })
  .strict();

export interface PreparedLayoutWorkspace {
  workspacePath: `layout/generations/${string}`;
  sourceWorkspacePath: `sync/generations/${string}`;
  projectFile: typeof PROJECT_FILE;
  audioFile: typeof AUDIO_FILE;
  overridesFile: typeof OVERRIDES_FILE;
  manifestFile: typeof EDITOR_MANIFEST_FILE;
  overrideContractVersion: typeof OVERRIDE_CONTRACT_VERSION;
  totalDurationSeconds: number;
  scenes: Array<{
    sceneId: string;
    filePath: string;
    editableNodeCount: number;
    overrideCount: number;
  }>;
  validation: LayoutBundle['validation'];
}

export interface LayoutWorkspaceFile {
  path: string;
  source: string;
}

export interface VerifiedLayoutWorkspace {
  projectDirectory: string;
  sourceWorkspaceDirectory: string;
  projectFile: string;
  sourceWorkspaceHash: string;
  layoutWorkspaceDirectory: string | null;
  overrides: LayoutOverridesDocument;
  editorManifest: LayoutEditorManifest | null;
}

export interface LayoutWorkspace {
  prepare(
    projectId: string,
    generationId: string,
    animationSyncBundle: AnimationSyncBundle,
    overrides: LayoutNodeOverride[],
    editorManifest: LayoutEditorManifest,
    baseGenerationId?: string | null,
    expectedSourceWorkspaceHash?: string,
  ): Promise<PreparedLayoutWorkspace>;
  readFiles(
    projectId: string,
    bundle: LayoutBundle,
  ): Promise<LayoutWorkspaceFile[]>;
  readOverrides(
    projectId: string,
    bundle: LayoutBundle,
  ): Promise<LayoutOverridesDocument>;
  readEditorManifest(
    projectId: string,
    bundle: LayoutBundle,
  ): Promise<LayoutEditorManifest>;
  verify(
    projectId: string,
    animationSyncBundle: AnimationSyncBundle,
    bundle: LayoutBundle | null,
  ): Promise<VerifiedLayoutWorkspace>;
}

export class LayoutWorkspaceError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

function assertProjectId(projectId: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(projectId)) {
    throw new LayoutWorkspaceError(
      'LAYOUT_WORKSPACE_INVALID',
      'Project ID của Layout workspace không hợp lệ.',
    );
  }
}

function isInside(root: string, candidate: string) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
  );
}

async function assertNoSymbolicLinks(
  root: string,
  candidate: string,
  label: string,
) {
  if (!isInside(root, candidate)) {
    throw new LayoutWorkspaceError(
      'LAYOUT_WORKSPACE_INVALID',
      `${label} nằm ngoài project.`,
    );
  }
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  let current = path.resolve(root);
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const entry = await lstat(current).catch((error) => {
      throw new LayoutWorkspaceError(
        'LAYOUT_WORKSPACE_READ_FAILED',
        `Không thể kiểm tra ${label}.`,
        {cause: error},
      );
    });
    if (entry.isSymbolicLink()) {
      throw new LayoutWorkspaceError(
        'LAYOUT_WORKSPACE_INVALID',
        `${label} không được đi qua liên kết tượng trưng.`,
      );
    }
  }
}

function sha256(source: string | Buffer) {
  return createHash('sha256').update(source).digest('hex');
}

export async function animationSyncWorkspaceSourceHash(
  workspaceDirectory: string,
  bundle: AnimationSyncBundle,
) {
  const paths = [
    bundle.projectFile,
    'src/project.meta',
    'src/motion-canvas.d.ts',
    'tsconfig.json',
    ...bundle.sections.flatMap((section) => [
      section.filePath,
      section.filePath.replace(/\.tsx$/, '.meta'),
    ]),
    bundle.audioFile,
  ];
  if (new Set(paths).size !== paths.length) {
    throw new LayoutWorkspaceError(
      'LAYOUT_SOURCE_INVALID',
      'Workspace đồng bộ nguồn chứa đường dẫn file trùng.',
    );
  }
  const files = await Promise.all(
    paths.map(async (relativePath) => {
      const filePath = path.resolve(workspaceDirectory, relativePath);
      await assertNoSymbolicLinks(
        workspaceDirectory,
        filePath,
        `file đồng bộ “${relativePath}”`,
      );
      const entry = await stat(filePath).catch((error) => {
        throw new LayoutWorkspaceError(
          'LAYOUT_SOURCE_INVALID',
          `Không thể đọc file đồng bộ “${relativePath}”.`,
          {cause: error},
        );
      });
      if (!entry.isFile()) {
        throw new LayoutWorkspaceError(
          'LAYOUT_SOURCE_INVALID',
          `“${relativePath}” không phải file đồng bộ hợp lệ.`,
        );
      }
      return {
        path: relativePath,
        source: await readFile(filePath),
      };
    }),
  );
  const hash = createHash('sha256');
  for (const file of files.sort((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    hash.update(file.path);
    hash.update('\0');
    hash.update(file.source);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalValue(value));
}

function prettyJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function storedSourceHash(
  manifest: Pick<
    StoredLayoutWorkspaceManifest,
    | 'sourceAnimationSyncGenerationId'
    | 'sourceAnimationSyncContentRevision'
    | 'sourceAnimationSyncSourceHash'
    | 'sourceWorkspaceHash'
    | 'overridesHash'
    | 'manifestHash'
    | 'motionCanvasVersion'
  >,
) {
  return sha256(
    canonicalJson({
      version: WORKSPACE_MANIFEST_VERSION,
      overrideContractVersion: OVERRIDE_CONTRACT_VERSION,
      sourceAnimationSyncGenerationId:
        manifest.sourceAnimationSyncGenerationId,
      sourceAnimationSyncContentRevision:
        manifest.sourceAnimationSyncContentRevision,
      sourceAnimationSyncSourceHash:
        manifest.sourceAnimationSyncSourceHash,
      sourceWorkspaceHash: manifest.sourceWorkspaceHash,
      overridesHash: manifest.overridesHash,
      manifestHash: manifest.manifestHash,
      motionCanvasVersion: manifest.motionCanvasVersion,
    }),
  );
}

function storedRequestHash(
  generationId: string,
  sourceHash: string,
  baseGenerationId: string | null,
) {
  return sha256(
    canonicalJson({generationId, sourceHash, baseGenerationId}),
  );
}

function sameSceneSummaries(
  left: PreparedLayoutWorkspace['scenes'],
  right: PreparedLayoutWorkspace['scenes'],
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function storedMatchesSync(
  stored: StoredLayoutWorkspaceManifest,
  bundle: AnimationSyncBundle,
  scenes: PreparedLayoutWorkspace['scenes'],
  sourceWorkspaceHash: string,
) {
  return (
    stored.sourceAnimationSyncGenerationId ===
      bundle.generation.generationId &&
    stored.sourceAnimationSyncContentRevision === bundle.contentRevision &&
    stored.sourceAnimationSyncSourceHash === bundle.validation.sourceHash &&
    stored.sourceWorkspaceHash === sourceWorkspaceHash &&
    stored.sourceWorkspacePath === bundle.workspacePath &&
    stored.totalDurationSeconds === bundle.totalDurationSeconds &&
    stored.motionCanvasVersion === bundle.validation.motionCanvasVersion &&
    stored.audioDurationSeconds ===
      bundle.validation.audioDurationSeconds &&
    sameSceneSummaries(stored.scenes, scenes)
  );
}

function normalizeOverrides(overrides: LayoutNodeOverride[]) {
  return [...overrides].sort(
    (left, right) =>
      left.sceneId.localeCompare(right.sceneId) ||
      left.nodeKey.localeCompare(right.nodeKey),
  );
}

function normalizeEditorManifest(
  manifest: LayoutEditorManifest,
  sections: AnimationSyncBundle['sections'],
): LayoutEditorManifest {
  const scenes = new Map(
    manifest.scenes.map((scene) => [scene.sceneId, scene]),
  );
  return {
    ...manifest,
    scenes: sections.map((section) => {
      const scene = scenes.get(section.sceneId);
      if (!scene) {
        throw new LayoutWorkspaceError(
          'LAYOUT_MANIFEST_SOURCE_MISMATCH',
          'Layout manifest không bao phủ đầy đủ scene đồng bộ.',
        );
      }
      return {
        ...scene,
        nodes: [...scene.nodes]
          .map((node) => ({
            ...node,
            editableProperties: [...node.editableProperties].sort(),
            lockedProperties: [...node.lockedProperties].sort(),
          }))
          .sort((left, right) => left.key.localeCompare(right.key)),
      };
    }),
  };
}

function assertNoParentCycles(manifest: LayoutEditorManifest) {
  for (const scene of manifest.scenes) {
    const parents = new Map(
      scene.nodes.map((node) => [node.key, node.parentKey]),
    );
    for (const node of scene.nodes) {
      const visited = new Set<string>([node.key]);
      let parent = node.parentKey;
      while (parent !== null) {
        if (visited.has(parent)) {
          throw new LayoutWorkspaceError(
            'LAYOUT_MANIFEST_INVALID',
            `Cây node của scene “${scene.filePath}” chứa vòng lặp.`,
          );
        }
        visited.add(parent);
        parent = parents.get(parent) ?? null;
      }
    }
  }
}

function validateDocuments(
  syncBundle: AnimationSyncBundle,
  overrides: LayoutNodeOverride[],
  editorManifest: LayoutEditorManifest,
) {
  const parsedManifest =
    LayoutEditorManifestSchema.safeParse(editorManifest);
  if (!parsedManifest.success) {
    throw new LayoutWorkspaceError(
      'LAYOUT_MANIFEST_INVALID',
      'Editor manifest của Layout workspace không hợp lệ.',
      {cause: parsedManifest.error},
    );
  }

  const normalizedManifest = normalizeEditorManifest(
    parsedManifest.data,
    syncBundle.sections,
  );
  assertNoParentCycles(normalizedManifest);

  const expectedSceneIds = new Set(
    syncBundle.sections.map((section) => section.sceneId),
  );
  if (
    normalizedManifest.scenes.length !== syncBundle.sections.length ||
    normalizedManifest.scenes.some((scene, index) => {
      const section = syncBundle.sections[index];
      return (
        !section ||
        scene.sceneId !== section.sceneId ||
        scene.filePath !== section.filePath ||
        !expectedSceneIds.has(scene.sceneId)
      );
    })
  ) {
    throw new LayoutWorkspaceError(
      'LAYOUT_MANIFEST_SOURCE_MISMATCH',
      'Danh sách scene của Layout manifest không khớp bản đồng bộ.',
    );
  }

  if (
    normalizedManifest.sourceAnimationSyncGenerationId !==
      syncBundle.generation.generationId ||
    normalizedManifest.sourceAnimationSyncContentRevision !==
      syncBundle.contentRevision ||
    normalizedManifest.sourceAnimationSyncSourceHash !==
      syncBundle.validation.sourceHash
  ) {
    throw new LayoutWorkspaceError(
      'LAYOUT_MANIFEST_SOURCE_MISMATCH',
      'Layout manifest không thuộc đúng generation đồng bộ hiện hành.',
    );
  }

  const normalizedOverrides = normalizeOverrides(overrides);
  const overridesDocument = LayoutOverridesDocumentSchema.safeParse({
    version: OVERRIDE_CONTRACT_VERSION,
    sourceAnimationSyncGenerationId:
      syncBundle.generation.generationId,
    sourceAnimationSyncContentRevision: syncBundle.contentRevision,
    sourceAnimationSyncSourceHash: syncBundle.validation.sourceHash,
    overrides: normalizedOverrides,
  });
  if (!overridesDocument.success) {
    throw new LayoutWorkspaceError(
      'LAYOUT_OVERRIDES_INVALID',
      'Danh sách thay đổi Layout không hợp lệ.',
      {cause: overridesDocument.error},
    );
  }

  const nodesByTarget = new Map(
    normalizedManifest.scenes.flatMap((scene) =>
      scene.nodes.map((node) => [
        `${scene.sceneId}\0${node.key}`,
        node,
      ] as const),
    ),
  );
  for (const override of overridesDocument.data.overrides) {
    const node = nodesByTarget.get(
      `${override.sceneId}\0${override.nodeKey}`,
    );
    if (!node || node.fingerprint !== override.nodeFingerprint) {
      throw new LayoutWorkspaceError(
        'LAYOUT_OVERRIDE_TARGET_MISMATCH',
        `Node “${override.nodeKey}” không còn khớp scene nguồn.`,
      );
    }
    const editable = new Set<string>(node.editableProperties);
    const locked = new Set<string>(node.lockedProperties);
    if (
      override.patch.editorLocked !== undefined &&
      node.editableProperties.every((property) => locked.has(property))
    ) {
      throw new LayoutWorkspaceError(
        'LAYOUT_OVERRIDE_PROPERTY_LOCKED',
        `Node “${override.nodeKey}” không có thuộc tính nào có thể chỉnh để khóa trong editor.`,
      );
    }
    for (const property of Object.keys(override.patch)) {
      if (property === 'editorLocked') continue;
      if (!editable.has(property) || locked.has(property)) {
        throw new LayoutWorkspaceError(
          'LAYOUT_OVERRIDE_PROPERTY_LOCKED',
          `Thuộc tính “${property}” của node “${override.nodeKey}” không thể chỉnh.`,
        );
      }
    }
  }

  return {
    overridesDocument: overridesDocument.data,
    editorManifest: normalizedManifest,
  };
}

function preparedFromStoredManifest(
  manifest: StoredLayoutWorkspaceManifest,
): PreparedLayoutWorkspace {
  return {
    workspacePath:
      `layout/generations/${manifest.generationId}` as const,
    sourceWorkspacePath: manifest.sourceWorkspacePath as
      `sync/generations/${string}`,
    projectFile: manifest.projectFile,
    audioFile: manifest.audioFile,
    overridesFile: manifest.overridesFile,
    manifestFile: manifest.manifestFile,
    overrideContractVersion: manifest.overrideContractVersion,
    totalDurationSeconds: manifest.totalDurationSeconds,
    scenes: manifest.scenes,
    validation: {
      validatedAt: manifest.validatedAt,
      sourceHash: manifest.sourceHash,
      overridesHash: manifest.overridesHash,
      manifestHash: manifest.manifestHash,
      motionCanvasVersion: manifest.motionCanvasVersion,
      audioDurationSeconds: manifest.audioDurationSeconds,
    },
  };
}

async function atomicRename(
  stagingDirectory: string,
  finalDirectory: string,
) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rename(stagingDirectory, finalDirectory);
      return true;
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : '';
      if (code === 'EEXIST' || code === 'ENOTEMPTY') return false;
      const transientLock = code === 'EPERM' || code === 'EBUSY';
      if (transientLock) {
        const destinationExists = await lstat(finalDirectory)
          .then(() => true)
          .catch(() => false);
        if (destinationExists) return false;
      }
      if (!transientLock || attempt === 5) {
        throw new LayoutWorkspaceError(
          'LAYOUT_WORKSPACE_WRITE_FAILED',
          'Không thể hoàn tất Layout workspace.',
          {cause: error},
        );
      }
      await delay(50 * 2 ** attempt);
    }
  }
  return false;
}

export function createLayoutWorkspace(
  projectsDirectory: string,
): LayoutWorkspace {
  const resolvedProjectsDirectory = path.resolve(projectsDirectory);

  function projectDirectory(projectId: string) {
    assertProjectId(projectId);
    return path.join(resolvedProjectsDirectory, projectId);
  }

  async function verifiedProjectDirectory(projectId: string) {
    const candidate = projectDirectory(projectId);
    try {
      const [projectsRoot, realProject] = await Promise.all([
        realpath(resolvedProjectsDirectory),
        realpath(candidate),
      ]);
      const projectEntry = await lstat(candidate);
      if (!isInside(projectsRoot, realProject)) {
        throw new LayoutWorkspaceError(
          'LAYOUT_WORKSPACE_INVALID',
          'Project đi qua liên kết nằm ngoài thư mục projects.',
        );
      }
      if (projectEntry.isSymbolicLink()) {
        throw new LayoutWorkspaceError(
          'LAYOUT_WORKSPACE_INVALID',
          'Project không được là liên kết tượng trưng.',
        );
      }
      return realProject;
    } catch (error) {
      if (error instanceof LayoutWorkspaceError) throw error;
      throw new LayoutWorkspaceError(
        'LAYOUT_WORKSPACE_READ_FAILED',
        'Không thể truy cập project của Layout workspace.',
        {cause: error},
      );
    }
  }

  async function ensureChildDirectory(
    parentDirectory: string,
    childName: string,
  ) {
    const candidate = path.join(parentDirectory, childName);
    try {
      await mkdir(candidate, {recursive: false});
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : '';
      if (code !== 'EEXIST') {
        throw new LayoutWorkspaceError(
          'LAYOUT_WORKSPACE_WRITE_FAILED',
          `Không thể tạo thư mục “${childName}” của Layout workspace.`,
          {cause: error},
        );
      }
    }
    const entry = await lstat(candidate).catch((error) => {
      throw new LayoutWorkspaceError(
        'LAYOUT_WORKSPACE_WRITE_FAILED',
        `Không thể kiểm tra thư mục “${childName}” của Layout workspace.`,
        {cause: error},
      );
    });
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new LayoutWorkspaceError(
        'LAYOUT_WORKSPACE_INVALID',
        `“${childName}” phải là thư mục thật bên trong project.`,
      );
    }
    const realCandidate = await realpath(candidate);
    if (!isInside(parentDirectory, realCandidate)) {
      throw new LayoutWorkspaceError(
        'LAYOUT_WORKSPACE_INVALID',
        `Thư mục “${childName}” nằm ngoài project.`,
      );
    }
    return realCandidate;
  }

  async function existingRealPathInside(
    root: string,
    candidate: string,
    label: string,
  ) {
    if (!isInside(root, candidate)) {
      throw new LayoutWorkspaceError(
        'LAYOUT_WORKSPACE_INVALID',
        `${label} nằm ngoài project.`,
      );
    }
    try {
      await assertNoSymbolicLinks(root, candidate, label);
      const [realRoot, realCandidate] = await Promise.all([
        realpath(root),
        realpath(candidate),
      ]);
      if (!isInside(realRoot, realCandidate)) {
        throw new LayoutWorkspaceError(
          'LAYOUT_WORKSPACE_INVALID',
          `${label} đi qua liên kết nằm ngoài project.`,
        );
      }
      return realCandidate;
    } catch (error) {
      if (error instanceof LayoutWorkspaceError) throw error;
      throw new LayoutWorkspaceError(
        'LAYOUT_WORKSPACE_READ_FAILED',
        `Không thể truy cập ${label}.`,
        {cause: error},
      );
    }
  }

  async function existingRegularFileInside(
    root: string,
    candidate: string,
    label: string,
  ) {
    const resolved = await existingRealPathInside(root, candidate, label);
    const entry = await lstat(candidate).catch((error) => {
      throw new LayoutWorkspaceError(
        'LAYOUT_WORKSPACE_READ_FAILED',
        `Không thể kiểm tra ${label}.`,
        {cause: error},
      );
    });
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new LayoutWorkspaceError(
        'LAYOUT_WORKSPACE_INVALID',
        `${label} phải là file thật bên trong workspace.`,
      );
    }
    return resolved;
  }

  async function validateSyncWorkspace(
    projectId: string,
    bundle: AnimationSyncBundle,
  ) {
    if (
      bundle.status !== 'approved' ||
      bundle.workspacePath !==
        `sync/generations/${bundle.generation.generationId}`
    ) {
      throw new LayoutWorkspaceError(
        'LAYOUT_SOURCE_NOT_APPROVED',
        'Layout Editor cần một bản đồng bộ đã chốt và đúng generation.',
      );
    }

    const root = await verifiedProjectDirectory(projectId);
    const workspaceDirectory = await existingRealPathInside(
      root,
      path.resolve(root, bundle.workspacePath),
      'workspace đồng bộ nguồn',
    );
    const [projectFile, audioFile, manifestFile] = await Promise.all([
      existingRegularFileInside(
        workspaceDirectory,
        path.resolve(workspaceDirectory, bundle.projectFile),
        'project Motion Canvas nguồn',
      ),
      existingRegularFileInside(
        workspaceDirectory,
        path.resolve(workspaceDirectory, bundle.audioFile),
        'narration nguồn',
      ),
      existingRegularFileInside(
        workspaceDirectory,
        path.resolve(workspaceDirectory, WORKSPACE_MANIFEST_FILE),
        'manifest đồng bộ nguồn',
      ),
    ]);

    const sourceManifestValue = await readFile(manifestFile, 'utf8')
      .then((source) => JSON.parse(source) as unknown)
      .catch((error) => {
        throw new LayoutWorkspaceError(
          'LAYOUT_SOURCE_MANIFEST_INVALID',
          'Không thể đọc manifest của bản đồng bộ nguồn.',
          {cause: error},
        );
      });
    const sourceManifest =
      StoredAnimationSyncManifestSchema.safeParse(sourceManifestValue);
    if (
      !sourceManifest.success ||
      sourceManifest.data.generationId !==
        bundle.generation.generationId ||
      sourceManifest.data.sourceHash !== bundle.validation.sourceHash ||
      sourceManifest.data.motionCanvasVersion !==
        bundle.validation.motionCanvasVersion ||
      Math.abs(
        sourceManifest.data.audioDurationSeconds -
          bundle.validation.audioDurationSeconds,
      ) >= 0.001
    ) {
      throw new LayoutWorkspaceError(
        'LAYOUT_SOURCE_MANIFEST_MISMATCH',
        'Manifest đồng bộ nguồn không khớp artifact hiện hành.',
        {cause: sourceManifest.success ? undefined : sourceManifest.error},
      );
    }
    const computedSourceHash =
      await animationSyncWorkspaceSourceHash(
        workspaceDirectory,
        bundle,
      );
    if (computedSourceHash !== bundle.validation.sourceHash) {
      throw new LayoutWorkspaceError(
        'LAYOUT_SOURCE_MANIFEST_MISMATCH',
        'Workspace Sync không còn khớp hash đã chốt. Hãy quay lại bước Đồng bộ, ' +
          'tạo và chốt lại bản đồng bộ trước khi mở Layout.',
      );
    }

    const [projectStats, audioStats] = await Promise.all([
      stat(projectFile),
      stat(audioFile),
    ]);
    if (
      !projectStats.isFile() ||
      projectStats.size === 0 ||
      !audioStats.isFile() ||
      audioStats.size < 44
    ) {
      throw new LayoutWorkspaceError(
        'LAYOUT_SOURCE_INVALID',
        'Project hoặc narration của bản đồng bộ nguồn không hợp lệ.',
      );
    }
    return {
      root,
      workspaceDirectory,
      projectFile,
      sourceWorkspaceHash: computedSourceHash,
    };
  }

  async function readStoredManifest(directory: string) {
    const manifestPath = path.resolve(
      directory,
      WORKSPACE_MANIFEST_FILE,
    );
    if (!isInside(directory, manifestPath)) {
      throw new LayoutWorkspaceError(
        'LAYOUT_WORKSPACE_INVALID',
        'Đường dẫn manifest Layout không hợp lệ.',
      );
    }
    await existingRegularFileInside(
      directory,
      manifestPath,
      'manifest Layout workspace',
    );
    const value = await readFile(manifestPath, 'utf8')
      .then((source) => JSON.parse(source) as unknown)
      .catch((error) => {
        throw new LayoutWorkspaceError(
          'LAYOUT_WORKSPACE_READ_FAILED',
          'Không thể đọc manifest Layout workspace.',
          {cause: error},
        );
      });
    const parsed = StoredLayoutWorkspaceManifestSchema.safeParse(value);
    if (!parsed.success) {
      throw new LayoutWorkspaceError(
        'LAYOUT_WORKSPACE_INVALID',
        'Manifest Layout workspace không hợp lệ.',
        {cause: parsed.error},
      );
    }
    if (
      parsed.data.sourceHash !== storedSourceHash(parsed.data) ||
      parsed.data.requestHash !==
        storedRequestHash(
          parsed.data.generationId,
          parsed.data.sourceHash,
          parsed.data.baseGenerationId,
        )
    ) {
      throw new LayoutWorkspaceError(
        'LAYOUT_WORKSPACE_INTEGRITY_FAILED',
        'Hash của Layout workspace manifest không còn hợp lệ.',
      );
    }
    return parsed.data;
  }

  async function verifyStoredDocuments(
    directory: string,
    manifest: StoredLayoutWorkspaceManifest,
  ) {
    const overridesPath = path.resolve(
      directory,
      manifest.overridesFile,
    );
    const editorManifestPath = path.resolve(
      directory,
      manifest.manifestFile,
    );
    await Promise.all([
      existingRegularFileInside(
        directory,
        overridesPath,
        'file overrides Layout',
      ),
      existingRegularFileInside(
        directory,
        editorManifestPath,
        'file editor manifest Layout',
      ),
    ]);
    const [overridesSource, editorManifestSource] = await Promise.all([
      readFile(overridesPath, 'utf8'),
      readFile(editorManifestPath, 'utf8'),
    ]).catch((error) => {
      throw new LayoutWorkspaceError(
        'LAYOUT_WORKSPACE_READ_FAILED',
        'Không thể đọc dữ liệu Layout workspace.',
        {cause: error},
      );
    });
    let overridesValue: unknown;
    let editorManifestValue: unknown;
    try {
      overridesValue = JSON.parse(overridesSource) as unknown;
      editorManifestValue = JSON.parse(editorManifestSource) as unknown;
    } catch (error) {
      throw new LayoutWorkspaceError(
        'LAYOUT_WORKSPACE_INTEGRITY_FAILED',
        'JSON của Layout workspace không còn hợp lệ.',
        {cause: error},
      );
    }
    const overrides =
      LayoutOverridesDocumentSchema.safeParse(overridesValue);
    const editorManifest =
      LayoutEditorManifestSchema.safeParse(editorManifestValue);
    if (
      !overrides.success ||
      !editorManifest.success ||
      sha256(canonicalJson(overrides.data)) !== manifest.overridesHash ||
      sha256(canonicalJson(editorManifest.data)) !== manifest.manifestHash
    ) {
      throw new LayoutWorkspaceError(
        'LAYOUT_WORKSPACE_INTEGRITY_FAILED',
        'Dữ liệu Layout workspace đã thay đổi ngoài luồng.',
      );
    }
    return {
      overrides: overrides.data,
      editorManifest: editorManifest.data,
      overridesSource,
      editorManifestSource,
    };
  }

  async function resolveLayoutDirectory(
    projectId: string,
    bundle: LayoutBundle,
  ) {
    const parsedBundle = LayoutBundleSchema.safeParse(bundle);
    if (!parsedBundle.success) {
      throw new LayoutWorkspaceError(
        'LAYOUT_WORKSPACE_INVALID',
        'Layout bundle không hợp lệ.',
        {cause: parsedBundle.error},
      );
    }
    const root = await verifiedProjectDirectory(projectId);
    const directory = await existingRealPathInside(
      root,
      path.resolve(root, bundle.workspacePath),
      'Layout workspace',
    );
    const manifest = await readStoredManifest(directory);
    if (
      manifest.generationId !== bundle.generation.generationId ||
      manifest.sourceHash !== bundle.validation.sourceHash ||
      manifest.overridesHash !== bundle.validation.overridesHash ||
      manifest.manifestHash !== bundle.validation.manifestHash ||
      manifest.sourceAnimationSyncGenerationId !==
        bundle.sourceAnimationSyncGenerationId ||
      manifest.sourceAnimationSyncContentRevision !==
        bundle.sourceAnimationSyncContentRevision ||
      manifest.sourceAnimationSyncSourceHash !==
        bundle.sourceAnimationSyncSourceHash ||
      manifest.sourceWorkspacePath !== bundle.sourceWorkspacePath ||
      manifest.projectFile !== bundle.projectFile ||
      manifest.audioFile !== bundle.audioFile ||
      manifest.overridesFile !== bundle.overridesFile ||
      manifest.manifestFile !== bundle.manifestFile ||
      manifest.overrideContractVersion !==
        bundle.overrideContractVersion ||
      manifest.totalDurationSeconds !== bundle.totalDurationSeconds ||
      manifest.motionCanvasVersion !==
        bundle.validation.motionCanvasVersion ||
      manifest.audioDurationSeconds !==
        bundle.validation.audioDurationSeconds ||
      manifest.validatedAt !== bundle.validation.validatedAt ||
      !sameSceneSummaries(manifest.scenes, bundle.scenes)
    ) {
      throw new LayoutWorkspaceError(
        'LAYOUT_WORKSPACE_INTEGRITY_FAILED',
        'Layout bundle không khớp workspace bất biến.',
      );
    }
    const documents = await verifyStoredDocuments(directory, manifest);
    return {directory, manifest, documents};
  }

  return {
    async prepare(
      projectId,
      generationId,
      animationSyncBundle,
      overrides,
      editorManifest,
      baseGenerationId = null,
      expectedSourceWorkspaceHash,
    ) {
      assertProjectId(projectId);
      if (!uuidPattern.test(generationId)) {
        throw new LayoutWorkspaceError(
          'LAYOUT_WORKSPACE_INVALID',
          'Generation ID của Layout workspace không hợp lệ.',
        );
      }
      const {root, sourceWorkspaceHash} =
        await validateSyncWorkspace(
          projectId,
          animationSyncBundle,
        );
      if (
        expectedSourceWorkspaceHash &&
        expectedSourceWorkspaceHash !== sourceWorkspaceHash
      ) {
        throw new LayoutWorkspaceError(
          'LAYOUT_SOURCE_MANIFEST_MISMATCH',
          'Source Sync đã thay đổi sau khi mở Layout preview.',
        );
      }
      const documents = validateDocuments(
        animationSyncBundle,
        overrides,
        editorManifest,
      );
      const overridesHash = sha256(
        canonicalJson(documents.overridesDocument),
      );
      const manifestHash = sha256(
        canonicalJson(documents.editorManifest),
      );
      const sourceHash = storedSourceHash({
        sourceAnimationSyncGenerationId:
          animationSyncBundle.generation.generationId,
        sourceAnimationSyncContentRevision:
          animationSyncBundle.contentRevision,
        sourceAnimationSyncSourceHash:
          animationSyncBundle.validation.sourceHash,
        sourceWorkspaceHash,
        overridesHash,
        manifestHash,
        motionCanvasVersion:
          animationSyncBundle.validation.motionCanvasVersion,
      });
      const requestHash = storedRequestHash(
        generationId,
        sourceHash,
        baseGenerationId,
      );

      const sceneOverrides = new Map<string, number>();
      for (const override of documents.overridesDocument.overrides) {
        sceneOverrides.set(
          override.sceneId,
          (sceneOverrides.get(override.sceneId) ?? 0) + 1,
        );
      }
      const scenes = documents.editorManifest.scenes.map((scene) => ({
        sceneId: scene.sceneId,
        filePath: scene.filePath,
        editableNodeCount: scene.nodes.filter((node) =>
          node.editableProperties.some(
            (property) => !node.lockedProperties.includes(property),
          ),
        ).length,
        overrideCount: sceneOverrides.get(scene.sceneId) ?? 0,
      }));

      const realProjectDirectory = await realpath(root);
      const layoutDirectory = await ensureChildDirectory(
        realProjectDirectory,
        'layout',
      );
      const realGenerationsDirectory = await ensureChildDirectory(
        layoutDirectory,
        'generations',
      );
      if (!isInside(realProjectDirectory, realGenerationsDirectory)) {
        throw new LayoutWorkspaceError(
          'LAYOUT_WORKSPACE_INVALID',
          'Thư mục Layout generations nằm ngoài project.',
        );
      }

      const finalDirectory = path.join(
        realGenerationsDirectory,
        generationId,
      );
      const workspacePath =
        `layout/generations/${generationId}` as const;

      const existing = await lstat(finalDirectory)
        .then(() => true)
        .catch(() => false);
      if (existing) {
        const existingDirectory = await existingRealPathInside(
          realProjectDirectory,
          finalDirectory,
          'Layout workspace hiện có',
        );
        const stored = await readStoredManifest(existingDirectory);
        if (stored.requestHash !== requestHash) {
          throw new LayoutWorkspaceError(
            'LAYOUT_WORKSPACE_CONFLICT',
            'Generation ID này đã chứa một Layout workspace khác.',
          );
        }
        if (
          !storedMatchesSync(
            stored,
            animationSyncBundle,
            scenes,
            sourceWorkspaceHash,
          )
        ) {
          throw new LayoutWorkspaceError(
            'LAYOUT_WORKSPACE_INTEGRITY_FAILED',
            'Layout workspace hiện có không khớp nguồn Sync.',
          );
        }
        await verifyStoredDocuments(existingDirectory, stored);
        return preparedFromStoredManifest(stored);
      }

      const stagingDirectory = path.join(
        realGenerationsDirectory,
        `.staging-${randomUUID()}`,
      );
      const validatedAt = new Date().toISOString();
      const storedManifest: StoredLayoutWorkspaceManifest = {
        version: WORKSPACE_MANIFEST_VERSION,
        generationId,
        baseGenerationId,
        requestHash,
        sourceHash,
        overridesHash,
        manifestHash,
        sourceAnimationSyncGenerationId:
          animationSyncBundle.generation.generationId,
        sourceAnimationSyncContentRevision:
          animationSyncBundle.contentRevision,
        sourceAnimationSyncSourceHash:
          animationSyncBundle.validation.sourceHash,
        sourceWorkspaceHash,
        sourceWorkspacePath: animationSyncBundle.workspacePath,
        projectFile: PROJECT_FILE,
        audioFile: AUDIO_FILE,
        overridesFile: OVERRIDES_FILE,
        manifestFile: EDITOR_MANIFEST_FILE,
        overrideContractVersion: OVERRIDE_CONTRACT_VERSION,
        totalDurationSeconds:
          animationSyncBundle.totalDurationSeconds,
        motionCanvasVersion:
          animationSyncBundle.validation.motionCanvasVersion,
        audioDurationSeconds:
          animationSyncBundle.validation.audioDurationSeconds,
        scenes,
        validatedAt,
      };

      try {
        await mkdir(stagingDirectory, {recursive: false});
        await Promise.all([
          writeFile(
            path.join(stagingDirectory, OVERRIDES_FILE),
            prettyJson(documents.overridesDocument),
            {encoding: 'utf8', flag: 'wx'},
          ),
          writeFile(
            path.join(stagingDirectory, EDITOR_MANIFEST_FILE),
            prettyJson(documents.editorManifest),
            {encoding: 'utf8', flag: 'wx'},
          ),
          writeFile(
            path.join(stagingDirectory, WORKSPACE_MANIFEST_FILE),
            prettyJson(storedManifest),
            {encoding: 'utf8', flag: 'wx'},
          ),
        ]);
        const committed = await atomicRename(
          stagingDirectory,
          finalDirectory,
        );
        if (!committed) {
          const stored = await readStoredManifest(finalDirectory);
          if (stored.requestHash !== requestHash) {
            throw new LayoutWorkspaceError(
              'LAYOUT_WORKSPACE_CONFLICT',
              'Generation ID này vừa được dùng cho Layout workspace khác.',
            );
          }
          if (
            !storedMatchesSync(
              stored,
              animationSyncBundle,
              scenes,
              sourceWorkspaceHash,
            )
          ) {
            throw new LayoutWorkspaceError(
              'LAYOUT_WORKSPACE_INTEGRITY_FAILED',
              'Layout workspace vừa tạo không khớp nguồn Sync.',
            );
          }
          await verifyStoredDocuments(finalDirectory, stored);
          return preparedFromStoredManifest(stored);
        }
        return {
          ...preparedFromStoredManifest(storedManifest),
          workspacePath,
        };
      } finally {
        await rm(stagingDirectory, {
          recursive: true,
          force: true,
        }).catch(() => undefined);
      }
    },

    async readFiles(projectId, bundle) {
      const {manifest, documents} = await resolveLayoutDirectory(
        projectId,
        bundle,
      );
      return [
        {
          path: manifest.overridesFile,
          source: documents.overridesSource,
        },
        {
          path: manifest.manifestFile,
          source: documents.editorManifestSource,
        },
        {
          path: WORKSPACE_MANIFEST_FILE,
          source: prettyJson(manifest),
        },
      ];
    },

    async readOverrides(projectId, bundle) {
      const {documents} = await resolveLayoutDirectory(
        projectId,
        bundle,
      );
      return documents.overrides;
    },

    async readEditorManifest(projectId, bundle) {
      const {documents} = await resolveLayoutDirectory(
        projectId,
        bundle,
      );
      return documents.editorManifest;
    },

    async verify(projectId, animationSyncBundle, bundle) {
      const {
        root,
        workspaceDirectory,
        projectFile,
        sourceWorkspaceHash,
      } = await validateSyncWorkspace(
        projectId,
        animationSyncBundle,
      );
      const emptyOverrides: LayoutOverridesDocument = {
        version: OVERRIDE_CONTRACT_VERSION,
        sourceAnimationSyncGenerationId:
          animationSyncBundle.generation.generationId,
        sourceAnimationSyncContentRevision:
          animationSyncBundle.contentRevision,
        sourceAnimationSyncSourceHash:
          animationSyncBundle.validation.sourceHash,
        overrides: [],
      };
      if (!bundle) {
        return {
          projectDirectory: root,
          sourceWorkspaceDirectory: workspaceDirectory,
          projectFile,
          sourceWorkspaceHash,
          layoutWorkspaceDirectory: null,
          overrides: emptyOverrides,
          editorManifest: null,
        };
      }
      if (
        !layoutMatchesAnimationSync(bundle, animationSyncBundle) ||
        bundle.sourceWorkspacePath !==
          animationSyncBundle.workspacePath ||
        bundle.projectFile !== animationSyncBundle.projectFile ||
        bundle.audioFile !== animationSyncBundle.audioFile
      ) {
        throw new LayoutWorkspaceError(
          'LAYOUT_WORKSPACE_INTEGRITY_FAILED',
          'Layout bundle không còn thuộc bản đồng bộ hiện hành.',
        );
      }
      const resolved = await resolveLayoutDirectory(projectId, bundle);
      if (resolved.manifest.sourceWorkspaceHash !== sourceWorkspaceHash) {
        throw new LayoutWorkspaceError(
          'LAYOUT_SOURCE_MANIFEST_MISMATCH',
          'Nội dung workspace đồng bộ đã thay đổi sau khi Layout được lưu.',
        );
      }
      return {
        projectDirectory: root,
        sourceWorkspaceDirectory: workspaceDirectory,
        projectFile,
        sourceWorkspaceHash,
        layoutWorkspaceDirectory: resolved.directory,
        overrides: resolved.documents.overrides,
        editorManifest: resolved.documents.editorManifest,
      };
    },
  };
}
