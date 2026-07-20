import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';

export type CredentialName = 'elevenlabs';

export interface CredentialStore {
  readonly persistence: 'os-protected' | 'session';
  get(name: CredentialName): Promise<string | null>;
  set(name: CredentialName, value: string): Promise<void>;
  delete(name: CredentialName): Promise<void>;
}

interface SecretProtector {
  protect(value: string): Promise<string>;
  unprotect(value: string): Promise<string>;
}

const credentialFileSchema = z
  .object({
    version: z.literal(1),
    entries: z.record(z.string(), z.string()),
  })
  .strict();

const entropyLabel = 'PADStudio:credential-store:v1';

function powershellExecutable() {
  const windowsDirectory = process.env.SystemRoot?.trim();
  return windowsDirectory
    ? path.join(
        windowsDirectory,
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      )
    : 'powershell.exe';
}

function runPowerShell(script: string, input: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      powershellExecutable(),
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true},
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString('utf8').trim());
        return;
      }
      reject(
        new Error(
          `Windows credential protection failed (${String(code)}): ${Buffer.concat(stderr).toString('utf8').trim().slice(0, 500)}`,
        ),
      );
    });
    child.stdin.end(input, 'utf8');
  });
}

export function createWindowsDpapiProtector(): SecretProtector {
  const protectScript = [
    'Add-Type -AssemblyName System.Security',
    "$value = [Console]::In.ReadToEnd()",
    "$bytes = [Text.Encoding]::UTF8.GetBytes($value)",
    `$entropy = [Text.Encoding]::UTF8.GetBytes('${entropyLabel}')`,
    '$protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '[Console]::Out.Write([Convert]::ToBase64String($protected))',
  ].join('; ');
  const unprotectScript = [
    'Add-Type -AssemblyName System.Security',
    "$value = [Console]::In.ReadToEnd()",
    '$bytes = [Convert]::FromBase64String($value)',
    `$entropy = [Text.Encoding]::UTF8.GetBytes('${entropyLabel}')`,
    '$plain = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))',
  ].join('; ');
  return {
    protect: (value) => runPowerShell(protectScript, value),
    unprotect: (value) => runPowerShell(unprotectScript, value),
  };
}

export function createProtectedFileCredentialStore(
  filePath: string,
  protector: SecretProtector = createWindowsDpapiProtector(),
): CredentialStore {
  const resolvedFile = path.resolve(filePath);
  let queue = Promise.resolve();

  async function readDocument() {
    try {
      const parsed = credentialFileSchema.safeParse(
        JSON.parse(await readFile(resolvedFile, 'utf8')),
      );
      if (!parsed.success) throw new Error('Credential store is invalid.');
      return parsed.data;
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return {version: 1 as const, entries: {}};
      }
      throw error;
    }
  }

  function update(operation: () => Promise<void>) {
    const next = queue.then(operation, operation);
    queue = next.catch(() => undefined);
    return next;
  }

  async function writeDocument(document: z.infer<typeof credentialFileSchema>) {
    await mkdir(path.dirname(resolvedFile), {recursive: true});
    const temporary = `${resolvedFile}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    try {
      await rename(temporary, resolvedFile);
    } finally {
      await rm(temporary, {force: true}).catch(() => undefined);
    }
  }

  return {
    persistence: 'os-protected',
    async get(name) {
      await queue;
      const encrypted = (await readDocument()).entries[name];
      return encrypted ? protector.unprotect(encrypted) : null;
    },
    set(name, value) {
      return update(async () => {
        const document = await readDocument();
        document.entries[name] = await protector.protect(value);
        await writeDocument(document);
      });
    },
    delete(name) {
      return update(async () => {
        const document = await readDocument();
        delete document.entries[name];
        await writeDocument(document);
      });
    },
  };
}

export function createSessionCredentialStore(): CredentialStore {
  const entries = new Map<CredentialName, string>();
  return {
    persistence: 'session',
    async get(name) {
      return entries.get(name) ?? null;
    },
    async set(name, value) {
      entries.set(name, value);
    },
    async delete(name) {
      entries.delete(name);
    },
  };
}

export function createDefaultCredentialStore(repositoryRoot: string) {
  if (process.platform === 'win32') {
    return createProtectedFileCredentialStore(
      path.join(repositoryRoot, '.pad-studio', 'credentials.json'),
    );
  }
  return createSessionCredentialStore();
}
