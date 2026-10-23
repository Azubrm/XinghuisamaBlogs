// Server-side storage for the local manager. Never import this file in a client component.
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const localGitHubSecretPath = () => path.resolve(process.cwd(), '..', '.local-runtime', 'github-oauth.json');

export function canManageGitHubSecret(request: Request): boolean {
  try {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    const host = request.headers.get('host') || url.host;
    const hostUrl = new URL(`${url.protocol}//${host}`);
    return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && ['127.0.0.1', 'localhost', '[::1]'].includes(hostUrl.hostname)
      && !!origin && new URL(origin).host === host && new URL(origin).protocol === url.protocol;
  } catch {
    return false;
  }
}

export function validGitHubSecretInput(value: unknown): value is { clientId: string; clientSecret: string } {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  return typeof input.clientId === 'string' && /^[a-zA-Z0-9]{10,64}$/.test(input.clientId)
    && typeof input.clientSecret === 'string' && /^[a-zA-Z0-9_-]{20,256}$/.test(input.clientSecret);
}

export async function saveGitHubClientSecret(clientId: string, clientSecret: string, destination = localGitHubSecretPath()): Promise<void> {
  const directory = path.dirname(destination);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.github-oauth-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify({ clientId, clientSecret }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporary, destination);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}
